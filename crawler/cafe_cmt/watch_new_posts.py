# -*- coding: utf-8 -*-
"""
카페 새 글 감시 워처 — 등록된 카페(cafe_comment_watch)를 주기적으로 크롤링해
새 글이 올라오면 cafe_comment_queue 에 템플릿 댓글을 자동 예약한다.

[흐름] 웹에서 카페 등록 → [이 워처] 로그인 크롬(9224)으로 카페 최신글 스크랩
       → 새 글(마지막 본 글번호 초과) 발견 → build_comment 로 댓글 생성 → 큐 적재
       → comment_listener 가 게시(중복방지 적용). cafe_pub/comment_cafe 를 import 하지 않음(자립).

[안전] 첫 실행은 기존 글을 '기준선'으로만 잡고 댓글 안 달기 → 이후 새 글에만.
       별도 탭(#watch 마커)으로 스크랩 → 리스너/keep-alive 작업탭 보존. 읽기전용 크롤.

[사용]
  python watch_new_posts.py            # 무한 루프(기본 CAFE_CMT_WATCH_MIN 분, 기본 5)
  python watch_new_posts.py --once     # 1회만
  옵션: --cdp http://127.0.0.1:9224
"""
import argparse
import datetime
import os
import random
import sys
import time

from playwright.sync_api import sync_playwright

import comment_cafe as cc
import accounts as acct     # 계정 → 크롬 포트(멀티계정)
from comment_templates import build_comment, region_from_title

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

INTERVAL_MIN = int(os.environ.get("CAFE_CMT_WATCH_MIN", "5"))   # 크롤 주기(분)
MAX_NEW_PER_RUN = int(os.environ.get("CAFE_CMT_WATCH_MAX", "5"))  # 한 번에 예약할 새 글 상한(폭주 방지)
# 제목에 키워드(업종)가 없는 글은 건너뛴다. 끄면(0) 등록 지역으로 폴백해 모든 새 글에 댓글.
#   예: '천안 이불 백화점…' 글에 '강남 누수탐지' 댓글이 달리는 어색함/봇 티 방지.
REQUIRE_KEYWORD = os.environ.get("CAFE_CMT_REQUIRE_KEYWORD", "1") != "0"
# 계정 간 시차(분) — 같은 글에 여러 계정이 동시에 달리면 티가 나므로 계정 순서대로 늦춘다.
#   n번째 계정 지연 = n × STAGGER_MIN ± JITTER. 기본 10±5 → 1번째 즉시, 2번째 5~15분, 3번째 15~25분.
STAGGER_MIN = float(os.environ.get("CAFE_CMT_STAGGER_MIN", "10"))
STAGGER_JITTER = float(os.environ.get("CAFE_CMT_STAGGER_JITTER", "5"))


def _log(m):
    print(f"[watch] {datetime.datetime.now():%H:%M:%S} {m}", flush=True)


def scrape_articles(page, cafe_url):
    """카페 홈을 새 탭에서 열어 최신글 (article_id, url, title) 목록을 수집. 로그인 필요 시 예외."""
    url = cafe_url.rstrip("/") + "#watch"    # #watch 마커 → 리스너 _connect 가 이 탭을 안 잡음
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    if "nid.naver.com" in (page.url or "") or "nidlogin" in (page.url or ""):
        raise RuntimeError("LOGIN_REQUIRED: 네이버 로그인 필요(크롬 9224)")
    js = """() => {
      const as=[...document.querySelectorAll('a[href*="/articles/"], a[href*="ArticleRead"], a[href*="articleid="]')];
      const seen=new Set(); const out=[];
      for(const a of as){ const h=a.href; const m=h.match(/articles\\/(\\d+)|articleid=?(\\d+)/); const id=m?(m[1]||m[2]):null;
        if(!id||seen.has(id))continue; seen.add(id); out.push({id:parseInt(id,10), url:h, title:(a.innerText||'').trim().slice(0,60)}); }
      return out;
    }"""
    found = {}
    for fr in page.frames:
        try:
            for r in fr.evaluate(js):
                aid = r["id"]
                # 제목 있는 항목 우선(사이드바 중복 링크 정리)
                if aid not in found or (r["title"] and not found[aid]["title"]):
                    found[aid] = r
        except Exception:
            continue
    return sorted(found.values(), key=lambda r: r["id"])


