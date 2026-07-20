# -*- coding: utf-8 -*-
"""
네이버 카페 댓글 자동작성 — 핵심 엔진 (CDP 접속). cafe_pub/publish_cafe.py 구조를 '복사'해 자립.

[왜 복사인가] main 이 publish_cafe.py 를 자주 리팩터링한다(순위/발행 개선). cross-import 하면
  병합은 깨끗해도 런타임이 조용히 깨진다 → 이 파일은 publish_cafe 를 import 하지 않고 독립.
  (docs/MERGE-SAFETY.md 참고)

[왜 CDP 접속인가] Playwright가 띄운 크롬은 자동화 감지 → 캡차/2FA 반복.
  사람이 run_chrome_login.bat 로 1회 로그인(세션은 chrome_profile/), 이 스크립트는 CDP로 붙어서 조종.

[준비]
  1) run_chrome_login.bat → 네이버 로그인(최초 1회). ★발행(9223)과 별도 프로필/포트(9224).
  2) 평소: run_chrome.bat(헤드리스, 포트 9224) 실행 → 이 스크립트가 CDP로 접속.
  3) ../.env 의 SUPABASE_* 재사용. cafe_cmt/.env 에 댓글 설정(CAFE_CMT_*).

[사용]
  python comment_cafe.py --diag --url <글주소>       # 댓글창 구조 덤프(셀렉터 확정용)
  python comment_cafe.py --job <id> --no-send        # 큐 1건: 댓글 입력만(등록 직전까지)
  python comment_cafe.py --job <id>                  # 등록까지
  옵션: --cdp http://127.0.0.1:9224

⚠️ 댓글창 셀렉터(SEL_CMT_*)는 카페 UI 버전에 따라 다르다. 최초 1회 --diag 로 확정한 뒤 커밋.
"""
import argparse
import ctypes
import os
import re
import sys
import time
import json
import pathlib
import requests
from urllib.parse import unquote

from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
requests.packages.urllib3.disable_warnings()

import accounts as acct

HERE = os.path.dirname(os.path.abspath(__file__))
# 기본(첫 번째) 계정의 CDP. 멀티계정은 accounts.txt 참조 — acct.cdp_for(<계정명>).
DEFAULT_CDP = acct.cdp_for(None)         # 기본 9224 (발행 9223·카카오 9222와 분리)


# ── 환경(../.env SUPABASE + cafe_cmt/.env CAFE_CMT_*) ──
def _load_env():
    for p in [os.path.join(HERE, ".env"), os.path.join(HERE, "..", ".env")]:
        try:
            for line in pathlib.Path(p).read_text(encoding="utf-8", errors="ignore").splitlines():
                m = re.match(r'^([A-Z_]+)\s*=\s*"?([^"\n\r]+)"?', line)
                if m and m.group(1) not in os.environ:
                    os.environ[m.group(1)] = m.group(2).strip()
        except Exception:
            pass
_load_env()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
# ⚠️ _load_env() 뒤에서 읽어야 cafe_cmt/.env 설정이 반영된다(독립검증 m7).
#   account=계정별 1회 허용(여러 계정이 같은 글에 각각 1개) / global=글당 1개만.
DEDUP_SCOPE = os.environ.get("CAFE_CMT_DEDUP_SCOPE", "account").strip().lower()

# ── 셀렉터 (✅ 확정: 2026-07-16 ddmkt2 / cafe.naver.com/ca-fe 새 UI, --diag 로 확인) ──
#   댓글창=textarea.comment_inbox_text, 등록=a.button.btn_register (댓글 iframe 안). 나머지는 폴백.
SEL_CMT_BOX = [
    'textarea.comment_inbox_text',
    'textarea[placeholder*="댓글"]',
    '.CommentWriter textarea',
    '.comment_inbox textarea',
    '[contenteditable="true"][data-log*="comment"]',
]
SEL_CMT_SUBMIT = [
    'a.button.btn_register',
    'button.btn_register',
    'a:has-text("등록")',
    'button:has-text("등록")',
]


