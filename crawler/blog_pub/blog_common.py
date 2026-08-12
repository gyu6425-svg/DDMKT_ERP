# -*- coding: utf-8 -*-
"""블로그 저장 파이프라인 공통 — env / Supabase REST / 매니페스트 파싱 / 사람 타이핑 / 프레임 해석.

⚠️ crawler/cafe_pub/publish_cafe.py 의 **순수 함수만 복사**했다(2026-08-10).
   docs/MERGE-SAFETY.md §3.2 에 따라 import 하지 않는다. 카페 파일은 절대 수정하지 않는다.

카페와 의도적으로 다른 점 (독립검증에서 지적된 사고 경로를 막는다):
  1) **프레임 인지** — 카페 코드는 전부 top-level document 를 가정한다(`document.querySelectorAll`).
     블로그 글쓰기는 `#mainFrame` 안에서 렌더될 수 있고, 그러면 카페식 코드는 "실패"가 아니라
     **빈 결과를 정상으로 오인**한다(에디터 비우기가 안 비우고 True 를 반환 → 이전 글 위에 겹쳐 씀).
     → 모든 DOM 접근은 resolve_ctx() 가 돌려준 컨텍스트(page 또는 Frame)를 통한다.
  2) **fail-closed** — 못 찾으면 True(통과)가 아니라 False/예외(중단).
  3) env 접두어는 전부 `BLOG_` — `CAFE_*` 를 재사용하면 카페 발행 설정을 오염시킨다.
"""
import json
import os
import pathlib
import random
import re
import sys
import tempfile

import requests

import sb_auth   # 같은 폴더의 복사본(자립)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
requests.packages.urllib3.disable_warnings()

HERE = os.path.dirname(os.path.abspath(__file__))
# /api/img 키 프리픽스 — src/api/blogSaveQueue.BLOG_SAVE_BUCKET 과 **반드시 같은 값**.
#   (Supabase 버킷명이 아니다. R2 IMG_BUCKET 안의 접두어)
BLOG_BUCKET = os.environ.get("BLOG_IMG_PREFIX", "blog-save")


class ContentError(RuntimeError):
    """원고 자체 결함(빈 본문·제목 없음·사진 마커 초과) — 재시도해도 소용없음. 타이핑 전 중단."""


class SaveError(RuntimeError):
    """저장 과정 오류. 임시저장은 되돌릴 수 있으므로 재시도해도 안전하다.
    ⚠️ 카페의 PostClickError('이미 올라갔을 수 있음 → 재시도 금지') 같은 개념은 여기 **없다**.
       발행이 없으므로 '되돌릴 수 없는 중간 상태'가 존재하지 않는다."""


class PostClickError(RuntimeError):
    """발행(mode='publish')을 클릭한 뒤의 오류 — 글이 이미 올라갔을 수 있다.
    ⚠️ 리스너는 이걸 **절대 재시도하지 않는다**(재시도 = 중복 발행). 사람이 확인해야 한다.
       저장 모드에는 이 개념이 없다 — 임시저장은 되돌릴 수 있어 재시도가 안전하다."""


class GuardTripped(RuntimeError):
    """발행 차단 가드가 실제로 발동했다 — 버그가 조용히 지나가지 않게 시끄럽게 실패시킨다."""


# ── 환경 ────────────────────────────────────────────────────────────────────
def load_env():
    """blog_pub/.env(BLOG_*) + crawler/.env(SUPABASE_*) 를 읽는다.
    ⚠️ cafe_pub/.env 는 **읽지 않는다** — CAFE_NO_SEND 등 카페 발행 설정과 절대 섞이면 안 된다."""
    for p in [os.path.join(HERE, ".env"), os.path.join(HERE, "..", ".env")]:
        try:
            for line in pathlib.Path(p).read_text(encoding="utf-8-sig", errors="ignore").splitlines():
                m = re.match(r'^([A-Z_]+)\s*=\s*"?([^"\n\r]+)"?', line)
                if m and m.group(1) not in os.environ:
                    os.environ[m.group(1)] = m.group(2).strip()
        except Exception:
            pass


def log(m):
    print(f"[blog_pub] {m}", flush=True)


def supabase_url():
    return os.environ.get("SUPABASE_URL", "").rstrip("/")


def site_url():
    """이미지를 내려받을 사이트 주소(/api/img 가 붙어 있는 곳). 배포본 기본값."""
    return os.environ.get("BLOG_SITE_URL", "https://ddmkt-erp.pages.dev").rstrip("/")


def _headers():
    return sb_auth.headers("application/json")


def auth_ready():
    return sb_auth.ready()


def sb_get(path, params=None):
    r = requests.get(f"{supabase_url()}/rest/v1/{path}", headers=_headers(), params=params,
                     timeout=30, verify=False)
    r.raise_for_status()
    return r.json()


