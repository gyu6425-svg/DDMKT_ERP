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
import random
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
# 등록 클릭 후 글 상세로 이동했는지 확인하는 시간(초). 느린 카페에서 12초는 짧아 오탐이 났다.
CAFE_CONFIRM_SEC = int(os.environ.get("CAFE_CONFIRM_SEC", "60"))


class PostClickError(RuntimeError):
    """등록 클릭 이후(또는 직전 posted 마킹 이후)의 오류.
    글이 이미 올라갔을 수 있으므로 리스너는 이걸 '절대 재시도하지 않는다'(중복 발행 방지)."""


class ContentError(RuntimeError):
    """원고 자체 결함(빈 본문·제목 없음·사진 마커 초과 등) — 재시도해도 소용없음. 발행 전 중단."""


class BoardError(RuntimeError):
    """게시판을 정확히 고르지 못함 — 엉뚱한 게시판 발행을 막기 위해 등록 전 중단."""

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
CAFE_BOARD = os.environ.get("CAFE_BOARD", "누수")       # 게시판(메뉴) 이름 — 등록 필수

# ── 셀렉터 (✅ 확정: 2026-07-16 SmartEditor ONE, cafe.naver.com/ca-fe 새 글쓰기) ──
SEL_TITLE = ['textarea.textarea_input', 'textarea[placeholder*="제목"]']
SEL_EDITOR = ['.se-content .se-text-paragraph', '.se-content', '.se-container [contenteditable="true"]', '[contenteditable="true"]']
SEL_IMG_BTN = ['button.se-image-toolbar-button', 'button[data-log="dot.img"]']
SEL_QUOTE_BTN = ['button[data-log="dot.quota"]', 'button.se-quotation-toolbar-button', 'button[data-name="quotation"]']
SEL_SUBMIT = ['a.BaseButton--skinGreen:has-text("등록")', 'a.BaseButton--skinGreen', 'button:has-text("등록")']
# 링크 썸네일 카드(OG) + 하단 태그칩 — ✅ 확정 2026-07-16
SEL_LINK_BTN = 'button[data-log="dot.link"]'          # se-oglink-toolbar-button "링크 추가"
SEL_LINK_INPUT = 'input.se-popup-oglink-input'        # "URL을 입력하세요."
SEL_LINK_SEARCH = 'button.se-popup-oglink-button'     # "검색"(OG 정보 조회)
SEL_LINK_CONFIRM = 'button.se-popup-button-confirm'   # "확인"(카드 삽입)
SEL_TAG_INPUT = 'input.tag_input'                     # "태그를 입력해주세요 (최대 10개)"
# 작성 시간 하한(초) — 너무 빨리 쓰면 상위노출 불리하다는 판단 → 페이싱으로 최소 이 시간 확보
CAFE_MIN_SECONDS = int(os.environ.get("CAFE_MIN_SECONDS", "330"))
# 상한 — 글마다 MIN~MAX 사이에서 새로 뽑아 작성 시간을 불규칙하게 한다(매번 같은 소요시간은 봇 티가 남).
#   미설정이면 MIN 과 같아 기존처럼 고정(하위호환).
CAFE_MAX_SECONDS = int(os.environ.get("CAFE_MAX_SECONDS", str(CAFE_MIN_SECONDS)))


def _write_seconds():
    """이 글을 쓰는 데 쓸 목표 시간(초) — MIN~MAX 랜덤."""
    lo, hi = min(CAFE_MIN_SECONDS, CAFE_MAX_SECONDS), max(CAFE_MIN_SECONDS, CAFE_MAX_SECONDS)
    return random.uniform(lo, hi) if hi > lo else float(lo)


# 테스트용 고속 모드 — 사람 흉내(멈칫·블록 페이싱)를 끄고 키 딜레이를 줄인다.
#   ⚠️ 실제 발행에는 쓰지 말 것(몇 초 만에 2,000자면 봇으로 보인다).
#   ⚠️ 딜레이 0 은 금지. 2026-07-20 테스트에서 스마트에디터가 입력을 못 따라와
#      문단끼리 글자가 교차되며 본문이 완전히 깨졌다("회사"→"회는사"). 최소값을 둔다.
CAFE_FAST = os.environ.get("CAFE_FAST", "0") == "1"
CAFE_FAST_DELAY = max(8, int(os.environ.get("CAFE_FAST_DELAY", "15")))


def _kd():
    """사람 같은 키 입력 딜레이(ms) — 줄마다 다르게. 고속 모드면 짧은 고정값."""
    return CAFE_FAST_DELAY if CAFE_FAST else random.randint(38, 95)