def process_watch(page, w, canon_acct=None):
    """감시 카페 1건 처리 — 새 글 감지 후 큐 적재. (예약 건수 반환)
    canon_acct: accounts.txt 로 검증된 정규 계정명(미등록이면 호출부에서 이미 걸러짐)."""
    cafe_url = w.get("cafe_url") or ""
    region = w.get("region") or ""
    keyword = w.get("keyword") or ""
    last_seen = w.get("last_seen_article_id")
    arts = scrape_articles(page, cafe_url)
    if not arts:
        _log(f"  글 목록 비어있음(스크랩 실패?): {cafe_url}")
        return 0
    max_id = max(a["id"] for a in arts)

    now = datetime.datetime.now().isoformat(timespec="seconds")
    # 첫 실행 → 기준선만 잡고 댓글 안 달기(기존 글 폭주 방지)
    if last_seen is None:
        cc.sb_patch("cafe_comment_watch", {"id": f"eq.{w['id']}"},
                    {"last_seen_article_id": max_id, "updated_at": now})
        _log(f"  기준선 설정(첫 실행): 최신 #{max_id} 까지 '이미 봄' 처리 — 댓글 안 달림. {cafe_url}")
        return 0

    news = sorted([a for a in arts if a["id"] > last_seen], key=lambda x: x["id"])
    if not news:
        return 0
    news = news[:MAX_NEW_PER_RUN]   # 폭주 방지 상한
    queued = 0
    last_body = None

    # 이 카페에 댓글 달 계정 목록.
    #   감시행에 account 가 지정돼 있으면 그 계정만, 비어 있으면 accounts.txt 의 '모든 계정'.
    #   → 새 글 하나당 계정 수만큼 댓글이 달린다(계정별 중복판정이라 계정당 1개씩).
    if w.get("account"):
        targets = [canon_acct]
    else:
        targets = [x["name"] for x in acct.load_accounts()]

    # ⚠️ 기준선은 '실제로 처리한 글'까지만 전진시킨다. 예약이 실패했는데 max_id 로 밀면
    #   그 글들은 영구히 기준선 아래로 내려가 다시는 댓글이 안 달린다(독립검증 M2·n17).
    advanced_to = last_seen
    aborted = False
    for a in news:
        # 제목에 키워드가 없는 글(업종 무관)은 건너뛴다 — 엉뚱한 지역/업종 댓글 방지.
        if REQUIRE_KEYWORD and keyword and keyword not in (a.get("title") or ""):
            _log(f"  ⏭ 키워드('{keyword}') 없는 글 — 건너뜀: #{a['id']} '{a.get('title','')[:22]}'")
            advanced_to = a["id"]
            continue
        # ★ 댓글의 지역은 '그 글 제목'에서 뽑는다(안양 글엔 '안양 누수탐지').
        #   제목에서 못 뽑으면 감시 카페에 등록한 지역으로 폴백.
        art_region = region_from_title(a.get("title", ""), keyword, region)
        for idx, tname in enumerate(targets):
            try:
                dup = cc.already_commented(a["url"], account=tname)
            except Exception as e:
                _log(f"  ⏸ 중복확인 실패 — 여기서 중단(기준선 유지, 다음 크롤 재시도): {str(e)[:90]}")
                aborted = True
                break
            if dup:
                continue
            # 계정마다 다른 문구가 나가도록 직전 문구를 피해 생성
            body = build_comment(art_region, keyword, avoid=last_body)
            last_body = body
            # 같은 글에 여러 계정이 동시에 달리면 티가 나므로 계정마다 시차를 둔다.
            #   n번째 계정 = 기준시각 + (n × STAGGER_MIN) ± 지터. 리스너가 이 시각 전엔 처리하지 않는다.
            delay = idx * STAGGER_MIN + random.uniform(-STAGGER_JITTER, STAGGER_JITTER)
            # astimezone(): 오프셋을 붙여 저장해야 DB(timestamptz)가 UTC 로 오해하지 않는다.
            when = datetime.datetime.now().astimezone() + datetime.timedelta(minutes=max(0.0, delay))
            try:
                cc.sb_insert("cafe_comment_queue", {
                    "article_url": a["url"], "body": body, "status": "pending",
                    "account": tname, "scheduled_at": when.isoformat(timespec="seconds"),
                })
                queued += 1
                _log(f"  ✅ 예약[{tname}] #{a['id']} {when:%H:%M} 지역='{art_region}' → \"{body[:18]}...\"")
            except Exception as e:
                _log(f"  ⏸ 예약 실패 #{a['id']} — 여기서 중단(기준선 유지): {str(e)[:90]}")
                aborted = True
                break
        if aborted:
            break
        advanced_to = a["id"]   # 예약 성공 또는 '이미 댓글 있음' 확인된 글까지만 전진
    if advanced_to != last_seen:
        cc.sb_patch("cafe_comment_watch", {"id": f"eq.{w['id']}"},
                    {"last_seen_article_id": advanced_to, "updated_at": now})
    return queued