def sb_patch(path, params, payload, expect=None, ret=False):
    """PATCH. expect 를 주면 status=eq.<expect> 조건부(compare-and-set).
      · expect/ret 이면 return=representation 으로 '실제 바뀐 행'을 돌려준다. 빈 리스트 = 내가 못 이김.
      · expect/ret 일 때만 raise_for_status — 잠금 실패를 삼키면 이중 처리가 난다.
    ⚠️ 단수 Accept(application/vnd.pgrst.object)는 0행일 때 406 → 절대 쓰지 않는다(배열 응답 유지)."""
    p = dict(params)
    if expect is not None:
        p["status"] = f"eq.{expect}"
    representation = ret or expect is not None
    prefer = "return=representation" if representation else "return=minimal"
    r = requests.patch(f"{supabase_url()}/rest/v1/{path}", headers={**_headers(), "Prefer": prefer},
                       params=p, data=json.dumps(payload), timeout=30, verify=False)
    if representation:
        r.raise_for_status()
        return r.json()
    return None


def storage_download(path, dest):
    """이미지 1장 내려받기 — **R2(/api/img)** 에서. Supabase Storage 아니다.

    ⚠️ 2026-08-12 전환: Supabase 용량/Egress 초과로 이미지를 R2 로 옮겼다. 웹 업로드
       (src/api/blogSaveQueue.createSaveJob)와 **반드시 짝을 이룬다** — 한쪽만 바뀌면
       그 사이에 적재된 작업의 이미지가 통째로 깨진다. 그래서 같은 커밋으로 바꿨다.

    · GET 은 인증 불필요(공개·CDN 캐시). 경로가 jobId 기반이라 추측 불가하지만,
      '비공개 보장'은 아니다 — 어차피 블로그에 실릴 이미지라 카페와 같은 수준으로 둔다.
    · 옛 Supabase 경로로 저장된 작업이 남아 있으면 R2 에 없어 404 → download_manifest 가
      ContentError 로 중단시킨다(사진 빠진 글이 나가는 것보다 낫다)."""
    url = f"{site_url()}/api/img/{BLOG_BUCKET}/{path.lstrip('/')}"
    r = requests.get(url, timeout=120, verify=False)
    if not r.ok:
        log(f"  ! 이미지 조회 실패 {r.status_code}: {url[:110]}")
        return None
    pathlib.Path(dest).write_bytes(r.content)
    return dest


# ── 타이핑 페이싱 ────────────────────────────────────────────────────────────
# 저장도 계정 활동이다(같은 세션·같은 IP·같은 케이던스). '저장이니까 빨라도 된다'는 판단은 금지.
BLOG_MIN_SECONDS = int(os.environ.get("BLOG_MIN_SECONDS", "300"))
BLOG_MAX_SECONDS = int(os.environ.get("BLOG_MAX_SECONDS", str(BLOG_MIN_SECONDS)))
BLOG_FAST = os.environ.get("BLOG_FAST", "0") == "1"
BLOG_FAST_DELAY = max(8, int(os.environ.get("BLOG_FAST_DELAY", "15")))   # 0 금지: 에디터가 못 따라와 글자가 섞인다


def write_seconds():
    """이 글을 쓰는 데 쓸 목표 시간(초) — MIN~MAX 랜덤(매번 같은 소요시간은 봇 티가 난다)."""
    lo, hi = min(BLOG_MIN_SECONDS, BLOG_MAX_SECONDS), max(BLOG_MIN_SECONDS, BLOG_MAX_SECONDS)
    return random.uniform(lo, hi) if hi > lo else float(lo)


def key_delay():
    """사람 같은 키 입력 딜레이(ms)."""
    return BLOG_FAST_DELAY if BLOG_FAST else random.randint(38, 95)


# ⚠️ 오타 연출은 기본 꺼짐(0). 카페 2026-07-20 실발행에서 본문 45자가 통째로 사라졌다.
#    한글 IME 조합 때문에 '친 글자 수 = 지울 글자 수'가 성립하지 않는다. 켜지 말 것.
BLOG_TYPO_RATE = float(os.environ.get("BLOG_TYPO_RATE", "0"))
_TYPO_CHARS = "ㅁㄴㅇㄹ아어이오우그느다드르"


def _typo_burst(page):
    n = random.randint(1, 3)
    page.keyboard.type("".join(random.choice(_TYPO_CHARS) for _ in range(n)), delay=key_delay())
    page.wait_for_timeout(random.randint(120, 380))
    for _ in range(n):
        page.keyboard.press("Backspace")
        page.wait_for_timeout(random.randint(45, 110))


