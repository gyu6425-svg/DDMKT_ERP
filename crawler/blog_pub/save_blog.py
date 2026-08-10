# -*- coding: utf-8 -*-
"""네이버 블로그 자동 **임시저장** 엔진 — 저장까지만. 발행은 사람이 한다.

이 파일에는 **발행하는 코드 경로가 없다.** '안 부른다'가 아니라 '없다'.
  · 발행 버튼을 클릭하는 코드 없음
  · 발행 URL 로 goto 하는 코드 없음
  · blog_selectors.BLOCK_* 상수는 오직 `_install_publish_guard()` 의 **차단 인자**로만 등장한다
  · test_no_publish.py 가 이 파일을 AST 로 파싱해 위 3가지를 매 커밋 검사한다

[발행 차단 4겹 — 각 층이 독립적으로 막는다]
  #1 네트워크: 발행 POST 를 page.route 로 abort. 스크립트가 실수로 눌러도 요청이 안 나간다.
  #2 DOM     : 캡처 단계에서 발행 버튼 클릭을 삼키고 pointer-events:none 을 건다.
  #3 스키마  : blog_save_queue.status 에 'posted' 가 없다(CHECK 제약). 발행 결과를 기록할 자리가 없다.
  #4 사후검증: 저장 후 URL 이 발행 상세(logNo=/PostView)로 전이했으면 최고 심각도로 실패시킨다.
  (#3 은 docs/blog-save-queue.sql, 그 외는 이 파일)

[왜 CDP 접속인가] Playwright 가 띄운 크롬은 자동화 감지 → 캡차/2FA 반복. 사람이 1회 로그인한
  크롬(run_chrome_blog.bat)에 '붙어서' 조종한다. 이 PC 들엔 번들 크로미움이 없어 launch 도 불가.

[사용]
  python save_blog.py --job <id>            # 기본 = dry-run. 저장 버튼을 찾기만 하고 누르지 않는다.
  python save_blog.py --job <id> --save     # 실제 임시저장 (명시적 opt-in)
  ⚠️ 카페(publish_cafe.py)는 플래그 없이 실행하면 '발행'이 기본이다. 여기는 **정반대**로 뒤집었다.
"""
import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_common as bc          # noqa: E402
import blog_selectors as sel      # noqa: E402
from playwright.sync_api import sync_playwright   # noqa: E402

bc.load_env()
DEFAULT_CDP = os.environ.get("BLOG_CDP", "http://127.0.0.1:9225")
BLOG_WRITE_URL = os.environ.get("BLOG_WRITE_URL", "")
BLOG_ID = os.environ.get("BLOG_ID", "")          # 이 워커가 담당하는 블로그 아이디(계정 오배치 방지)
BLOG_CONFIRM_SEC = int(os.environ.get("BLOG_CONFIRM_SEC", "30"))


# ── 가드 #1·#2 ───────────────────────────────────────────────────────────────
# 발행 버튼 클릭을 캡처 단계에서 삼키고 pointer-events 를 끈다. 새로 붙는 노드도 MutationObserver 로 따라간다.
_GUARD_FN = """(sels) => {
  const hit = (el) => el && el.closest && sels.some(s => {
    try { return el.closest(s); } catch (e) { return false; }
  });
  document.addEventListener('click', (e) => {
    if (hit(e.target)) {
      e.stopImmediatePropagation(); e.preventDefault();
      (window.__blogGuard = window.__blogGuard || []).push('click');
    }
  }, true);
  const kill = () => sels.forEach(s => {
    try { document.querySelectorAll(s).forEach(el => { el.style.pointerEvents = 'none'; }); } catch (e) {}
  });
  kill();
  try { new MutationObserver(kill).observe(document.documentElement, {childList: true, subtree: true}); } catch (e) {}
}"""
# add_init_script 용 — 문(statement)이어야 하므로 IIFE 로 감싸고 셀렉터 목록을 JSON 으로 박는다.
_GUARD_INIT = "(" + _GUARD_FN + ")(%s);"