def _log(m):
    print(f"[cafe_cmt] {m}", flush=True)


def _headers():
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"}


def sb_get(path, params=None):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=_headers(), params=params, timeout=30, verify=False)
    r.raise_for_status()
    return r.json()


def sb_patch(path, params, payload):
    requests.patch(f"{SUPABASE_URL}/rest/v1/{path}", headers={**_headers(), "Prefer": "return=minimal"},
                   params=params, data=json.dumps(payload), timeout=30, verify=False)


def sb_insert(path, payload):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{path}", headers={**_headers(), "Prefer": "return=minimal"},
                      data=json.dumps(payload), timeout=30, verify=False)
    r.raise_for_status()
    return r


def article_key(url):
    """글 식별 키 = 카페 글 번호(articleid/…/articles/N). URL 형식(구주소·iframe·ca-fe)이 달라도
    같은 글이면 같은 키가 나오도록 정규화. 중복 댓글 방지에 사용."""
    u = url or ""
    for _ in range(2):   # iframe_url_utf8 은 이중 인코딩 → 두 번 디코드
        u = unquote(u)
    m = (re.search(r'articleid=(\d+)', u)
         or re.search(r'/articles/(\d+)', u)
         # 단축형 cafe.naver.com/<카페명>/<글번호> (ca-fe/cafes 경로는 위에서 이미 처리)
         or re.search(r'cafe\.naver\.com/[^/?#]+/(\d+)(?:[/?#]|$)', u))
    return m.group(1) if m else (url or "").strip()


def already_commented(url, exclude_id=None, account=None):
    """이 글에 이미 (완료/처리중) 댓글 잡이 있으면 True — 중복 댓글 방지.

    DEDUP_SCOPE=account(기본): '같은 계정'이 같은 글에 두 번 달지 못하게만 막는다
      → 계정이 여러 개면 계정마다 1개씩 달릴 수 있음(멀티계정 마케팅 용도).
    DEDUP_SCOPE=global      : 계정 불문 글당 댓글 1개만 허용.
    """
    key = article_key(url)
    if not key:
        return False
    params = {
        "status": "in.(done,processing)", "select": "id,article_url,account",
        "order": "created_at.desc", "limit": "500",
    }
    if DEDUP_SCOPE != "global":
        # 계정별 판정. ⚠️ 웹 수동예약은 account=null, 워처 예약은 계정명이 들어가는데
        #   둘 다 '기본 계정'이면 같은 아이디다 → null 과 기본계정명을 한 묶음으로 봐야
        #   같은 아이디가 한 글에 두 번 다는 걸 막는다(독립검증 M5).
        canon = acct.canonical_name(account)
        if canon and canon == acct.default_account()["name"]:
            params["or"] = f"(account.is.null,account.eq.{canon})"
        elif canon:
            params["account"] = f"eq.{canon}"
        else:
            params["account"] = "is.null"
    try:
        rows = sb_get("cafe_comment_queue", params)
    except Exception as e:
        # ⚠️ 조회 실패를 '중복 없음'으로 취급하면 마이그레이션 전에 중복 댓글이 쏟아진다.
        #   호출부가 판단하도록 올린다(독립검증 M2).
        raise RuntimeError(f"DEDUP_QUERY_FAILED: {str(e)[:120]}")
    for r in rows:
        if exclude_id and r.get("id") == exclude_id:
            continue
        if article_key(r.get("article_url", "")) == key:
            return True
    return False