def run_once(cdp_url=None):
    """감시 카페를 계정별로 묶어, 각 계정의 크롬(포트)으로 크롤한다.
    cdp_url 을 주면(단일 테스트용) 계정 구분 없이 그 브라우저 하나로만 돈다."""
    try:
        watches = cc.sb_get("cafe_comment_watch", {"enabled": "eq.true", "select": "*"})
    except Exception as e:
        _log(f"감시목록 조회 실패: {str(e)[:100]}"); return
    if not watches:
        _log("등록된 감시 카페 없음"); return

    # 계정별 그룹핑 — 계정마다 자기 크롬(로그인 세션)으로 크롤해야 한다.
    groups = {}
    for w in watches:
        key = (w.get("account") or "")
        groups.setdefault(key, []).append(w)

    total = 0
    with sync_playwright() as p:
        for acct_name, rows in groups.items():
            a = acct.find_account(acct_name)
            # B1: 감시행이 지정한 계정이 accounts.txt 에 없으면 기본 계정으로 크롤/예약하지 않는다
            #     (엉뚱한 아이디로 댓글이 달림). 등록할 때까지 이 그룹은 건너뜀.
            if a is None:
                _log(f"⚠️ 계정 미등록 '{acct_name}' — 감시 카페 {len(rows)}건 건너뜀 "
                     f"(accounts.txt 에 추가 후 run_chrome_login.bat {acct_name} 로 로그인)")
                continue
            url = cdp_url or ("http://127.0.0.1:%d" % a["port"])
            try:
                browser = p.chromium.connect_over_cdp(url)
            except Exception as e:
                _log(f"[{a['name']}:{a['port']}] 크롬 접속 실패(꺼짐?): {str(e)[:80]}")
                continue
            ctx = browser.contexts[0] if browser.contexts else browser.new_context()
            page = ctx.new_page()   # 별도 탭(리스너 작업탭 보존)
            try:
                for w in rows:
                    try:
                        total += process_watch(page, w, canon_acct=a["name"])
                    except Exception as e:
                        _log(f"  [{a['name']}] 카페 처리 오류({w.get('cafe_url')}): {str(e)[:100]}")
            finally:
                try:
                    page.close()
                except Exception:
                    pass
    if total:
        _log(f"이번 크롤: 새 글 {total}건 예약")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    # 기본 None = 감시행의 계정별 크롬으로 각각 접속(멀티계정). 값을 주면 그 브라우저 하나로만 크롤(테스트용).
    ap.add_argument("--cdp", default=None)
    args = ap.parse_args()
    if not cc.SUPABASE_URL or not cc.SUPABASE_KEY:
        print("SUPABASE_URL / SUPABASE_SERVICE_KEY 필요(../.env)", flush=True); sys.exit(1)
    if args.once:
        run_once(args.cdp); return
    _log(f"카페 새글 감시 시작 — 주기 {INTERVAL_MIN}분 — Ctrl+C 종료")
    while True:
        try:
            run_once(args.cdp)
        except Exception as e:
            _log(f"루프 오류: {str(e)[:100]}")
        time.sleep(INTERVAL_MIN * 60)


if __name__ == "__main__":
    main()