def _is_blocked_url(url):
    u = (url or "").lower()
    if any(p in u for p in sel.SAVE_URL_PARTS):     # 저장 요청은 예외(확정된 것만)
        return False
    return any(p in u for p in sel.BLOCK_URL_PARTS)


def _install_publish_guard(page, tripped):
    """발행을 네트워크·DOM 두 층에서 막는다. 발동하면 tripped 에 기록해 **시끄럽게 실패**시킨다.
    (조용히 막기만 하면 버그가 그대로 남아 다음에 다른 경로로 터진다.)"""
    def _route(route):
        try:
            req = route.request
            if req.method in ("POST", "PUT") and _is_blocked_url(req.url):
                tripped.append(req.url[:200])
                bc.log(f"🔴 발행 요청 차단: {req.url[:120]}")
                return route.abort("blockedbyclient")
            return route.continue_()
        except Exception:
            try:
                return route.continue_()
            except Exception:
                return None

    page.route("**/*", _route)

    # DOM: 캡처 단계에서 클릭을 삼키고 포인터 이벤트를 끈다. 페이지 로드 전부터 걸어 둔다.
    #   ⚠️ add_init_script 는 '문(statement)'을 받는다. 화살표 함수 식만 넘기면 평가만 되고
    #      아무 일도 일어나지 않는다(가드가 조용히 무력화) → IIFE 로 감싼다.
    try:
        page.add_init_script(_GUARD_INIT % json.dumps(sel.BLOCK_CLICK_SELECTORS, ensure_ascii=False))
    except Exception:
        pass
    try:
        page.evaluate(_GUARD_FN, sel.BLOCK_CLICK_SELECTORS)   # 이미 열려 있는 페이지에도 즉시 적용
    except Exception:
        pass


def _guard_report(page, tripped):
    """가드가 발동했는지 수집 — 발동했으면 job 을 fail 로 떨어뜨린다."""
    hits = list(tripped)
    try:
        dom = page.evaluate("() => (window.__blogGuard || []).length")
        if dom:
            hits.append(f"dom-click x{dom}")
    except Exception:
        pass
    return hits


# ── 에디터 조작 ──────────────────────────────────────────────────────────────
def _clear_editor(ctx, page):
    """본문을 완전히 비운다. **못 비우면 False(중단)** — fail-closed.

    ⚠️ 카페판(_clear_editor)은 컴포넌트를 못 찾으면 n=0/txt='' 이 되어 `n <= 1 and not txt` 로
       **'비웠다'고 True 를 반환**한다. top-level 가정이 깨지는 순간(=iframe) 정확히 반대로 동작해
       네이버가 복원해 둔 이전 임시저장분 위에 새 글이 겹쳐 써진다. 여기서는 에디터를 실제로
       찾지 못하면 곧바로 False 를 돌려준다."""
    PLACEHOLDERS = ("내용을 입력하세요.", "본문에 #을 이용하여 태그를 입력해보세요!")

    def _state():
        n = ctx.evaluate("() => document.querySelectorAll('.se-component').length")
        t = ctx.evaluate("() => (document.querySelector('.se-content') || {}).innerText || ''")
        t = (t or "").replace("​", "").strip()
        for ph in PLACEHOLDERS:
            t = t.replace(ph, "").strip()
        return n, t

    for attempt in range(4):
        try:
            ed = bc.first(ctx, sel.SEL_EDITOR, timeout=4000)
            if not ed:
                bc.log("  ! 에디터를 찾지 못해 비우기 실패로 처리(겹쳐쓰기 방지)")
                return False
            ed.click()
            page.wait_for_timeout(200)
            page.keyboard.press("Control+a"); page.wait_for_timeout(250)
            page.keyboard.press("Delete"); page.wait_for_timeout(500)
            n, txt = _state()
            if n <= 1 and not txt:
                return True
            page.keyboard.press("Control+a"); page.wait_for_timeout(200)
            page.keyboard.press("Backspace"); page.wait_for_timeout(500)
            n, txt = _state()
            if n <= 1 and not txt:
                return True
            bc.log(f"  에디터 비우기 재시도({attempt + 1}/4) — 컴포넌트 {n}개 남음")
            if attempt < 3:
                page.goto(BLOG_WRITE_URL, wait_until="domcontentloaded")
                page.wait_for_timeout(2500)
                ctx, _ = bc.resolve_ctx(page, sel.FRAME_HINT, sel.SEL_EDITOR)
        except Exception as e:
            bc.log(f"  ! 에디터 비우기 오류: {str(e)[:70]}")
    return False