def _focus_naver_window():
    """디버깅 크롬 창을 맨 앞으로(에디터/입력 안정). cafe_pub 와 동일 트릭."""
    try:
        u = ctypes.windll.user32
        targets = []
        EP = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

        def cb(h, _l):
            if u.IsWindowVisible(h):
                n = u.GetWindowTextLengthW(h)
                if n:
                    buf = ctypes.create_unicode_buffer(n + 1)
                    u.GetWindowTextW(h, buf, n + 1)
                    if ("네이버" in buf.value) or ("카페" in buf.value) or ("NAVER" in buf.value):
                        targets.append(h)
            return True

        u.EnumWindows(EP(cb), 0)
        if not targets:
            return False
        h = targets[0]
        u.keybd_event(0x12, 0, 0, 0); u.keybd_event(0x12, 0, 2, 0)
        fg = u.GetForegroundWindow()
        t1 = u.GetWindowThreadProcessId(fg, 0); t2 = u.GetWindowThreadProcessId(h, 0)
        u.AttachThreadInput(t1, t2, True)
        u.ShowWindow(h, 9); u.BringWindowToTop(h); u.SetForegroundWindow(h)
        u.AttachThreadInput(t1, t2, False)
        return True
    except Exception:
        return False


def _box_text(box):
    """댓글창 현재 텍스트를 타입 안전하게 읽는다. <textarea/input> → input_value,
    contenteditable → inner_text. 둘 다 못 읽으면 None(=확인 불가, 성공으로 오판 금지)."""
    try:
        return box.input_value()
    except Exception:
        pass
    try:
        return box.inner_text()
    except Exception:
        return None


def _connect(p, cdp_url):
    browser = p.chromium.connect_over_cdp(cdp_url)
    ctx = browser.contexts[0] if browser.contexts else browser.new_context()
    # keep_alive.py 가 잠깐 여는 확인용 탭(#keepalive 마커)은 작업 탭으로 오인·선택하지 않는다.
    pages = [pg for pg in ctx.pages if "naver.com" in (pg.url or "") and "keepalive" not in (pg.url or "")]
    page = pages[0] if pages else (ctx.pages[0] if ctx.pages else ctx.new_page())
    try:
        page.bring_to_front()
    except Exception:
        pass
    return page


def _find_in_frames(page, selectors, timeout=4000):
    """댓글창은 iframe(cafe_main) 안에 있을 수 있음 → 모든 프레임에서 후보 셀렉터를 탐색.
    (프레임, 로케이터) 반환. 없으면 (None, None)."""
    deadline = time.time() + timeout / 1000.0
    while time.time() < deadline:
        for fr in page.frames:
            for s in selectors:
                try:
                    loc = fr.locator(s).first
                    if loc.count() and loc.is_visible():
                        return fr, loc
                except Exception:
                    continue
        page.wait_for_timeout(300)
    return None, None


def _goto_article(page, url):
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    if re.search(r"nid\.naver\.com|nidlogin", page.url or ""):
        raise RuntimeError("LOGIN_REQUIRED: 네이버 로그인 필요 — 크롬 9224 에서 로그인하세요")


def diag(page, url):
    """대상 글의 댓글 영역 구조 덤프 — 셀렉터 확정용."""
    if url:
        _goto_article(page, url)
    _log(f"URL: {page.url}")
    _log(f"frame 수: {len(page.frames)}")
    for f in page.frames:
        _log(f"  frame: {(f.url or '')[:90]}")
    js = """() => {
      const pick = (sel) => [...document.querySelectorAll(sel)].slice(0,10).map(e=>({t:e.tagName,c:(e.className||'').toString().slice(0,60),ph:e.getAttribute('placeholder')||'',txt:(e.innerText||'').slice(0,16)}));
      return { textareas: pick('textarea'), buttons: pick('button,a[role=button],a.button'), editable: pick('[contenteditable=true]') };
    }"""
    for fr in page.frames:
        try:
            info = fr.evaluate(js)
            if info["textareas"] or info["editable"]:
                _log(f"[frame {(fr.url or '')[:50]}] textarea: " + json.dumps(info["textareas"], ensure_ascii=False))
                _log(f"[frame {(fr.url or '')[:50]}] 등록버튼후보: " + json.dumps([b for b in info["buttons"] if "등록" in (b.get("txt") or "")], ensure_ascii=False))
        except Exception:
            continue