def type_human(page, ln):
    """한 줄을 사람처럼 타이핑. 지우는 건 방금 친 군더더기뿐이라 결과 텍스트는 ln 그대로."""
    if len(ln) < 12 or random.random() >= BLOG_TYPO_RATE:
        page.keyboard.type(ln, delay=key_delay())
        return
    n_ev = random.randint(1, 2) if len(ln) >= 40 else 1
    cuts = sorted(random.sample(range(5, len(ln) - 3), n_ev))
    pos = 0
    for c in cuts:
        page.keyboard.type(ln[pos:c], delay=key_delay())
        _typo_burst(page)
        pos = c
    page.keyboard.type(ln[pos:], delay=key_delay())


def type_multiline(page, text):
    """여러 문단 타이핑. 문단 사이 빈 줄은 그대로 유지."""
    lines = norm_lines(text)
    for i, ln in enumerate(lines):
        if i:
            page.keyboard.press("Enter")
            if not BLOG_FAST and random.random() < 0.25:
                page.wait_for_timeout(random.randint(400, 1500))   # 다음 문장 생각하는 멈칫
        if ln:
            type_human(page, ln)
    page.keyboard.press("Enter")


# ── 본문 마커 / 블록 파싱 ────────────────────────────────────────────────────
IMG_MARK = re.compile(r'^\s*[「\[]?\s*사진\s*(\d+)\s*[」\]]?\s*$')
SUB_MARK = re.compile(r'^\s*부제목\s*[:：]\s*(.+?)\s*$')


def download_manifest(manifest):
    """매니페스트 → (이미지 로컬경로[순서], 본문텍스트, tmpdir).

    ⚠️ 카페와 다른 점: 이미지 다운로드 실패를 **로그만 남기고 넘어가지 않는다**.
       카페는 실패해도 진행해서(사진 마커가 없는 원고면) 사진 없는 글이 그대로 나갈 수 있었다.
       저장이라도 내용이 빠진 채 남으면 사람이 그대로 발행할 위험이 있으므로 즉시 중단한다."""
    tmp = tempfile.mkdtemp(prefix="blogsave_")
    images, texts = [], []
    for i, b in enumerate(manifest):
        if b.get("type") == "image":
            local = os.path.join(tmp, f"{i:02d}.jpg")
            if storage_download(b["path"], local):
                images.append(local)
            else:
                raise ContentError(f"이미지 다운로드 실패: {b.get('path')} — 내용 누락 방지로 중단")
        elif b.get("type") == "text":
            texts.append(b.get("text", ""))
    return images, "\n".join(texts), tmp


def parse_body_to_blocks(body, images):
    """본문 → 렌더 블록. '사진 N'→그 위치에 images[N-1], '부제목 : X'→인용구, 나머지→문단.
    마커가 하나도 없으면 이미지 상단 일괄 + 본문으로 폴백."""
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
            sub = re.sub(r'^(?:부제목\s*[:：]\s*)+', '', ms.group(1)).strip()
            blocks.append({"type": "quote", "text": sub})
        else:
            buf.append(line)
    flush()

    if not used:
        return [{"type": "image", "local": im} for im in images] + \
               ([{"type": "text", "text": body}] if (body or "").strip() else [])
    for i, im in enumerate(images):
        if i not in used:
            blocks.append({"type": "image", "local": im})
    return blocks


def norm_lines(text):
    """빈 줄(문단 간격)은 살리되 연속 빈 줄은 1개로, 양끝 빈 줄은 제거."""
    out, prev_blank = [], True
    for ln in (text or "").split("\n"):
        blank = not ln.strip()
        if blank and prev_blank:
            continue
        out.append("" if blank else ln)
        prev_blank = blank
    while out and out[-1] == "":
        out.pop()
    return out


def inject_spacing(blocks):
    """이미지 앞뒤에 빈 문단 삽입 — 사진과 글이 붙지 않게."""
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


def preflight(title, blocks, body, images):
    """타이핑 시작 전 원고 검사 — 빈 글·제목없음·사진 마커 초과면 ContentError(재시도 무의미)."""
    if not (title or "").strip():
        raise ContentError("제목 없음 — 저장 중단")
    if not any(b.get("type") in ("text", "image") for b in blocks):
        raise ContentError("본문/이미지가 비어 저장 중단")
    for ln in (body or "").splitlines():
        mm = IMG_MARK.match(ln)
        if mm and int(mm.group(1)) > len(images):
            raise ContentError(f"사진 마커 「사진 {mm.group(1)}」 > 이미지 {len(images)}장 — 저장 중단")