# 오타→백스페이스 연출이 일어날 줄의 비율. 실제 사람은 정타만 쭉 치지 않는다.
#   ⚠️ 기본값 0 = 꺼짐. 2026-07-20 실발행 테스트에서 본문 45자가 통째로 사라졌다.
#   가짜 키보드 시뮬레이션에서는 400/400 일치했지만, 스마트에디터는 한글 조합(IME)과
#   자동 리렌더가 있어 '친 글자 수 = 지울 글자 수'가 성립하지 않는다.
#   글이 조용히 잘리는 것이 기계처럼 보이는 것보다 나쁘므로, 원인을 잡기 전까지 끈다.
#   (다시 켜려면 CAFE_TYPO_RATE=0.2. 켜면 반드시 발행 후 본문 대조를 할 것.)
CAFE_TYPO_RATE = float(os.environ.get("CAFE_TYPO_RATE", "0"))
# 지웠다 쓸 때 잠깐 보였다 사라지는 글자들 — 어차피 전부 지우므로 내용은 무의미.
_TYPO_CHARS = "ㅁㄴㅇㄹ아어이오우그느다드르"


def _typo_burst(page):
    """군더더기 글자를 몇 개 더 쳤다가 Backspace 로 전부 지운다.
    친 만큼만 지우므로 최종 본문은 원본과 동일하다(가감 합 0)."""
    n = random.randint(1, 3)
    page.keyboard.type("".join(random.choice(_TYPO_CHARS) for _ in range(n)), delay=_kd())
    page.wait_for_timeout(random.randint(120, 380))   # "어, 오타네" 알아채는 순간
    for _ in range(n):
        page.keyboard.press("Backspace")
        page.wait_for_timeout(random.randint(45, 110))


def _type_human(page, ln):
    """한 줄을 사람처럼 타이핑 — 가끔 오타 냈다 지우고 다시 정타.
    지우는 건 방금 친 군더더기뿐이라 결과 텍스트는 ln 그대로다."""
    if len(ln) < 12 or random.random() >= CAFE_TYPO_RATE:
        page.keyboard.type(ln, delay=_kd())
        return
    n_ev = random.randint(1, 2) if len(ln) >= 40 else 1
    cuts = sorted(random.sample(range(5, len(ln) - 3), n_ev))   # 줄 맨앞/맨뒤는 피함
    pos = 0
    for c in cuts:
        page.keyboard.type(ln[pos:c], delay=_kd())
        _typo_burst(page)
        pos = c
    page.keyboard.type(ln[pos:], delay=_kd())

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


def sb_patch(path, params, payload, expect=None, ret=False):
    """PATCH. expect 를 주면 status=eq.<expect> 조건부(compare-and-set)로 바꾼다.
      · expect/ret 이면 return=representation 으로 '실제 바뀐 행'을 돌려준다. 빈 리스트 = 조건 불일치(내가 못 이김).
      · expect/ret 일 때만 raise_for_status — 잠금·등록직전 patch 의 실패는 삼키면 안 되기 때문.
        (에러 기록용 patch 는 expect 없이 호출 → 예전처럼 조용히 실패해도 원래 오류를 가리지 않는다.)
    ⚠️ 단수 Accept(application/vnd.pgrst.object)를 쓰면 0행일 때 406 이 나므로 절대 쓰지 않는다(배열 응답 유지)."""
    p = dict(params)
    if expect is not None:
        p["status"] = f"eq.{expect}"
    representation = ret or expect is not None
    prefer = "return=representation" if representation else "return=minimal"
    r = requests.patch(f"{SUPABASE_URL}/rest/v1/{path}", headers={**_headers(), "Prefer": prefer},
                       params=p, data=json.dumps(payload), timeout=30, verify=False)
    if representation:
        r.raise_for_status()
        return r.json()
    return None


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
    links, tags = [], []                       # 링크는 여러 개(카카오톡·홈페이지) → 순서대로 카드 삽입
    board = None                               # 없으면 CAFE_BOARD 환경변수로 폴백(기존 동작 유지)
    for i, b in enumerate(manifest):
        if b.get("type") == "image":
            local = os.path.join(tmp, f"{i:02d}.jpg")
            if storage_download(b["path"], local):
                images.append(local)
            else:
                _log(f"  ! 이미지 다운로드 실패: {b['path']}")
        elif b.get("type") == "text":
            texts.append(b.get("text", ""))
        elif b.get("type") == "link":
            if b.get("url"):
                links.append(b["url"])         # 본문 끝에 썸네일 카드로 삽입(여러 개면 순서대로)
        elif b.get("type") == "tags":
            tags = b.get("tags") or []         # 에디터 태그칸(하단 태그칩)
        elif b.get("type") == "board":
            board = b.get("name") or None      # 업체마다 다른 게시판 — 작업별로 지정
    return images, "\n".join(texts), tmp, links, tags, board


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
            sub = re.sub(r'^(?:부제목\s*[:：]\s*)+', '', ms.group(1)).strip()  # 모델이 '부제목 :' 중복 출력해도 제거
            blocks.append({"type": "quote", "text": sub})
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


