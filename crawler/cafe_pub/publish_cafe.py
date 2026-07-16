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

# ── 셀렉터 (✅ 확정: 2026-07-16 SmartEditor ONE, cafe.naver.com/ca-fe 새 글쓰기) ──
SEL_TITLE = ['textarea.textarea_input', 'textarea[placeholder*="제목"]']
SEL_EDITOR = ['.se-content .se-text-paragraph', '.se-content', '.se-container [contenteditable="true"]', '[contenteditable="true"]']
SEL_IMG_BTN = ['button.se-image-toolbar-button', 'button[data-log="dot.img"]']
SEL_QUOTE_BTN = ['button[data-log="dot.quota"]', 'button.se-quotation-toolbar-button', 'button[data-name="quotation"]']
SEL_SUBMIT = ['a.BaseButton--skinGreen:has-text("등록")', 'a.BaseButton--skinGreen', 'button:has-text("등록")']

# 본문 마커 정규식 — "사진 N"(대괄호/「」 유무 허용), "부제목 : 내용"
IMG_MARK = re.compile(r'^\s*[「\[]?\s*사진\s*(\d+)\s*[」\]]?\s*$')
SUB_MARK = re.compile(r'^\s*부제목\s*[:：]\s*(.+?)\s*$')


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
    """매니페스트 → (이미지 로컬경로 리스트[순서], 본문텍스트, tmpdir). 이미지 상단·본문 하단 매니페스트든
    인터리브든, 이미지는 순서대로 모으고 본문(텍스트 블록)은 이어붙인다. 배치는 본문 마커로 결정."""
    tmp = tempfile.mkdtemp(prefix="cafepub_")
    images, texts = [], []
    for i, b in enumerate(manifest):
        if b.get("type") == "image":
            local = os.path.join(tmp, f"{i:02d}.jpg")
            if storage_download(b["path"], local):
                images.append(local)
            else:
                _log(f"  ! 이미지 다운로드 실패: {b['path']}")
        elif b.get("type") == "text":
            texts.append(b.get("text", ""))
    return images, "\n".join(texts), tmp


def parse_body_to_blocks(body, images):
    """본문을 렌더 블록으로 파싱: '사진 N'→그 위치에 images[N-1] 삽입, '부제목 : X'→인용구, 나머지→문단 텍스트.
    마커가 하나도 없으면 기존 방식(이미지 상단 일괄 + 본문)으로 폴백."""
    blocks, buf, used = [], [], set()

    def flush():
        if buf:
            text = "\n".join(buf).strip("\n")
            if text.strip():
                blocks.append({"type": "text", "text": text})
        buf.clear()

    for line in (body or "").splitlines():
        mi = IMG_MARK.match(line)
        ms = SUB_MARK.match(line)
        if mi:
            flush()
            n = int(mi.group(1))
            if 1 <= n <= len(images):
                blocks.append({"type": "image", "local": images[n - 1]})
                used.add(n - 1)
        elif ms:
            flush()
            blocks.append({"type": "quote", "text": ms.group(1).strip()})
        else:
            buf.append(line)
    flush()

    if not used:  # 마커 없음 → 기존 방식(이미지 상단 + 본문)
        return [{"type": "image", "local": im} for im in images] + \
               ([{"type": "text", "text": body}] if (body or "").strip() else [])
    # 마커에 안 잡힌 남은 이미지는 맨 끝에 붙임(사진 누락 방지)
    for i, im in enumerate(images):
        if i not in used:
            blocks.append({"type": "image", "local": im})
    return blocks


def _type_multiline(page, text):
    """여러 문단 텍스트를 줄바꿈(Enter) 유지하며 타이핑. 끝에 Enter 로 다음 블록을 새 문단에서 시작."""
    for i, ln in enumerate(text.split("\n")):
        if i:
            page.keyboard.press("Enter")
        if ln:
            page.keyboard.type(ln)
    page.keyboard.press("Enter")


