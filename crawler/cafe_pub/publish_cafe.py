# -*- coding: utf-8 -*-
"""
네이버 카페 자동발행 — 핵심 엔진 (CDP 접속, 카카오 send_biz 구조 복제).

[왜 CDP 접속인가] 카카오와 동일. Playwright가 띄운 크롬은 자동화 감지 → 캡차/2FA 반복.
  사람이 run_chrome_login.bat 로 1회 로그인(세션은 chrome_profile/), 이 스크립트는 CDP로 '붙어서' 조종.

[준비]
  1) run_chrome_login.bat → 네이버 로그인(최초 1회)
  2) 평소: run_chrome.bat(헤드리스) 실행 → 이 스크립트가 CDP(포트 9223)로 접속
  3) cafe_pub/.env 에 CAFE_WRITE_URL 설정(카페 글쓰기 페이지 주소). ../.env 의 SUPABASE_* 재사용.

[사용]
  python publish_cafe.py --diag                 # 글쓰기 페이지 구조 덤프(셀렉터 확정용)
  python publish_cafe.py --job <id> --no-send   # 큐의 특정 건을 '등록' 직전까지만(수동보조/Phase1)
  python publish_cafe.py --job <id>             # 발행(등록 클릭)까지
  옵션: --cdp http://127.0.0.1:9223

⚠️ 스마트에디터(SmartEditor ONE) 셀렉터는 카페마다/버전마다 달라 --diag 로 1회 확정 필요.
   아래 SEL_* 후보를 diag 결과로 맞춘 뒤 커밋. (send_biz.py 처럼 '확인일자' 주석 유지)
"""
import argparse
import ctypes
import os
import re
import sys
import time
import json
import tempfile
import pathlib
import requests

from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
requests.packages.urllib3.disable_warnings()

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CDP = "http://127.0.0.1:9223"
CAFE_BUCKET = "cafe-images"

# ── 환경(../.env SUPABASE + cafe_pub/.env CAFE_WRITE_URL) ──
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
CAFE_WRITE_URL = os.environ.get("CAFE_WRITE_URL", "")  # 카페 글쓰기 페이지 주소

# ── 셀렉터 후보 (⚠️ --diag 로 확정 필요) ──
SEL_TITLE = ['input[placeholder*="제목"]', 'textarea[placeholder*="제목"]', '.se_title input', '.ArticleTitle input']
SEL_EDITOR = ['.se-content [contenteditable="true"]', '.se-container [contenteditable="true"]', 'div.se-text-paragraph', 'iframe#se2_iframe']
SEL_IMG_BTN = ['button[data-name="image"]', '.se-toolbar-item-image button', 'button[data-log="ime.image"]', 'button:has-text("사진")']
SEL_SUBMIT = ['a:has-text("등록")', 'button:has-text("등록")', '.BaseButton--skinGreen', 'a.btn_register']


def _log(m):
    print(f"[cafe_pub] {m}", flush=True)


def _headers():
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"}


def sb_get(path, params=None):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=_headers(), params=params, timeout=30, verify=False)
    r.raise_for_status()
    return r.json()


def sb_patch(path, params, payload):
    requests.patch(f"{SUPABASE_URL}/rest/v1/{path}", headers={**_headers(), "Prefer": "return=minimal"},
                   params=params, data=json.dumps(payload), timeout=30, verify=False)


def storage_download(path, dest):
    r = requests.get(f"{SUPABASE_URL}/storage/v1/object/{CAFE_BUCKET}/{path}", headers=_headers(), timeout=120, verify=False)
    if not r.ok:
        return None
    pathlib.Path(dest).write_bytes(r.content)
    return dest


def _focus_naver_window():
    """디버깅 크롬 창을 맨 앞으로(파일 선택창·에디터 안정). 카카오 _focus 와 동일 트릭."""
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


def _connect(p, cdp_url):
    browser = p.chromium.connect_over_cdp(cdp_url)
    ctx = browser.contexts[0] if browser.contexts else browser.new_context()
    pages = [pg for pg in ctx.pages if "naver.com" in (pg.url or "")]
    page = pages[0] if pages else (ctx.pages[0] if ctx.pages else ctx.new_page())
    try:
        page.bring_to_front()
    except Exception:
        pass
    return page


def _first(page, selectors, timeout=4000):
    """후보 셀렉터 중 먼저 보이는 것 반환(없으면 None)."""
    for s in selectors:
        try:
            loc = page.locator(s).first
            loc.wait_for(state="visible", timeout=timeout)
            return loc
        except Exception:
            continue
    return None