# ── 브라우저 접속 / 프레임 해석 ──────────────────────────────────────────────
def connect(p, cdp_url):
    """사람이 1회 로그인해 둔 크롬에 CDP 로 '붙는다'. Playwright 가 띄운 크롬은 자동화 감지 대상이고,
    이 PC 에는 Playwright 번들 크로미움이 설치돼 있지도 않다(launch 불가)."""
    browser = p.chromium.connect_over_cdp(cdp_url)
    ctx = browser.contexts[0] if browser.contexts else browser.new_context()
    pages = [pg for pg in ctx.pages if "naver.com" in (pg.url or "")]
    page = pages[0] if pages else (ctx.pages[0] if ctx.pages else ctx.new_page())
    try:
        page.bring_to_front()
    except Exception:
        pass
    return page


def resolve_ctx(page, frame_hint, probe_selectors):
    """에디터가 실제로 들어있는 컨텍스트(page 또는 Frame)를 돌려준다.

    ⚠️ 이 함수가 이 파일의 존재 이유다. 카페 엔진은 항상 top-level document 를 본다.
       블로그가 #mainFrame 안이면 카페식 코드는 조용히 빈 결과를 얻고 '정상'으로 착각한다.

    frame_hint  : 프레임 URL/이름에 매칭할 정규식 문자열(없으면 자동 탐색)
    probe_selectors: 에디터가 그 컨텍스트에 있는지 확인할 셀렉터 후보
    반환: (ctx, where)  where = 'page' | 'frame:<url일부>'
    ⚠️ 못 찾으면 예외 — '없으면 page 로 폴백'은 절대 하지 않는다(폴백이 곧 오염 경로)."""
    def _has(c):
        for s in probe_selectors:
            try:
                if c.locator(s).count() > 0:
                    return True
            except Exception:
                continue
        return False

    if _has(page):
        return page, "page"

    frames = list(page.frames)
    if frame_hint:
        rx = re.compile(frame_hint)
        frames = [f for f in frames if rx.search(f.url or "") or rx.search(f.name or "")] + \
                 [f for f in frames if not (rx.search(f.url or "") or rx.search(f.name or ""))]
    for f in frames:
        if f == page.main_frame:
            continue
        if _has(f):
            return f, f"frame:{(f.url or f.name or '')[:60]}"

    raise SaveError("에디터를 어느 프레임에서도 찾지 못했습니다 — diag_blog.py 로 셀렉터/프레임 재확정 필요")


# ── '문서에 실제 내용이 있는가' 판정 JS — 엔진과 probe 가 **이 한 벌을 공유**한다 ──────
#   ⚠️ 복붙 두 벌로 두면 probe 는 통과하는데 엔진은 다른 걸 검사하는 상태가 된다(실제로 그랬다).
#
#   실측(2026-08-11, SUB1)으로 확정된 마크업:
#     <p class="se-text-paragraph">
#       <span class="se-ff-nanumgothic … __se-node"></span>          ← 내용 노드(빈 문서면 빈칸)
#       <span class="se-placeholder __se_placeholder">제목</span>     ← 플레이스홀더
#     </p>
#
#   🔴 .se-content 의 innerText 를 읽으면 안 된다. 그 안에 편집기 UI 가 같이 들어있어
#      빈 문서에서도 "위치이동 제목 배경 사진 삭제…구분선1…인용구6" 같은 툴바 텍스트가 나온다.
#      → 문단의 **내용 노드(.__se-node)** 만 읽는다.
#
#   🔴 fail-closed: 내용 노드를 하나도 못 찾으면 '' 를 돌려주면 안 된다. 그건 '비었다'로
#      오인돼 이전 글 위에 겹쳐쓰기로 이어진다. 마크업이 바뀐 것이므로 센티널을 돌려
#      비우기를 실패시키고 사람이 보게 한다.
CONTENT_TEXT_JS = """(hints) => {
    const nodes = document.querySelectorAll('.se-text-paragraph .__se-node');
    if (!nodes.length) return '<NO_SE_NODE>';   // 마크업 변경 — 판정 불가 → 실패 처리
    let t = '';
    nodes.forEach(n => {
        const c = (n.className || '').toString().toLowerCase();
        if (hints.some(h => c.includes(h))) return;     // placeholder 계열 제외
        t += (n.textContent || '');
    });
    return t.replace(/[\\u200b\\uFEFF]/g, '').trim();
}"""


def content_text(ctx, hints):
    """문서의 '실제 내용' 텍스트. 빈 문서면 ''. 판정 불가면 '<NO_SE_NODE>'(비어있지 않음 취급)."""
    return ctx.evaluate(CONTENT_TEXT_JS, hints)


def first(ctx, selectors, timeout=4000):
    """후보 셀렉터 중 먼저 보이는 것 반환(없으면 None). ctx 는 page 또는 Frame."""
    for s in selectors:
        try:
            loc = ctx.locator(s).first
            loc.wait_for(state="visible", timeout=timeout)
            return loc
        except Exception:
            continue
    return None