def _insert_image_block(page, local):
    btn = _first(page, SEL_IMG_BTN, timeout=4000)
    if not btn:
        raise RuntimeError("사진 버튼 못 찾음 — --diag 로 SEL_IMG_BTN 확정 필요")
    with page.expect_file_chooser(timeout=8000) as fc:
        btn.click()
    fc.value.set_files(local)          # 한 장씩 → 순서 보장
    page.wait_for_timeout(1800)        # 업로드(비동기) 대기


# 인용구 변환용: 텍스트 컴포넌트(인용구 제외) 안에서 정확히 일치하는 문단의 중앙 좌표 반환.
_FIND_PARA_JS = """(txt) => {
  const paras=[...document.querySelectorAll('.se-component.se-text .se-text-paragraph')];
  const el=paras.find(p=>(p.innerText||'').trim()===txt);
  if(!el) return null;
  el.scrollIntoView({block:'center'});
  const r=el.getBoundingClientRect();
  return {x:r.x+r.width/2, y:r.y+r.height/2};
}"""


def _convert_paragraph_to_quote(page, subtitle):
    """1패스에서 일반 문단으로 써둔 '부제목'을 찾아 선택 → 인용구 버튼 → 빈 인용구에 부제목 타이핑.
    (인용구 버튼은 선택 문단을 인용구 블록으로 '치환'하고 커서를 그 안에 둔다 → 이웃 문단 보존)."""
    pos = page.evaluate(_FIND_PARA_JS, subtitle)
    if not pos:
        _log(f"  ! 부제목 문단 못찾음(인용구 변환 스킵): {subtitle[:18]}")
        return
    page.mouse.click(pos["x"], pos["y"]); page.wait_for_timeout(150)
    page.keyboard.press("Home"); page.keyboard.press("Shift+End"); page.wait_for_timeout(150)
    btn = _first(page, SEL_QUOTE_BTN, timeout=3000)
    if not btn:
        return  # 인용구 버튼 없으면 부제목을 일반 문단으로 둠(폴백)
    btn.click(); page.wait_for_timeout(500)
    page.keyboard.type(subtitle); page.wait_for_timeout(250)


def publish(page, title, blocks, no_send=False):
    """글쓰기 → 제목 + 본문 마커대로 인터리브. 2패스: (1) 텍스트/이미지 + 부제목을 일반문단으로 →
    (2) 부제목 문단을 인용구로 변환. 인용구는 커서를 가둬 키보드 탈출이 안 되므로 이 방식이 유일하게 안정적."""
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
    page.wait_for_timeout(300)
    # ── 1패스: 이미지=툴바+파일선택 / 부제목=일반문단(앵커) / 텍스트=타이핑 ──
    subtitles = []
    for b in blocks:
        if b["type"] == "text":
            _type_multiline(page, b["text"])
        elif b["type"] == "quote":
            page.keyboard.type(b["text"]); page.keyboard.press("Enter")  # 앵커(2패스에서 인용구화)
            subtitles.append(b["text"])
        else:
            _insert_image_block(page, b["local"])
        page.wait_for_timeout(200)
    # ── 2패스: 부제목 문단 → 인용구 변환 ──
    for sub in subtitles:
        _convert_paragraph_to_quote(page, sub)
    if no_send:
        _log(f"no_send: '등록' 직전까지 완료(사람이 확인 후 클릭). 인용구 {len(subtitles)}개 변환.")
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
    """큐 1건 발행 — 이미지 다운로드 + 본문 마커 파싱 → 인터리브 발행. (posted_url 또는 예외)"""
    images, body, tmp = _download_manifest(job.get("manifest") or [])
    blocks = parse_body_to_blocks(body, images)
    n_img = sum(1 for b in blocks if b["type"] == "image")
    n_q = sum(1 for b in blocks if b["type"] == "quote")
    _log(f"블록 파싱: 텍스트 {sum(1 for b in blocks if b['type']=='text')} · 이미지 {n_img} · 인용구 {n_q}")
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