def _norm_lines(text):
    """빈 줄(문단 간격)은 살리되 연속 빈 줄은 1개로, 양끝 빈 줄은 제거."""
    out, prev_blank = [], True  # prev_blank=True 로 시작 → 선행 빈 줄 제거
    for ln in (text or "").split("\n"):
        blank = not ln.strip()
        if blank and prev_blank:
            continue
        out.append("" if blank else ln)
        prev_blank = blank
    while out and out[-1] == "":
        out.pop()
    return out


def _inject_spacing(blocks):
    """이미지 앞뒤에 빈 문단(blank) 삽입 — 사진과 글이 붙지 않게. 연속 blank 중복 제거 + 양끝 strip."""
    out = []
    for b in blocks:
        if b["type"] == "image":
            if out and out[-1]["type"] != "blank":
                out.append({"type": "blank"})
            out.append(b)
            out.append({"type": "blank"})
        else:
            if b["type"] == "blank" and out and out[-1]["type"] == "blank":
                continue
            out.append(b)
    while out and out[0]["type"] == "blank":
        out.pop(0)
    while out and out[-1]["type"] == "blank":
        out.pop()
    return out


def _type_multiline(page, text):
    """여러 문단 텍스트를 타이핑. 문단 사이 빈 줄(띄어쓰기)은 그대로 유지(2번 사진 스타일).
    사람 같은 키 딜레이(줄마다 다름)로 천천히 — 너무 빠른 작성 회피."""
    lines = _norm_lines(text)
    for i, ln in enumerate(lines):
        if i:
            page.keyboard.press("Enter")
            if not CAFE_FAST and random.random() < 0.25:
                page.wait_for_timeout(random.randint(400, 1500))  # 다음 문장 생각하는 멈칫
        if ln:
            _type_human(page, ln)
    page.keyboard.press("Enter")


def _insert_image_block(page, local):
    last_err = None
    for attempt in range(3):           # 파일선택창이 가끔 안 뜸(포커스/타이밍) → 재시도
        btn = _first(page, SEL_IMG_BTN, timeout=4000)
        if not btn:
            raise RuntimeError("사진 버튼 못 찾음 — --diag 로 SEL_IMG_BTN 확정 필요")
        try:
            with page.expect_file_chooser(timeout=10000) as fc:
                btn.click()
            fc.value.set_files(local)  # 한 장씩 → 순서 보장
            page.wait_for_timeout(1800)  # 업로드(비동기) 대기
            return
        except Exception as e:
            last_err = e
            _log(f"  파일선택창 재시도({attempt + 1}/3) — 창 포커스 후")
            _focus_naver_window()
            page.wait_for_timeout(700)
    raise last_err


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


# ── 문단 서식 (✅ 확인 2026-07-20) — 문단을 선택해야 속성 툴바가 나타난다 ──
SEL_FONT_BTN = 'button[data-log="prt.font"]'      # 서체 변경
SEL_COLOR_BTN = 'button[data-log="prt.color"]'    # 글자색(팔레트 항목 title="#rrggbb")
# ⚠️ 팔레트에 실제로 있는 값만 쓸 수 있다. 없는 색을 넣으면 클릭이 타임아웃난다.
#   확인 2026-07-20(72색). 파랑 계열: #0078cb(진한 파랑) · #0095e9 · #004e82(남색) · #00b3f2(밝은 파랑)
CAFE_Q_COLOR = os.environ.get("CAFE_Q_COLOR", "#0078cb")   # FAQ 질문(Q.) 줄 글자색
# 서체 변경은 사용자 요청(2026-07-20)으로 사용하지 않는다 — 도입부는 문단 나눔만 한다.


def _find_and_select(page, text):
    """본문 문단 중 innerText 가 정확히 일치하는 것을 찾아 전체 선택.
    _FIND_PARA_JS 는 '요소'가 아니라 화면 좌표 {x,y} 를 돌려준다 — 인용구 변환과 같은 방식으로 클릭한다."""
    pos = page.evaluate(_FIND_PARA_JS, text)
    if not pos:
        return False
    page.mouse.click(pos["x"], pos["y"]); page.wait_for_timeout(200)
    page.keyboard.press("Home"); page.keyboard.press("Shift+End")
    page.wait_for_timeout(200)
    return True


def _style_paragraph(page, text, color=None, font=None):
    """문단 하나에 글자색/서체를 적용. 실패해도 발행은 계속(서식만 빠짐)."""
    try:
        if not _find_and_select(page, text):
            _log(f"  ! 서식 대상 문단 못찾음: {text[:24]}")
            return False
        if font:
            page.click(SEL_FONT_BTN); page.wait_for_timeout(600)
            opt = page.locator("button.se-toolbar-option-font-family, ul li button", has_text=font).first
            opt.click(timeout=3000); page.wait_for_timeout(400)
        if color:
            page.click(SEL_COLOR_BTN); page.wait_for_timeout(600)
            page.locator(f'.se-color-palette[title="{color}"]').first.click(timeout=3000)
            page.wait_for_timeout(400)
        return True
    except Exception as e:
        _log(f"  ! 서식 실패(무시): {text[:20]} — {str(e)[:50]}")
        _close_se_popups(page)
        return False


