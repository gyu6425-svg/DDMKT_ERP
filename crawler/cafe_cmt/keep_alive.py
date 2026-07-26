# -*- coding: utf-8 -*-
"""
네이버 세션 keep-alive — 로그인 세션이 만료되지 않도록 주기적으로 인증 페이지를 '가볍게 터치'.

[왜] 이 저장소엔 keep-alive 가 없어 세션은 (1)영구 프로필 + (2)만료 후 자동복구에만 의존한다.
  로그인 시 '로그인 상태 유지' 체크가 1순위지만, 여기에 저빈도 터치를 더하면 세션 쿠키가 갱신돼
  만료를 크게 늦춘다. 쓰기 동작 없음(읽기 전용) → 계정 안전.

[안전 설계]
  - comment_listener 와 같은 헤드리스 크롬(9224)에 CDP 로 붙되, 리스너가 쓰는 탭을 건드리지 않도록
    ★별도 탭(new_page)★ 을 열어 확인하고 즉시 닫는다. (쿠키는 프로필 공유라 세션은 같이 갱신됨)
  - run_chrome_login.bat(보이는 크롬)과 동시에 같은 프로필로 실행 금지(프로필 잠금 충돌).
    반드시 run_chrome.bat(헤드리스, 9224)에 붙는다.

[사용]
  python keep_alive.py            # 무한 루프(기본 간격 CAFE_CMT_KEEPALIVE_MIN 분, 기본 40)
  python keep_alive.py --once     # 1회만 확인(테스트)
  옵션: --cdp http://127.0.0.1:9224
"""
import argparse
import datetime
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

import comment_cafe as cc   # 같은 디렉터리(자립) — _connect·DEFAULT_CDP·로그인감지 재사용
import accounts as acct     # 모든 계정 크롬을 돌며 깨우기
import heartbeat as hb      # 살아있음 신호(워치독 감시용)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# 모든 계정 크롬을 이 간격마다 '가볍게 터치' → 유휴 크롬이 좀비가 되는 걸 예방(특히 대댓글 계정은
#   할 일 없을 때 오래 놀아 좀비가 잦았음). 읽기전용이라 계정 안전. .env 의 KEEPALIVE_MIN(40)은
#   단일-세션 유지용이었고, 여기선 좀비 예방을 위해 더 자주(기본 12분) 돈다.
INTERVAL_MIN = int(os.environ.get("CAFE_CMT_KEEPALIVE_ALL_MIN", "12"))
RETRY_MIN = 3   # 크롬 꺼짐 등 오류 시 짧은 재시도 간격(분) — 정상 주기(INTERVAL_MIN)와 분리
# 로그인 상태 판정은 '인증 필요 페이지가 nid 로그인으로 리다이렉트되는지'로 한다(엔진과 동일 신호).
#   cafe.naver.com 홈은 로그아웃돼도 리다이렉트가 없어 오탐 → 반드시 인증 페이지(글쓰기 URL 등)를 쓴다.
#   #keepalive 마커: 리스너(_connect)가 이 탭을 작업 탭으로 오인·선택하지 않도록 배제하는 표식.
_base = os.environ.get("CAFE_CMT_KEEPALIVE_URL") or os.environ.get("CAFE_WRITE_URL") or "https://cafe.naver.com/ca-fe"
TOUCH_URL = _base + ("&" if "?" in _base else "?") + "keepalive=1#keepalive"


def _log(m):
    print(f"[keepalive] {datetime.datetime.now():%H:%M:%S} {m}", flush=True)


def touch(cdp_url):
    """별도 탭으로 인증 페이지를 열어 로그인 상태만 확인하고 닫는다. True=로그인유지, False=만료."""
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(cdp_url, timeout=20000)   # 좀비 크롬에 180초 멈춤 방지
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        page = ctx.new_page()   # ★리스너 탭 보존: 새 탭에서만 확인
        try:
            page.goto(TOUCH_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(1500)
            logged_out = bool(re.search(r"nid\.naver\.com|nidlogin", page.url or ""))
            return not logged_out
        finally:
            try:
                page.close()
            except Exception:
                pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--cdp", default=cc.DEFAULT_CDP)
    args = ap.parse_args()

    if args.once:
        try:
            ok = touch(args.cdp)
            _log("세션 유지됨 ✅" if ok else "⚠️ 로그인 만료 — run_chrome_login.bat 로 재로그인 필요")
        except Exception as e:
            _log(f"확인 실패(크롬 꺼짐?): {str(e)[:100]}")
        return

    # --cdp 를 명시하면 그 하나만(하위호환), 아니면 accounts.txt 의 '모든 계정'을 돈다.
    single = args.cdp if ("--cdp" in sys.argv) else None
    _log(f"세션 keep-alive 시작 — 간격 {INTERVAL_MIN}분 · 모든 계정 크롬 터치(유휴 좀비 예방) · 읽기전용")
    while True:
        hb.beat("keepalive")
        targets = ([("(cdp)", single)] if single
                   else [(a["name"], "http://127.0.0.1:%d" % a["port"]) for a in acct.load_accounts()])
        ok_n = 0
        for name, url in targets:
            try:
                ok = touch(url)
                ok_n += 1 if ok else 0
                if not ok:
                    _log(f"⚠️ {name} 로그인 만료 — run_chrome_login.bat {name} 로 재로그인 필요")
            except Exception as e:
                # 좀비/꺼짐이면 워치독이 크롬을 되살린다. 여기선 조용히 넘어가고 다음 계정.
                _log(f"  {name} 터치 실패(크롬 꺼짐/좀비?): {str(e)[:70]}")
        _log(f"터치 완료 {ok_n}/{len(targets)} 정상")
        # 12분을 60초 단위로 쪼개 heartbeat 유지(워치독 hang 감지용)
        end = time.time() + INTERVAL_MIN * 60
        while time.time() < end:
            time.sleep(min(60, max(1, end - time.time())))
            hb.beat("keepalive")


if __name__ == "__main__":
    main()