def _insert_image_block(ctx, page, local):
    last_err = None
    for attempt in range(3):
        btn = bc.first(ctx, sel.SEL_IMG_BTN, timeout=4000)
        if not btn:
            raise bc.SaveError("사진 버튼 못 찾음 — diag_blog.py 로 SEL_IMG_BTN 확정 필요")
        try:
            with page.expect_file_chooser(timeout=10000) as fc:
                btn.click()
            fc.value.set_files(local)      # 한 장씩 → 순서 보장
            page.wait_for_timeout(1800)    # 업로드(비동기) 대기
            return
        except Exception as e:
            last_err = e
            bc.log(f"  파일선택창 재시도({attempt + 1}/3)")
            page.wait_for_timeout(700)
    raise bc.SaveError(f"이미지 삽입 실패: {str(last_err)[:80]}")


def _draft_count(ctx):
    """헤더의 '저장 N' 카운터. 못 읽으면 None(판정은 다른 신호로)."""
    for s in sel.SEL_DRAFT_COUNT:
        try:
            loc = ctx.locator(s).first
            if loc.count():
                m = re.search(r"\d+", loc.inner_text() or "")
                if m:
                    return int(m.group())
        except Exception:
            continue
    return None


def _assert_not_published(page, where):
    """가드 #4 — URL 이 발행 상세로 전이했으면 발행된 것. 최고 심각도로 중단."""
    cur = page.url or ""
    for pat in sel.PUBLISHED_URL_PATTERNS:
        if re.search(pat, cur):
            raise bc.GuardTripped(
                f"🔴🔴 {where}: 발행 상세 URL 로 전이했습니다({cur[:120]}) — 발행됐을 수 있습니다. 즉시 확인 필요")