def _close_se_popups(page):
    """열려 있는 에디터 팝업을 확실히 닫는다.
    안 닫힌 링크 팝업이 남아 있으면 이후 타이핑이 전부 그 URL 입력칸으로 들어가 본문이 통째로 사라진다.
    (2026-07-20 실측: 본문 글자가 링크 팝업에 입력되고, se-popup-dim 이 클릭까지 가로막았다.)
    Escape 는 이 팝업에서 먹지 않는 경우가 있어 닫기 버튼을 직접 누른다."""
    for _ in range(3):
        try:
            if not page.locator(".se-popup:visible").count():
                return True
        except Exception:
            return True
        for how in (lambda: page.locator(".se-popup-close-button:visible").first.click(timeout=1500),
                    lambda: page.keyboard.press("Escape")):
            try:
                how(); page.wait_for_timeout(500); break
            except Exception:
                continue
    try:
        left = page.locator(".se-popup:visible").count()
    except Exception:
        left = 0
    if left:
        _log(f"  ! 에디터 팝업이 아직 열려 있음({left}개) — 본문 오염 위험")
    return not left


def _insert_link_card(page, url):
    """홈페이지 링크를 OG 썸네일 카드로 본문 끝에 삽입(사용자 요청: 사진2처럼 썸네일).
    흐름: 링크버튼 → URL 입력 → 검색(OG조회) → 확인(삽입). 실패해도 발행은 계속(카드 없이)."""
    try:
        # 팝업이 열릴 때까지 재시도. 타이핑 직후엔 토스트 알림이 링크 버튼을 덮어 클릭이 먹지 않는 일이 있다.
        #   (그때 input 이 안 떠서 6초 타임아웃 → '무시하고 진행' → 카드 없이 발행되고 있었다.)
        inp = page.locator(SEL_LINK_INPUT).first
        for attempt in range(3):
            try:
                page.locator(".se-toast-popup").first.wait_for(state="hidden", timeout=2500)
            except Exception:
                pass  # 토스트가 없거나 안 사라져도 일단 시도
            page.click(SEL_LINK_BTN, force=(attempt > 0)); page.wait_for_timeout(900)
            try:
                inp.wait_for(state="visible", timeout=3000)
                break
            except Exception:
                _log(f"  링크 팝업 재시도({attempt + 1}/3)")
                _close_se_popups(page)
                page.wait_for_timeout(700)
        else:
            raise RuntimeError("링크 팝업이 열리지 않음")
        inp.click(); inp.fill(url); page.wait_for_timeout(300)
        page.click(SEL_LINK_SEARCH); page.wait_for_timeout(3000)      # OG 정보 조회(네트워크)
        page.click(SEL_LINK_CONFIRM); page.wait_for_timeout(1800)     # 카드 삽입
        n = page.evaluate("() => document.querySelectorAll('.se-component.se-oglink').length")
        _log(f"  링크 카드 {'삽입 OK' if n else '미확인(카드 없이 진행)'}: {url}")
        return bool(n)
    except Exception as e:
        _log(f"  ! 링크 카드 실패(무시하고 진행): {str(e)[:70]}")
        _close_se_popups(page)              # 팝업이 남으면 다음 글 본문이 URL 칸으로 들어간다
        return False


def _fill_tags(page, tags):
    """에디터 '태그 입력칸'에 대표키워드 입력 — 블로그식 하단 태그칩(최대 10개).
    (본문에 #해시태그 텍스트를 쓰는 게 아님 — 사용자 확정 2026-07-16)"""
    if not tags:
        return 0
    try:
        ti = page.locator(SEL_TAG_INPUT).first
        ti.wait_for(state="visible", timeout=6000)
        ti.click(); page.wait_for_timeout(250)
        n = 0
        for t in tags[:10]:
            ti.type(t, delay=45); page.wait_for_timeout(180)
            page.keyboard.press("Enter"); page.wait_for_timeout(280)
            n += 1
        _log(f"  태그 {n}개 입력: {', '.join(tags[:10])}")
        return n
    except Exception as e:
        _log(f"  ! 태그 입력 실패(무시하고 진행): {str(e)[:70]}")
        return 0


def _pick_exact_option(option_texts, wanted):
    """정확히 일치하는 옵션의 인덱스. 없으면 -1.
    부분일치(has_text)를 쓰면 '누수'가 '누수/방수'·'누수탐지'를 잘못 고른다 → 정확 일치만 허용."""
    w = (wanted or "").strip()
    for i, t in enumerate(option_texts):
        if (t or "").strip() == w:
            return i
    return -1