def write_comment(page, url, body, no_send=False):
    """대상 글로 이동 → 댓글창에 body 입력 → (등록). posted_url 또는 예외."""
    _goto_article(page, url)
    _focus_naver_window()
    fr, box = _find_in_frames(page, SEL_CMT_BOX, timeout=6000)
    if not box:
        raise RuntimeError("댓글 입력창 못 찾음 — --diag 로 SEL_CMT_BOX 확정 필요")
    try:
        box.scroll_into_view_if_needed()
    except Exception:
        pass
    box.click()
    page.wait_for_timeout(200)
    # textarea 는 fill, contenteditable 은 type 로 입력
    try:
        box.fill(body)
    except Exception:
        page.keyboard.type(body)
    page.wait_for_timeout(300)
    if no_send:
        _log("no_send: 댓글 입력만 완료(사람이 '등록' 클릭).")
        return None
    # 등록 버튼(같은 프레임 우선 → 페이지 전체)
    sub = None
    for s in SEL_CMT_SUBMIT:
        try:
            loc = (fr or page).locator(s).first
            if loc.count() and loc.is_visible():
                sub = loc; break
        except Exception:
            continue
    if not sub:
        _, sub = _find_in_frames(page, SEL_CMT_SUBMIT, timeout=3000)
    if not sub:
        raise RuntimeError("댓글 등록 버튼 못 찾음 — --diag 로 SEL_CMT_SUBMIT 확정 필요")
    alerts = []
    page.on("dialog", lambda d: (alerts.append(d.message), d.dismiss()))
    sub.click()
    # 검증: 등록 성공 시 입력창이 '비워진다'. 단 입력했던 내용이 실제로 사라진 것만 성공으로 인정.
    #   input_value()/inner_text() 를 못 읽으면(contenteditable·detach) None → 성공으로 오판하지 않고 계속 대기.
    #   (오판 성공은 '등록 안 됐는데 완료 처리'라 오판 실패보다 위험 → 확인 불가는 성공으로 치지 않음)
    confirmed = False
    for _ in range(20):
        page.wait_for_timeout(400)
        cur = _box_text(box)
        if cur is not None and cur.strip() == "":
            confirmed = True
            break
    if confirmed:
        return page.url
    hint = f"(alert: {alerts[-1]})" if alerts else "(등록 미확정 — 입력창 비워짐 확인 불가)"
    raise RuntimeError(f"댓글 등록 확인 실패 {hint}")


def comment_job(job, cdp_url=DEFAULT_CDP, no_send=False):
    """큐 1건 처리 — 대상 글에 댓글 작성. (posted_url 또는 예외)"""
    url = job.get("article_url") or ""
    body = job.get("body") or ""
    if not url or not body:
        raise RuntimeError("article_url/body 누락")
    _log(f"댓글 처리: {url[:60]} — {body[:20]}...")
    with sync_playwright() as p:
        page = _connect(p, cdp_url)
        return write_comment(page, url, body, no_send=no_send)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--diag", action="store_true")
    ap.add_argument("--url", help="댓글 달 글 주소(diag/단건 테스트)")
    ap.add_argument("--job", help="cafe_comment_queue id")
    ap.add_argument("--no-send", action="store_true")
    ap.add_argument("--cdp", default=DEFAULT_CDP)
    args = ap.parse_args()
    if args.diag:
        with sync_playwright() as p:
            diag(_connect(p, args.cdp), args.url)
        return
    if args.job:
        rows = sb_get("cafe_comment_queue", {"id": f"eq.{args.job}", "select": "*"})
        if not rows:
            _log("해당 job 없음"); return
        out = comment_job(rows[0], args.cdp, no_send=args.no_send)
        _log(f"완료: {out or '(no_send)'}")
        return
    _log("사용: --diag --url <글주소>  |  --job <id> [--no-send]")


if __name__ == "__main__":
    main()