# ── 공개 진입점: 저장만 한다 ─────────────────────────────────────────────────
def save_draft(page, title, blocks, dry_run=True):
    """글쓰기 → 제목/본문/이미지 채움 → **'저장'(임시저장)**. 반환: draft_seq(int) 또는 None.

    dry_run=True(기본)면 저장 버튼을 **찾기만 하고 누르지 않는다**."""
    if not sel.confirmed():
        raise bc.SaveError(
            "SELECTORS_UNCONFIRMED: blog_selectors.CONFIRMED_ON 이 비어 있습니다 — "
            "Phase 0(diag_blog.py) 실측 전에는 저장하지 않습니다(엉뚱한 버튼 클릭 방지)")
    if not BLOG_WRITE_URL:
        raise bc.SaveError("BLOG_URL_MISSING: BLOG_WRITE_URL 미설정 — 열려 있는 아무 페이지에 쓰는 사고 방지로 중단")

    blocks = bc.inject_spacing(blocks)
    tripped = []

    alerts = []

    def _on_dialog(d):
        # 핸들러 안에서 터진 예외는 리스너 프로세스를 통째로 죽인다(카페 2026-07-20 크래시 루프) → 삼킨다.
        try:
            if d.type == "beforeunload":
                d.accept()       # 작성 중 글 버리고 이동
            else:
                alerts.append(d.message)
                d.dismiss()
        except Exception as e:
            bc.log(f"  (대화상자 처리 무시: {str(e)[:50]})")

    page.on("dialog", _on_dialog)
    _install_publish_guard(page, tripped)          # goto 전에 걸어야 한다

    page.goto(BLOG_WRITE_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    if re.search(r"nid\.naver\.com|nidlogin", page.url or ""):
        raise bc.SaveError("LOGIN_REQUIRED: 네이버 로그인 필요 — 크롬(BLOG_CDP)에서 로그인하세요")
    # 계정 오배치 방지 — 지금 열린 글쓰기 페이지가 이 워커가 담당하는 블로그가 맞는가.
    #   카페엔 없던 검증이다(카페는 URL 하나가 곧 대상). 블로그는 프로필/포트가 계정마다라 섞이면
    #   A사 원고가 B사 블로그에 저장된다.
    if BLOG_ID and BLOG_ID.lower() not in (page.url or "").lower():
        raise bc.SaveError(f"BLOG_ID_MISMATCH: 현재 페이지({page.url[:80]})가 담당 블로그({BLOG_ID})가 아닙니다")

    ctx, where = bc.resolve_ctx(page, sel.FRAME_HINT, sel.SEL_EDITOR)
    bc.log(f"에디터 컨텍스트: {where}")

    t = bc.first(ctx, sel.SEL_TITLE, timeout=6000)
    if not t:
        page.wait_for_timeout(2500)
        t = bc.first(ctx, sel.SEL_TITLE, timeout=6000)
    if not t:
        raise bc.SaveError("제목 입력칸 못 찾음(페이지 준비 지연/셀렉터 미확정)")
    t.click()
    # 제목이 contenteditable 이면 fill() 이 안 먹으므로 타이핑으로 넣는다.
    page.keyboard.type(title, delay=bc.key_delay())

    ed = bc.first(ctx, sel.SEL_EDITOR, timeout=6000)
    if not ed:
        raise bc.SaveError("에디터 영역 못 찾음 — diag_blog.py 로 SEL_EDITOR 확정 필요")
    ed.click()
    page.wait_for_timeout(300)
    if not _clear_editor(ctx, page):
        raise bc.SaveError("에디터를 비우지 못했습니다 — 이전 글이 남아 있어 저장을 중단합니다")

    before_seq = _draft_count(ctx)
    bc.log(f"저장 전 임시저장 개수: {before_seq if before_seq is not None else '(읽기 실패)'}")

    # ── 본문 채우기 (페이싱: 총 작성시간 BLOG_MIN~MAX 초 확보) ──
    n_blocks = len(blocks)
    target = bc.write_seconds()
    bc.log(f"작성 페이싱: 목표 {target/60:.0f}분")
    deadline = time.monotonic() + target
    for idx, b in enumerate(blocks):
        if b["type"] == "text":
            bc.type_multiline(page, b["text"])
        elif b["type"] == "quote":
            page.keyboard.type(b["text"], delay=bc.key_delay())
            page.keyboard.press("Enter")
        elif b["type"] == "blank":
            page.keyboard.press("Enter")
        else:
            _insert_image_block(ctx, page, b["local"])
        rem = n_blocks - (idx + 1)
        if rem > 0:
            pause = 0.0 if bc.BLOG_FAST else max(0.0, min((deadline - time.monotonic()) / rem, 35.0))
            page.wait_for_timeout(int(pause * 1000))
        else:
            page.wait_for_timeout(200)

    _assert_not_published(page, "본문 작성 후")

    # ── 저장 ──
    btn = bc.first(ctx, sel.SEL_SAVE, timeout=6000)
    if not btn:
        raise bc.SaveError("저장 버튼 못 찾음 — diag_blog.py 로 SEL_SAVE 확정 필요")
    if dry_run:
        bc.log("[DRY] 저장 버튼 발견 — 누르지 않고 종료합니다. 실제 저장은 --save 필요.")
        hits = _guard_report(page, tripped)
        if hits:
            raise bc.GuardTripped(f"발행 가드 발동: {hits}")
        return None

    # 클릭 직전 URL 재확인 — 엉뚱한 페이지에서 누르는 사고 방지.
    if "postwrite" not in (page.url or "").lower() and "write" not in (page.url or "").lower():
        raise bc.SaveError(f"저장 직전 URL 이 글쓰기 페이지가 아닙니다({page.url[:90]}) — 중단")
    btn.click()
    page.wait_for_timeout(1500)

    # 저장 확인: 카운터가 늘었는가. (URL 은 임시저장에서 바뀌지 않으므로 성공 신호로 쓰면 안 된다.)
    seq = None
    end = time.monotonic() + BLOG_CONFIRM_SEC
    while time.monotonic() < end:
        cur_seq = _draft_count(ctx)
        if cur_seq is not None and before_seq is not None and cur_seq > before_seq:
            seq = cur_seq
            break
        if cur_seq is not None and before_seq is None:
            seq = cur_seq
            break
        page.wait_for_timeout(700)

    _assert_not_published(page, "저장 클릭 후")
    hits = _guard_report(page, tripped)
    if hits:
        raise bc.GuardTripped(f"발행 가드 발동: {hits}")

    if seq is None:
        raise bc.SaveError(
            f"저장 확인 실패 — 임시저장 개수가 늘지 않았습니다(전 {before_seq}). "
            f"{('alert: ' + alerts[-1]) if alerts else ''}")
    bc.log(f"✔ 임시저장 완료 — 저장 {seq}")
    return seq


def save_job(job, cdp_url=DEFAULT_CDP, dry_run=True):
    """큐 1건 저장 — 이미지 다운로드 + 본문 마커 파싱 → 저장. (draft_seq 또는 예외)"""
    images, body, _tmp = bc.download_manifest(job.get("manifest") or [])
    blocks = bc.parse_body_to_blocks(body, images)
    bc.preflight(job.get("title"), blocks, body, images)
    bc.log(f"블록 파싱: 텍스트 {sum(1 for b in blocks if b['type']=='text')} · "
           f"이미지 {sum(1 for b in blocks if b['type']=='image')} · "
           f"인용구 {sum(1 for b in blocks if b['type']=='quote')}")
    with sync_playwright() as p:
        page = bc.connect(p, cdp_url)
        return save_draft(page, job.get("title") or "제목", blocks, dry_run=dry_run)


def session_ping(cdp_url=DEFAULT_CDP):
    """세션 유지 + 로그인 검증 — 전용 새 탭으로 글쓰기 페이지(로그인 필수) 방문.
    로그인 만료면 경고만(자동 재로그인 금지 — 캡차/2FA/계정잠금 위험).
    반환: True=유지 / False=만료 / None=크롬 접속 실패."""
    if not BLOG_WRITE_URL:
        return None
    try:
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(cdp_url)
            ctx = browser.contexts[0] if browser.contexts else browser.new_context()
            pg = ctx.new_page()
            try:
                pg.goto(BLOG_WRITE_URL, wait_until="domcontentloaded", timeout=25000)
                pg.wait_for_timeout(2000)
                if re.search(r"nid\.naver\.com|nidlogin", pg.url or ""):
                    return False
                names = {c.get("name") for c in ctx.cookies() if "naver" in (c.get("domain") or "")}
                return "NID_AUT" in names
            finally:
                try:
                    pg.close()
                except Exception:
                    pass
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", help="blog_save_queue.id")
    ap.add_argument("--cdp", default=DEFAULT_CDP)
    # ⚠️ fail-closed: 아무 플래그 없이 실행하면 dry-run. 저장은 명시적 opt-in.
    ap.add_argument("--save", action="store_true", help="실제로 임시저장한다(명시 필요)")
    ap.add_argument("--ping", action="store_true", help="로그인 세션만 확인")
    a = ap.parse_args()

    if a.ping:
        bc.log(f"session_ping: {session_ping(a.cdp)}")
        return 0
    if not a.job:
        ap.error("--job 필요")
    if not bc.auth_ready():
        bc.log("Supabase 인증 미설정(.env)")
        return 2
    rows = bc.sb_get("blog_save_queue", {"id": f"eq.{a.job}", "select": "*"})
    if not rows:
        bc.log("job 없음")
        return 3
    seq = save_job(rows[0], a.cdp, dry_run=not a.save)
    bc.log(f"결과 draft_seq={seq}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