def _select_board_and_prefix(page, board=None):
    """등록 필수: 게시판 선택 → 말머리가 있으면 자동으로 첫 항목 선택.
    board 인자가 있으면 그것을, 없으면 기존처럼 CAFE_BOARD 환경변수를 쓴다.
      (업체마다 게시판이 다른데 환경변수는 프로세스 전체 공용이라, 더맨 글이 '누수' 게시판으로 나가던 문제.)
    ⚠️ 게시판을 정확히 못 고르면 BoardError 로 '등록 전에' 중단한다. 예전엔 실패를 삼키고 등록까지 눌러
       기본 게시판에 잘못 발행됐다(엉뚱한 카페 게시판 사고).
    옵션은 FormSelectBox 구조(ul.option_list > li.item > button.option) — Playwright 실제 클릭 필요(JS click 은 React 미반영)."""
    board = board or os.environ.get("CAFE_BOARD", "누수")
    bsel = _first(page, ['button:has-text("게시판을 선택")', 'button[aria-haspopup="true"].button'], timeout=4000)
    if not bsel:
        raise BoardError(f"게시판 선택 버튼 못 찾음 (board='{board}')")
    try:
        bsel.click(); page.wait_for_timeout(700)
        opts = page.locator("ul.option_list button.option")
        texts = [(opts.nth(i).inner_text() or "").strip() for i in range(opts.count())]
        idx = _pick_exact_option(texts, board)
        if idx < 0:
            raise BoardError(f"게시판 '{board}' 정확일치 없음 — 후보: {texts[:8]}")
        opts.nth(idx).click(timeout=4000)
        _log(f"게시판 '{board}' 선택 OK (정확일치)")
        page.wait_for_timeout(900)
    except BoardError:
        raise
    except Exception as e:
        raise BoardError(f"게시판 '{board}' 선택 실패: {str(e)[:80]}")
    # 말머리(게시판 선택 후 활성화됨) — 있으면 자동 첫 항목
    try:
        mb = page.locator('button:has-text("말머리")').first
        mb.wait_for(state="visible", timeout=2000)
        if mb.is_enabled():
            mb.click(); page.wait_for_timeout(600)
            opt = page.locator("ul.option_list button.option:visible").first
            picked = (opt.inner_text() or "").strip()
            opt.click(timeout=3000)
            _log(f"말머리 자동선택: {picked or '(첫 항목)'}")
            page.wait_for_timeout(500)
    except Exception:
        pass  # 말머리 없거나 선택 불가 → 스킵(선택사항일 수 있음)