def diag(page):
    """글쓰기 페이지 구조 덤프 — 셀렉터 확정용."""
    if CAFE_WRITE_URL:
        page.goto(CAFE_WRITE_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
    _log(f"URL: {page.url}")
    _log(f"iframe 수: {len(page.frames)}")
    for f in page.frames:
        _log(f"  frame: {f.url[:90]}")
    js = """() => {
      const pick = (sel) => [...document.querySelectorAll(sel)].slice(0,8).map(e=>({t:e.tagName,c:(e.className||'').toString().slice(0,50),ph:e.getAttribute('placeholder')||'',txt:(e.innerText||'').slice(0,20)}));
      return {
        inputs: pick('input,textarea'),
        buttons: pick('button,a[role=button],a.btn'),
        editable: pick('[contenteditable=true]'),
      };
    }"""
    try:
        info = page.evaluate(js)
        _log("입력칸: " + json.dumps(info["inputs"], ensure_ascii=False))
        _log("버튼: " + json.dumps(info["buttons"], ensure_ascii=False))
        _log("에디터(contenteditable): " + json.dumps(info["editable"], ensure_ascii=False))
    except Exception as e:
        _log(f"diag 평가 오류: {e}")


def _download_manifest(manifest):
    """매니페스트 이미지 블록을 임시폴더로 다운로드(순서 유지). → [{type,image path/local} | {type,text}]"""
    tmp = tempfile.mkdtemp(prefix="cafepub_")
    blocks = []
    for i, b in enumerate(manifest):
        if b.get("type") == "image":
            local = os.path.join(tmp, f"{i:02d}.jpg")
            if storage_download(b["path"], local):
                blocks.append({"type": "image", "local": local})
            else:
                _log(f"  ! 이미지 다운로드 실패: {b['path']}")
        elif b.get("type") == "text":
            blocks.append({"type": "text", "text": b.get("text", "")})
    return blocks, tmp


def publish(page, title, blocks, no_send=False):
    """글쓰기 → 제목 + (이미지 순서대로 + 본문) 삽입 → (no_send 아니면) 등록. 성공 시 URL 반환/실패 시 예외."""
    if CAFE_WRITE_URL:
        page.goto(CAFE_WRITE_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
    _focus_naver_window()
    # 제목
    t = _first(page, SEL_TITLE, timeout=6000)
    if not t:
        raise RuntimeError("제목 입력칸 못 찾음 — --diag 로 SEL_TITLE 확정 필요")
    t.click(); t.fill(title)
    # 에디터 포커스
    ed = _first(page, SEL_EDITOR, timeout=6000)
    if not ed:
        raise RuntimeError("에디터 영역 못 찾음 — --diag 로 SEL_EDITOR 확정 필요")
    ed.click()
    # 블록 순서대로: 이미지=툴바 버튼+파일선택 / 텍스트=타이핑
    for b in blocks:
        if b["type"] == "text":
            page.keyboard.type(b["text"])
            page.keyboard.press("Enter")
        else:
            btn = _first(page, SEL_IMG_BTN, timeout=4000)
            if not btn:
                raise RuntimeError("사진 버튼 못 찾음 — --diag 로 SEL_IMG_BTN 확정 필요")
            with page.expect_file_chooser(timeout=8000) as fc:
                btn.click()
            fc.value.set_files(b["local"])  # 한 장씩 → 순서 보장
            page.wait_for_timeout(1800)     # 업로드(비동기) 대기
        page.wait_for_timeout(300)
    if no_send:
        _log("no_send: '등록' 직전까지 완료(사람이 확인 후 클릭).")
        return None
    sub = _first(page, SEL_SUBMIT, timeout=6000)
    if not sub:
        raise RuntimeError("등록 버튼 못 찾음 — --diag 로 SEL_SUBMIT 확정 필요")
    before = page.url
    sub.click()
    # 발행 검증: URL 이 글 상세로 바뀌면 성공
    for _ in range(20):
        page.wait_for_timeout(500)
        if page.url != before and "/write" not in page.url:
            return page.url
    raise RuntimeError("등록 후 이동 확인 실패(발행 미확정)")


def publish_job(job, cdp_url=DEFAULT_CDP, no_send=False):
    """큐 1건 발행 — 매니페스트 다운로드 → publish. (posted_url 또는 예외)"""
    blocks, tmp = _download_manifest(job.get("manifest") or [])
    with sync_playwright() as p:
        page = _connect(p, cdp_url)
        return publish(page, job.get("title") or "제목", blocks, no_send=no_send)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--diag", action="store_true")
    ap.add_argument("--job", help="cafe_publish_queue id")
    ap.add_argument("--no-send", action="store_true")
    ap.add_argument("--cdp", default=DEFAULT_CDP)
    args = ap.parse_args()
    if args.diag:
        with sync_playwright() as p:
            diag(_connect(p, args.cdp))
        return
    if args.job:
        rows = sb_get("cafe_publish_queue", {"id": f"eq.{args.job}", "select": "*"})
        if not rows:
            _log("해당 job 없음"); return
        url = publish_job(rows[0], args.cdp, no_send=args.no_send)
        _log(f"완료: {url or '(no_send)'}")
        return
    _log("사용: --diag  |  --job <id> [--no-send]")


if __name__ == "__main__":
    main()