def publish(page, title, blocks, no_send=False, link_url=None, tags=None, links=None, board=None, on_submit=None):
    """글쓰기 → 제목 + 본문 마커대로 인터리브. 2패스: (1) 텍스트/이미지 + 부제목을 일반문단으로 →
    (2) 부제목 문단을 인용구로 변환. 인용구는 커서를 가둬 키보드 탈출이 안 되므로 이 방식이 유일하게 안정적.
    본문 뒤: link_url = 썸네일 카드로 삽입 / tags = 에디터 태그칸(하단 태그칩)."""
    blocks = _inject_spacing(blocks)
    # ⚠️ 핸들러는 goto '전'에 등록해야 한다. 이전 글이 에디터에 남아있으면 페이지 이탈 시
    #    beforeunload('작성 중인 글이 있습니다') 가 뜨는데, 이걸 dismiss 하면 navigation 이
    #    취소돼(ERR_ABORTED) 발행이 통째로 실패한다 → beforeunload 는 accept(이탈 허용).
    alerts = []

    def _on_dialog(d):
        # 대화상자가 우리가 처리하기 전에 스스로 닫히면 accept/dismiss 가 "No dialog is showing" 예외를 던진다.
        #   이 예외는 이벤트 핸들러 안에서 터져 리스너 프로세스를 통째로 죽인다(2026-07-20 크래시 루프 원인) → 삼킨다.
        try:
            if d.type == "beforeunload":
                d.accept()      # 작성 중 글 버리고 이동
            else:
                alerts.append(d.message)
                d.dismiss()     # alert(예: '게시판을 선택하세요') 는 닫기
        except Exception as e:
            _log(f"  (대화상자 처리 무시: {str(e)[:50]})")
    page.on("dialog", _on_dialog)
    # 🔴 fail-closed: 발행 대상 URL 이 비어 있으면(빈 문자열은 falsy≠None) 예전엔 이 goto 를 건너뛰고
    #   '열려 있는 아무 페이지'에 그대로 발행돼 오발행 사고가 났다. 이제는 오발행 대신 중단한다.
    #   (리스너가 'CAFE_URL_MISSING' 을 환경오류로 분류해 job 을 pending 으로 되돌린다 → .env 고치면 자동 재개)
    if not CAFE_WRITE_URL:
        raise RuntimeError("CAFE_URL_MISSING: 발행 대상 카페(CAFE_WRITE_URL) 미설정 — 오발행 방지로 중단")
    page.goto(CAFE_WRITE_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    # 로그인 만료 감지 — 글쓰기 URL 이 로그인 페이지로 튕기면 재시도 대상(리스너가 대기로 되돌림).
    if re.search(r"nid\.naver\.com|nidlogin", page.url or ""):
        raise RuntimeError("LOGIN_REQUIRED: 네이버 로그인 필요 — 크롬 9223 에서 로그인하세요")
    _focus_naver_window()
    # 제목 — 페이지 준비 지연(갓 띄운 크롬 등) 대비 한 번 더 대기 후 재시도.
    t = _first(page, SEL_TITLE, timeout=6000)
    if not t:
        page.wait_for_timeout(2500)
        t = _first(page, SEL_TITLE, timeout=6000)
    if not t:
        raise RuntimeError("제목 입력칸 못 찾음(페이지 준비 지연/로그인 확인 필요)")
    t.click(); t.fill(title)
    # 에디터 포커스
    ed = _first(page, SEL_EDITOR, timeout=6000)
    if not ed:
        raise RuntimeError("에디터 영역 못 찾음 — --diag 로 SEL_EDITOR 확정 필요")
    _close_se_popups(page)   # 이전 글에서 남은 팝업이 있으면 본문이 그리로 들어간다
    ed.click()
    page.wait_for_timeout(300)
    # 임시저장 복원분이 남아 있으면 새 글이 그 위에 겹쳐 써져 본문이 통째로 오염된다.
    #   깨진 글을 발행하느니 실패시키는 편이 낫다(리스너가 pending 으로 되돌려 재시도한다).
    if not _clear_editor(page):
        raise RuntimeError("에디터를 비우지 못했습니다 — 이전 글이 남아 있어 발행을 중단합니다")
    # ── 1패스: 이미지=툴바+파일선택 / 부제목=일반문단(앵커) / 텍스트=타이핑 / blank=빈 문단(간격) ──
    # 페이싱: 남은 시간을 남은 블록에 분배 → 총 작성시간 최소 CAFE_MIN_SECONDS 확보(너무 빠른 발행 회피).
    subtitles = []
    n_blocks = len(blocks)
    _target_sec = _write_seconds()
    _log(f"작성 페이싱: 목표 {_target_sec/60:.0f}분에 걸쳐 천천히 작성")
    deadline = time.monotonic() + _target_sec
    for idx, b in enumerate(blocks):
        if b["type"] == "text":
            _type_multiline(page, b["text"])
        elif b["type"] == "quote":
            page.keyboard.type(b["text"], delay=_kd()); page.keyboard.press("Enter")  # 앵커(2패스에서 인용구화)
            subtitles.append(b["text"])
        elif b["type"] == "blank":
            page.keyboard.press("Enter")  # 빈 문단 = 사진/문단 사이 간격
        else:
            _insert_image_block(page, b["local"])
        rem = n_blocks - (idx + 1)
        if rem > 0:
            pause = 0.0 if CAFE_FAST else max(0.0, min((deadline - time.monotonic()) / rem, 35.0))
            page.wait_for_timeout(int(pause * 1000))
        else:
            page.wait_for_timeout(200)
    # ── 링크 썸네일 카드: 지금 커서가 본문 맨 끝이라 여기서 삽입(2패스 전) ──
    for _u in (links if links is not None else ([link_url] if link_url else [])):
        _insert_link_card(page, _u)
        _close_se_popups(page)
    # ── 2패스: 부제목 문단 → 인용구 변환 ──
    for sub in subtitles:
        _convert_paragraph_to_quote(page, sub)
    # ── 3패스: 글자 서식 — 도입부는 다른 서체, FAQ 질문(Q.)은 다른 글자색 ──
    #   인용구 변환 뒤에 해야 한다(변환이 문단을 통째로 교체하므로 서식이 날아간다).
    _apply_text_styles(page, blocks)
    # ── 게시판 + 말머리 선택(등록 필수) ──
    _select_board_and_prefix(page, board)
    # ── 하단 태그칩(대표키워드) ──
    _fill_tags(page, tags)
    if no_send:
        _log(f"no_send: '등록' 직전까지 완료(사람이 확인 후 클릭). 인용구 {len(subtitles)}개 변환.")
        return None
    # ⚠️ 순서 고정(중복 발행 방지의 핵심): sub 를 먼저 찾고 → on_submit(=DB 를 posted 로 CAS) → 클릭.
    #   sub 조회가 실패해 예외가 나도 아직 클릭 전이므로 재시도 안전하다. on_submit 뒤부터는 클릭한 것으로 취급.
    sub = _first(page, SEL_SUBMIT, timeout=6000)
    if not sub:
        raise RuntimeError("등록 버튼 못 찾음 — --diag 로 SEL_SUBMIT 확정 필요")  # 클릭 전 → 재시도 가능
    if on_submit:
        on_submit()   # DB: processing→posted (실패하면 여기서 raise → 클릭 안 함 → 재시도 안전)
    before = page.url
    sub.click()
    # 여기서부터는 '이미 등록을 눌렀다'. 어떤 오류든 PostClickError 로 던져 리스너가 재시도하지 못하게 한다.
    deadline = time.monotonic() + CAFE_CONFIRM_SEC
    while time.monotonic() < deadline:
        page.wait_for_timeout(500)
        try:
            cur = page.url
        except Exception:
            # 등록 직후 탭/크롬이 죽으면 URL 조회조차 실패 — 글은 올라갔을 수 있으므로 재시도 금지.
            raise PostClickError("등록 클릭 후 페이지 접근 불가 — 사람 확인 필요")
        if cur != before and "/write" not in cur:
            return cur   # 발행 확정
    hint = f"(alert: {alerts[-1]})" if alerts else "(URL 미확정)"
    raise PostClickError(f"등록 클릭 후 확인 실패 — 사람 확인 필요 {hint}")


def session_ping(cdp_url=DEFAULT_CDP):
    """세션 유지 + 로그인 진짜 검증 — 전용 새 탭으로 '글쓰기 페이지'(로그인 필수) 방문.
    ⚠️ section.cafe.naver.com 등 공개 페이지로 검사하면 로그아웃 상태에서도 통과해 오판함(2026-07-16 실제 사고).
       발행이 실제로 쓰는 CAFE_WRITE_URL 로 검사해야 만료를 잡는다. 쿠키(NID_AUT/NID_SES)도 같이 확인.
    로그인 만료면 경고만(자동 재로그인은 하지 않음 — 캡차/2FA/계정잠금 위험).
    반환: True=로그인 유지 / False=만료(사람 재로그인 필요) / None=크롬 접속 실패."""
    if not CAFE_WRITE_URL:
        return None
    try:
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(cdp_url)
            ctx = browser.contexts[0] if browser.contexts else browser.new_context()
            pg = ctx.new_page()
            try:
                pg.goto(CAFE_WRITE_URL, wait_until="domcontentloaded", timeout=25000)
                pg.wait_for_timeout(2000)
                if re.search(r"nid\.naver\.com|nidlogin", pg.url or ""):
                    return False
                names = {c.get("name") for c in ctx.cookies() if "naver" in (c.get("domain") or "")}
                return "NID_AUT" in names   # 로그인 쿠키까지 있어야 진짜 유지
            finally:
                try:
                    pg.close()
                except Exception:
                    pass
    except Exception:
        return None  # 크롬 꺼짐/접속 실패


def _preflight(job, blocks, body, images):
    """타이핑 시작 전 원고를 검사. 문제가 있으면 ContentError(재시도 무의미) — 빈 글·제목없음·사진 초과 발행 차단."""
    if not (job.get("title") or "").strip():
        raise ContentError("제목 없음 — 발행 중단")
    if not any(b.get("type") in ("text", "image") for b in blocks):
        raise ContentError("본문/이미지가 비어 발행 중단")
    # 「사진 N」 마커가 실제 이미지 수보다 크면 parse 단계에서 조용히 사라진다 → 사진 빠진 글 방지.
    for ln in (body or "").splitlines():
        mm = IMG_MARK.match(ln)
        if mm and int(mm.group(1)) > len(images):
            raise ContentError(f"사진 마커 「사진 {mm.group(1)}」 > 이미지 {len(images)}장 — 발행 중단")


def publish_job(job, cdp_url=DEFAULT_CDP, no_send=False, on_submit=None):
    """큐 1건 발행 — 이미지 다운로드 + 본문 마커 파싱 → 인터리브 발행. (posted_url 또는 예외)
    on_submit: 등록 클릭 '직전'에 부르는 콜백(리스너가 DB 를 posted 로 CAS). 실패하면 raise → 클릭 안 함."""
    images, body, tmp, links, tags, board = _download_manifest(job.get("manifest") or [])
    blocks = parse_body_to_blocks(body, images)
    _preflight(job, blocks, body, images)   # 빈 글/제목없음/사진초과 → 여기서 중단(타이핑 전)
    n_img = sum(1 for b in blocks if b["type"] == "image")
    n_q = sum(1 for b in blocks if b["type"] == "quote")
    _log(f"블록 파싱: 텍스트 {sum(1 for b in blocks if b['type']=='text')} · 이미지 {n_img} · 인용구 {n_q}"
         f" · 링크 {len(links)} · 태그 {len(tags)} · 게시판 {board or '(기본)'}")
    with sync_playwright() as p:
        page = _connect(p, cdp_url)
        return publish(page, job.get("title") or "제목", blocks, no_send=no_send,
                       links=links, tags=tags, board=board, on_submit=on_submit)


def _clear_editor(page):
    """본문을 완전히 비운다.
    네이버가 '작성 중인 글'을 복원해 두면 그 위에 새 글이 겹쳐 써져서
    문장이 두 번 섞이고("서초 회사 보현서장초 회사 보안") 문단이 잘게 쪼개진다.
    부제목/서식은 문단 텍스트 완전일치로 찾으므로, 이 오염 하나로 이후 단계가 전부 실패한다."""
    # 빈 에디터도 안내 문구("내용을 입력하세요.")를 innerText 로 노출한다 → 내용으로 세면 안 된다.
    PLACEHOLDERS = ("내용을 입력하세요.", "본문에 #을 이용하여 태그를 입력해보세요!")

    def _state():
        n = page.evaluate("() => document.querySelectorAll('.se-component').length")
        t = page.evaluate("() => (document.querySelector('.se-content') || {}).innerText || ''")
        t = t.replace("​", "").strip()
        for ph in PLACEHOLDERS:
            t = t.replace(ph, "").strip()
        return n, t

    for attempt in range(4):
        try:
            _close_se_popups(page)
            # 본문 영역을 명시적으로 클릭해 포커스를 확보한 뒤 전체 삭제.
            #   포커스가 태그칸/제목칸에 있으면 Ctrl+A 가 엉뚱한 곳을 지운다.
            ed = _first(page, SEL_EDITOR, timeout=4000)
            if ed:
                ed.click(); page.wait_for_timeout(200)
            page.keyboard.press("Control+a"); page.wait_for_timeout(250)
            page.keyboard.press("Delete"); page.wait_for_timeout(500)
            n, txt = _state()
            if n <= 1 and not txt:
                return True
            # 이미지 컴포넌트는 Delete 로 안 지워지는 경우가 있어 Backspace 로 한 번 더.
            page.keyboard.press("Control+a"); page.wait_for_timeout(200)
            page.keyboard.press("Backspace"); page.wait_for_timeout(500)
            n, txt = _state()
            if n <= 1 and not txt:
                return True
            _log(f"  에디터 비우기 재시도({attempt + 1}/4) — 컴포넌트 {n}개 남음")
            if attempt < 3:
                page.goto(CAFE_WRITE_URL, wait_until="domcontentloaded"); page.wait_for_timeout(2500)
        except Exception as e:
            _log(f"  ! 에디터 비우기 오류: {str(e)[:60]}")
    return False


def _hide_overlays(page):
    """네이버 알림/토스트 레이어를 숨긴다. 이것들이 서식 툴바 클릭을 가로채 팔레트가 안 열린다."""
    try:
        page.evaluate("""() => {
          var sel = ['[class*=notice_layer]','[class*=notification]','[class*=toast]','[class*=alarm]','[class*=layer_noti]'];
          sel.forEach(function(s){ document.querySelectorAll(s).forEach(function(e){ e.style.display='none'; }); });
        }""")
    except Exception:
        pass


def _apply_text_styles(page, blocks):
    """FAQ 질문 줄("Q." 로 시작)만 글자색을 바꾼다.
    사용자 요청(2026-07-20): 배경색·서체 변경은 하지 않는다. 도입부는 문단 나눔으로만 처리.
    ⚠️ 인용구 변환 뒤에 실행해야 한다(변환이 문단을 교체하므로 먼저 하면 서식이 날아간다)."""
    q_lines = []
    for b in blocks:
        if b.get("type") != "text":
            continue
        for ln in (b.get("text") or "").splitlines():
            ln = ln.strip()
            if ln.startswith("Q."):
                q_lines.append(ln)
    if not q_lines:
        return
    _hide_overlays(page)
    ok = 0
    for ln in q_lines:
        if _style_paragraph(page, ln, color=CAFE_Q_COLOR) and _verify_color(page, ln, CAFE_Q_COLOR):
            ok += 1
        else:
            _log(f"  ! Q 줄 색상 미적용: {ln[:26]}")
    _log(f"  서식 적용: Q 줄 색상 {ok}/{len(q_lines)}")


def _verify_color(page, text, want):
    """정말 색이 바뀌었는지 computed style 로 확인. 클릭 성공 = 적용 성공이 아니다(실측)."""
    try:
        rgb = page.evaluate("""(txt) => {
          const ps=[...document.querySelectorAll('.se-component.se-text .se-text-paragraph')];
          const el=ps.find(p=>(p.innerText||'').trim()===txt);
          if(!el) return '';
          const sp=el.querySelector('span')||el;
          return getComputedStyle(sp).color;
        }""", text)
    except Exception:
        return False
    w = want.lstrip('#')
    exp = f"rgb({int(w[0:2],16)}, {int(w[2:4],16)}, {int(w[4:6],16)})"
    return rgb == exp

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
