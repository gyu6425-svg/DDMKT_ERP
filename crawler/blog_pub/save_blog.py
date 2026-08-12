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
DEFAULT_CDP = os.environ.get("BLOG_CDP", "http://127.0.0.1:9235")
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


def _is_publish_url(url):
    """발행 요청인가 — 발행 모드의 '올라갔다' 판정에 쓴다(저장 모드에선 사고 감지용)."""
    u = (url or "").lower()
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


# ── 발행 모드 (mode='publish' 전용) ──────────────────────────────────────────
# 🔴 이 파일에서 유일하게 '발행'을 하는 함수다. SEL_PUB_* 상수는 오직 여기서만 쓴다
#    (test_no_publish.T15 가 그 격리를 강제한다).
#
#    저장과 발행은 성공 판정이 **정반대**다:
#      저장 → URL 이 안 바뀌어야 정상, logNo 로 전이하면 사고
#      발행 → logNo 로 전이해야 성공
#    그래서 두 경로를 한 함수에 섞지 않는다.
BLOG_PUBLISH_ENABLED = os.environ.get("BLOG_PUBLISH_ENABLED", "0") == "1"


def _pick_open_type(ctx, page, kind):
    """공개설정 라디오를 **라벨 텍스트로** 고른다.

    ⚠️ value(0~3)로 고르지 않는다. 네이버가 값 순서를 바꾸면 '비공개로 발행하려다 전체공개'가
       되고 그건 되돌릴 수 없다(SUB1 실측 회신에서도 라벨 선택을 권고).
       라벨을 못 찾으면 **발행하지 않는다** — 공개 범위를 모르는 채 공개하느니 실패가 낫다."""
    label = sel.PUB_OPEN_TYPE_LABELS.get(kind)
    if not label:
        raise bc.SaveError(f"PUBLISH_OPEN_TYPE: 알 수 없는 공개설정 '{kind}'")
    try:
        loc = ctx.locator(f'label:has-text("{label}")').first
        if not loc.count():
            loc = ctx.locator(f'{sel.SEL_PUB_OPEN_TYPE_RADIO} + *:has-text("{label}")').first
        if not loc.count():
            raise bc.SaveError(
                f"PUBLISH_OPEN_TYPE: 공개설정 '{label}' 을 찾지 못했습니다 — "
                f"공개 범위를 확인하지 못한 채 발행하지 않습니다")
        loc.click()
        page.wait_for_timeout(400)
        bc.log(f"  공개설정: {label}")
    except bc.SaveError:
        raise
    except Exception as e:
        raise bc.SaveError(f"PUBLISH_OPEN_TYPE: 공개설정 선택 실패 — {str(e)[:80]}")


def _publish_now(ctx, page, open_type, tags, pub_calls, confirm_sec):
    """발행 설정 레이어를 열고 → 공개설정을 정하고 → **최종 발행**한다. 되돌릴 수 없다.

    실측 2026-08-12(Phase 0-C, SUB1):
      1단계 publish_btn__m9KHH "발행" → 레이어 열림(아직 발행 아님)
      2단계 confirm_btn__WEaBq "발행" → 실제 발행(POST RabbitWrite.naver)

    반환: 발행된 글 URL. 확정 못 하면 예외."""
    if not BLOG_PUBLISH_ENABLED:
        raise bc.SaveError(
            "PUBLISH_DISABLED: 발행 모드가 꺼져 있습니다 — .env 에 BLOG_PUBLISH_ENABLED=1 이 필요합니다")

    # 1단계 — 레이어 열기
    opener = bc.first(ctx, sel.SEL_PUB_OPEN_LAYER, timeout=6000)
    if not opener:
        raise bc.SaveError("PUBLISH_LAYER: 발행 버튼(1단계)을 찾지 못했습니다")
    opener.click()
    page.wait_for_timeout(1200)

    # 공개설정 — 못 고르면 여기서 중단(레이어만 열린 상태, 아직 발행 안 됨)
    _pick_open_type(ctx, page, open_type)

    # 태그(선택) — 실패해도 발행은 계속(서식성 정보)
    if tags:
        try:
            ti = bc.first(ctx, sel.SEL_PUB_TAG_INPUT, timeout=3000)
            if ti:
                ti.click()
                for t in tags[:30]:
                    page.keyboard.type(str(t), delay=bc.key_delay())
                    page.keyboard.press("Enter")
                    page.wait_for_timeout(150)
        except Exception as e:
            bc.log(f"  ! 태그 입력 실패(무시): {str(e)[:60]}")

    # 2단계 — 🔴 여기서부터 되돌릴 수 없다
    confirm = bc.first(ctx, sel.SEL_PUB_CONFIRM, timeout=6000)
    if not confirm:
        raise bc.SaveError("PUBLISH_CONFIRM: 최종 발행 버튼(2단계)을 찾지 못했습니다 — 발행하지 않았습니다")
    bc.log("  🔴 최종 발행 클릭 — 이 시점부터 되돌릴 수 없습니다")
    clicked_at = time.monotonic()
    confirm.click()

    # 발행 확정: RabbitWrite 응답 + logNo URL. 둘 중 하나라도 잡히면 '올라갔다'로 본다
    #   (저장과 달리 '못 잡았으니 재시도'가 위험하다 — 중복 발행이 된다).
    end = time.monotonic() + confirm_sec
    url = None
    while time.monotonic() < end:
        cur = page.url or ""
        if any(re.search(p, cur) for p in sel.PUBLISHED_URL_PATTERNS):
            url = cur
            break
        if any(c["t"] >= clicked_at and c["status"] < 400 for c in pub_calls):
            url = cur or "(발행 요청 200 · URL 미확정)"
            break
        page.wait_for_timeout(500)
    if not url:
        # 눌렀는데 확인이 안 됐다 → 올라갔을 수 있다. 재시도하면 중복 발행이므로 절대 금지.
        raise bc.PostClickError(
            "발행을 클릭했으나 확인하지 못했습니다 — 글이 올라갔을 수 있어 재시도하지 않습니다. 사람이 확인 필요")
    bc.log(f"  ✔ 발행 완료: {url[:110]}")
    return url


# ── 복원 팝업 처리 ───────────────────────────────────────────────────────────
def _dismiss_restore_popup(page, tries=3):
    """"작성 중인 글이 있습니다 … 이어서 작성하시겠습니까?" 팝업을 **[취소]**로 닫는다.

    왜 필요한가(실측 2026-08-11, SUB1): 복원거리가 있으면 postwrite 진입 시 매번 이 팝업이 뜨고,
    .se-popup-dim 이 전체화면을 덮어 제목·본문 클릭이 전부 타임아웃 → 저장이 통째로 막힌다.
    저장이 한 번이라도 중단되면 복원거리가 생기므로, 이 처리가 없으면 **그 계정의 저장이 영구히 막힌다.**

    🔴 반드시 [취소]. [확인]을 누르면 이전 글이 복원되고 우리 원고가 그 위에 덧붙는다 —
       _clear_editor 로 막으려던 바로 그 오염이다. 그래서 버튼을 **텍스트로 확인하고** 누른다.
       (셀렉터만 믿고 누르면 팝업 종류가 바뀌었을 때 '확인'을 누를 수 있다)

    반환: True=팝업을 닫음 / False=팝업 없었음. 못 닫으면 SaveError(fail-closed)."""
    for _ in range(tries):
        pop = bc.first(page, sel.SEL_RESTORE_POPUP, timeout=1500)
        if not pop:
            break
        btn = None
        for s in sel.SEL_RESTORE_CANCEL:
            try:
                loc = page.locator(s).first
                if not loc.count():
                    continue
                txt = (loc.inner_text() or "").strip()
                # 텍스트 검증 — '취소'가 있고 '확인'이 없어야 누른다.
                if "취소" in txt and "확인" not in txt:
                    btn = loc
                    break
            except Exception:
                continue
        if btn is None:
            raise bc.SaveError(
                "RESTORE_POPUP: 복원 팝업이 떴는데 '취소' 버튼을 찾지 못했습니다 — "
                "'확인'을 누르면 이전 글이 복원돼 원고가 오염되므로 중단합니다")
        bc.log("  복원 팝업 감지 → [취소](새로 작성) 클릭")
        btn.click()
        page.wait_for_timeout(600)

    # dim 이 남아 있으면 클릭이 계속 막히므로 진행하지 않는다.
    for _ in range(20):
        dim = None
        try:
            loc = page.locator(sel.SEL_POPUP_DIM[0]).first
            dim = loc.count() and loc.is_visible()
        except Exception:
            dim = False
        if not dim:
            return True
        page.wait_for_timeout(300)
    raise bc.SaveError("RESTORE_POPUP: 팝업 딤(.se-popup-dim)이 사라지지 않아 중단합니다")


# ── 에디터 조작 ──────────────────────────────────────────────────────────────
def _clear_editor(ctx, page):
    """문서를 완전히 비운다(제목 포함). **못 비우면 False(중단)** — fail-closed.

    ⚠️ 카페판(_clear_editor)은 컴포넌트를 못 찾으면 n=0/txt='' 이 되어 `n <= 1 and not txt` 로
       **'비웠다'고 True 를 반환**한다. top-level 가정이 깨지는 순간 정확히 반대로 동작해
       네이버가 복원해 둔 이전 임시저장분 위에 새 글이 겹쳐 써진다. 여기서는 못 찾으면 False.

    ⚠️ '비었다'의 기준선이 카페와 다르다. 카페는 컴포넌트 1개면 빈 글이었지만, 블로그는
       제목 섹션 + 본문 섹션이라 빈 문서에서도 2개 이상일 수 있다. 이 값을 잘못 잡으면
       비우기가 **영원히 실패**해 모든 작업이 죽으므로 실측값(EMPTY_COMPONENT_COUNT)을 쓴다."""
    empty_n = sel.EMPTY_COMPONENT_COUNT
    if empty_n is None:
        raise bc.SaveError(
            "SELECTORS_UNCONFIRMED: EMPTY_COMPONENT_COUNT 미측정 — probe_editor.py 로 "
            "빈 문서의 .se-component 개수를 재서 blog_selectors 에 넣으세요(비우기 오판 방지)")

    def _state():
        """(컴포넌트 수, 실내용 텍스트). 판정 JS 는 blog_common.CONTENT_TEXT_JS 한 벌만 쓴다
        (probe_editor.py 도 같은 것을 호출하므로, probe 가 통과하면 엔진도 같은 판정을 한다)."""
        n = ctx.evaluate("() => document.querySelectorAll('.se-component').length")
        t = bc.content_text(ctx, sel.PLACEHOLDER_CLASS_HINTS)
        return n, (t or "").strip()

    def _wipe(cands, key):
        """한 영역(제목 또는 본문)에 포커스를 두고 전체선택 후 삭제."""
        el = bc.first(ctx, cands, timeout=4000)
        if not el:
            return False
        el.click()
        page.wait_for_timeout(200)
        page.keyboard.press("Control+a")
        page.wait_for_timeout(220)
        page.keyboard.press(key)
        page.wait_for_timeout(450)
        return True

    # 비우기 '직전' 상태를 기록해 둔다 — 나중에 로그만 보고 '무엇을 지웠는지' 알 수 있어야 한다.
    #   빈 화면이면 ''(정상). 내용이 있으면 네이버가 이전 글을 복원해 둔 것이고, 그게 우리가
    #   반드시 지워야 하는 대상이다. (probe Q5 는 이 값이 non-empty 여야 검증이 유효하다 —
    #   항상 빈 문자열을 내는 고장 상태에서 '비우기 성공'이 나오는 거짓 통과를 막기 위함)
    try:
        pre_n, pre_txt = _state()
        bc.log(f"  비우기 전: component={pre_n} · 내용={'(없음)' if not pre_txt else repr(pre_txt[:60])}")
    except Exception as e:
        bc.log(f"  (비우기 전 상태 읽기 실패: {str(e)[:60]})")

    for attempt in range(4):
        try:
            # ⚠️ 제목과 본문을 **각각** 비운다.
            #    Ctrl+A 가 문서 전체를 잡는지 컴포넌트 단위인지 아직 확정되지 않았다(실측 저신뢰).
            #    컴포넌트 단위라면 본문만 지워지고 **복원된 이전 글의 제목이 남아**, 우리 제목이
            #    그 뒤에 이어붙는다. 둘 다 비우면 어느 쪽이든 안전하다.
            hit = False
            for key in ("Delete", "Backspace"):
                for cands in (sel.SEL_BODY, sel.SEL_TITLE):
                    hit = _wipe(cands, key) or hit
                n, txt = _state()
                if n <= empty_n and not txt:
                    return True
            if not hit:
                bc.log("  ! 제목/본문 영역을 찾지 못해 비우기 실패로 처리(겹쳐쓰기 방지)")
                return False
            bc.log(f"  에디터 비우기 재시도({attempt + 1}/4) — 컴포넌트 {n}개 · 잔존 텍스트 {txt[:40]!r}")
            if attempt < 3:
                page.goto(BLOG_WRITE_URL, wait_until="domcontentloaded")
                page.wait_for_timeout(2500)
                _dismiss_restore_popup(page)   # 재진입마다 복원 팝업이 다시 뜬다
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


# 본문 문단 중 텍스트가 정확히 일치하는 것을 찾아 화면 좌표를 돌려준다(요소가 아니라 좌표 —
#   마우스 클릭으로 캐럿을 그 문단에 두기 위해). 제목 섹션은 제외한다.
_FIND_PARA_JS = """(txt) => {
  const paras = [...document.querySelectorAll('.se-section-text .se-text-paragraph')];
  const el = paras.find(p => (p.innerText || '').trim() === txt);
  if (!el) return null;
  el.scrollIntoView({block: 'center'});
  const r = el.getBoundingClientRect();
  return {x: r.x + r.width / 2, y: r.y + r.height / 2};
}"""


def _convert_paragraph_to_quote(ctx, page, subtitle):
    """1패스에서 일반 문단으로 써둔 '부제목'을 인용구 블록으로 바꾼다.

    왜 2패스인가: 인용구 안에 커서가 갇혀 키보드로 빠져나올 수 없다. 그래서 본문을 먼저
    전부 일반 문단으로 쓴 뒤, 부제목 문단만 찾아 선택 → 인용구 버튼으로 '치환'한다
    (버튼이 선택 문단을 인용구로 바꾸고 커서를 그 안에 둔다 → 이웃 문단은 보존된다).

    ⚠️ 실패해도 저장을 막지 않는다. 인용구는 서식이라 없어도 글은 온전하다 —
       모양 때문에 저장 자체를 실패시키는 건 손해가 크다. 못 하면 일반 문단으로 남긴다."""
    try:
        pos = ctx.evaluate(_FIND_PARA_JS, subtitle)
        if not pos:
            bc.log(f"  ! 부제목 문단 못찾음(일반 문단으로 둠): {subtitle[:20]}")
            return False
        page.mouse.click(pos["x"], pos["y"])
        page.wait_for_timeout(180)
        page.keyboard.press("Home")
        page.keyboard.press("Shift+End")
        page.wait_for_timeout(180)
        btn = bc.first(ctx, sel.SEL_QUOTE_BTN, timeout=3000)
        if not btn:
            bc.log(f"  ! 인용구 버튼 못찾음(일반 문단으로 둠): {subtitle[:20]}")
            return False
        btn.click()
        page.wait_for_timeout(500)
        page.keyboard.type(subtitle, delay=bc.key_delay())
        page.wait_for_timeout(250)
        return True
    except Exception as e:
        bc.log(f"  ! 인용구 변환 실패(일반 문단으로 둠): {str(e)[:60]}")
        return False


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
def save_draft(page, title, blocks, dry_run=True, mode="save", open_type="public", tags=None):
    """글쓰기 → 제목/본문/이미지 채움 → **'저장'(임시저장)**. 반환: draft_seq(int) 또는 None.

    dry_run=True(기본)면 저장 버튼을 **찾기만 하고 누르지 않는다**."""
    if not sel.confirmed():
        raise bc.SaveError(
            "SELECTORS_UNCONFIRMED: blog_selectors.CONFIRMED_ON 이 비어 있습니다 — "
            "Phase 0(diag_blog.py) 실측 전에는 저장하지 않습니다(엉뚱한 버튼 클릭 방지)")
    if mode not in ("save", "publish"):
        raise bc.SaveError(f"MODE_INVALID: 알 수 없는 모드 '{mode}' — 'save' 또는 'publish' 만 허용")
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

    # 저장 요청 관측기 — 성공 판정의 유일한 근거. 자동저장(click=False)과 저장버튼(click=True)을 구분한다.
    save_calls = []

    def _on_response(resp):
        try:
            u = (resp.url or "").lower()
            if any(p in u for p in sel.SAVE_URL_PARTS):
                save_calls.append({
                    "click": sel.SAVE_CLICK_URL_PART in u,
                    "status": resp.status,
                    "t": time.monotonic(),
                    "url": resp.url,
                })
        except Exception:
            pass

    # 발행 요청 관측 — 발행 모드의 성공 판정에 쓴다(저장 모드에서는 '사고 감지'용으로만 본다).
    pub_calls = []

    def _on_pub_response(resp):
        try:
            if _is_publish_url(resp.url):
                pub_calls.append({"status": resp.status, "t": time.monotonic(), "url": resp.url})
        except Exception:
            pass

    page.on("response", _on_response)
    page.on("response", _on_pub_response)
    # ⚠️ 발행 차단 가드는 **저장 모드에서만** 건다. 발행 모드에서 걸면 자기 요청을 자기가 막는다.
    if mode == "save":
        _install_publish_guard(page, tripped)      # goto 전에 걸어야 한다
    else:
        bc.log("⚠️ 발행 모드 — 발행 차단 가드를 걸지 않습니다(이 작업은 실제로 공개 발행됩니다)")

    page.goto(BLOG_WRITE_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    if re.search(r"nid\.naver\.com|nidlogin", page.url or ""):
        raise bc.SaveError("LOGIN_REQUIRED: 네이버 로그인 필요 — 크롬(BLOG_CDP)에서 로그인하세요")
    # 계정 오배치 방지 — 지금 열린 글쓰기 페이지가 이 워커가 담당하는 블로그가 맞는가.
    #   카페엔 없던 검증이다(카페는 URL 하나가 곧 대상). 블로그는 프로필/포트가 계정마다라 섞이면
    #   A사 원고가 B사 블로그에 저장된다.
    if BLOG_ID and BLOG_ID.lower() not in (page.url or "").lower():
        raise bc.SaveError(f"BLOG_ID_MISMATCH: 현재 페이지({page.url[:80]})가 담당 블로그({BLOG_ID})가 아닙니다")

    # ⚠️ 복원 팝업을 먼저 닫는다. 딤이 화면을 덮고 있으면 이후 모든 클릭이 타임아웃난다.
    #    (DOM 조회는 팝업 뒤에서도 되기 때문에 '컴포넌트 2개·내용 없음' 같은 로그가 정상으로 보인다 —
    #     그래서 증상이 '비우기 실패'로만 나타나 원인을 놓치기 쉽다)
    _dismiss_restore_popup(page)

    ctx, where = bc.resolve_ctx(page, sel.FRAME_HINT, sel.SEL_EDITOR)
    bc.log(f"에디터 컨텍스트: {where}")

    # ⚠️ 순서 고정: **비우기 → 제목 → 본문**.
    #    카페는 제목이 별도 textarea 라 '제목 → 비우기' 가 안전했지만, 블로그는 문서 전체가
    #    단일 contenteditable 이라(실측 2026-08-11) 비우기의 Ctrl+A 가 **제목까지 선택**한다.
    #    제목을 먼저 치면 그 직후 비우기에 통째로 지워진다. 순서를 바꾸지 말 것.
    ed = bc.first(ctx, sel.SEL_EDITOR, timeout=6000)
    if not ed:
        raise bc.SaveError("에디터 영역 못 찾음 — diag_blog.py 로 SEL_EDITOR 확정 필요")
    page.wait_for_timeout(300)
    if not _clear_editor(ctx, page):
        raise bc.SaveError("에디터를 비우지 못했습니다 — 이전 글이 남아 있어 저장을 중단합니다")

    before_seq = _draft_count(ctx)
    bc.log(f"저장 전 임시저장 개수: {before_seq if before_seq is not None else '(읽기 실패)'}")

    # 제목 — 자체 입력칸이 아니라 문서 안의 제목 문단이라 fill() 이 안 먹는다. 클릭 후 타이핑.
    t = bc.first(ctx, sel.SEL_TITLE, timeout=6000)
    if not t:
        page.wait_for_timeout(2500)
        t = bc.first(ctx, sel.SEL_TITLE, timeout=6000)
    if not t:
        raise bc.SaveError("제목 입력칸 못 찾음(페이지 준비 지연/셀렉터 미확정)")
    t.click()
    page.wait_for_timeout(200)
    page.keyboard.type(title, delay=bc.key_delay())

    # 본문으로 포커스 이동 — ⚠️ SEL_EDITOR(.se-content) 를 쓰면 안 된다. 그 하위 첫 문단은
    #    **제목**이라 본문이 제목칸에 이어붙는다(실측: .se-content .se-text-paragraph = 2개).
    body = bc.first(ctx, sel.SEL_BODY, timeout=6000)
    if not body:
        raise bc.SaveError("본문 영역 못 찾음 — probe_editor.py 로 SEL_BODY 확정 필요")
    body.click()
    page.wait_for_timeout(300)

    # ── 본문 채우기 (페이싱: 총 작성시간 BLOG_MIN~MAX 초 확보) ──
    n_blocks = len(blocks)
    target = bc.write_seconds()
    bc.log(f"작성 페이싱: 목표 {target/60:.0f}분")
    deadline = time.monotonic() + target
    subtitles = []          # 2패스에서 인용구로 바꿀 부제목들
    for idx, b in enumerate(blocks):
        if b["type"] == "text":
            bc.type_multiline(page, b["text"])
        elif b["type"] == "quote":
            # 1패스: 일반 문단으로 써두고(앵커) 2패스에서 인용구로 치환한다.
            page.keyboard.type(b["text"], delay=bc.key_delay())
            page.keyboard.press("Enter")
            subtitles.append(b["text"])
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

    # ── 2패스: 부제목 문단 → 인용구 변환 (서식이므로 실패해도 저장은 계속) ──
    if subtitles:
        done = sum(1 for s in subtitles if _convert_paragraph_to_quote(ctx, page, s))
        bc.log(f"인용구 변환: {done}/{len(subtitles)}")

    if mode == "save":
        _assert_not_published(page, "본문 작성 후")

    # ── 발행 모드 ── (저장 버튼 경로를 타지 않는다)
    if mode == "publish":
        if dry_run:
            btn = bc.first(ctx, sel.SEL_PUB_OPEN_LAYER, timeout=6000)
            bc.log(f"[DRY] 발행 모드 — 1단계 버튼 {'발견' if btn else '못 찾음'}. 누르지 않고 종료합니다.")
            return None
        return _publish_now(ctx, page, open_type, tags, pub_calls, BLOG_CONFIRM_SEC)

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
    clicked_at = time.monotonic()
    btn.click()
    page.wait_for_timeout(1500)

    # ── 저장 확인 ──
    # 🔴 '카운터가 늘었다'를 성공 근거로 쓰면 안 된다. 네이버가 타이핑 중에도 자동저장
    #    (RabbitAutoSaveWrite)을 돌려 카운터를 스스로 올리기 때문에(실측: 0→1 저절로 증가),
    #    저장 버튼을 누르지 않아도 조건이 충족돼 **거짓 성공**이 된다.
    #    성공 근거는 '클릭 이후 저장 요청(RabbitTempPostWrite)이 OK 로 응답했는가' 하나뿐이다.
    #    (URL 은 임시저장에서 바뀌지 않으므로 역시 성공 신호로 쓸 수 없다.)
    ok_save = None
    end = time.monotonic() + BLOG_CONFIRM_SEC
    while time.monotonic() < end:
        ok_save = next((s for s in save_calls
                        if s["t"] >= clicked_at and s["click"] and s["status"] < 400), None)
        if ok_save:
            break
        page.wait_for_timeout(500)

    _assert_not_published(page, "저장 클릭 후")
    hits = _guard_report(page, tripped)
    if hits:
        raise bc.GuardTripped(f"발행 가드 발동: {hits}")

    if not ok_save:
        after = [s for s in save_calls if s["t"] >= clicked_at]
        raise bc.SaveError(
            f"저장 확인 실패 — 클릭 후 저장 요청({sel.SAVE_CLICK_URL_PART}) 응답이 없습니다. "
            f"클릭 후 관측된 저장계열 요청 {len(after)}건: {[ (s['status'], s['url'][:60]) for s in after[:3] ]}. "
            f"{('alert: ' + alerts[-1]) if alerts else ''}")

    # 카운터는 '참고용'으로만 읽는다(사람이 임시저장함에서 글을 찾는 단서).
    seq = _draft_count(ctx)
    n_auto = sum(1 for s in save_calls if not s["click"])
    bc.log(f"✔ 임시저장 완료 — 저장요청 {ok_save['status']} · 저장카운터 {seq} "
           f"(참고: 자동저장 {n_auto}회 발생, 성공판정에는 쓰지 않음)")
    return seq


def save_job(job, cdp_url=DEFAULT_CDP, dry_run=True):
    """job['mode'] 가 'publish' 면 발행, 아니면(기본) 저장. mode 가 없으면 'save' 로 떨어진다."""
    """큐 1건 저장 — 이미지 다운로드 + 본문 마커 파싱 → 저장. (draft_seq 또는 예외)"""
    # 🔴 job 의 블로그 == 이 워커의 블로그인지 먼저 대조한다.
    #    리스너는 blog_id 로 필터링해 claim 하므로 안전하지만, CLI 로 `--job <id>` 를 직접 돌리면
    #    아무 필터도 없다 → **A 블로그용 원고가 B 블로그에 저장**될 수 있다.
    #    계정을 교체하는 시점(구 계정 job 이 큐에 남아 있는 상태)이 정확히 이 사고가 나는 순간이다.
    #    (save_draft 의 BLOG_ID_MISMATCH 는 '지금 열린 페이지'만 보므로 이걸 못 잡는다)
    job_blog = (job.get("blog_id") or "").strip()
    if BLOG_ID and job_blog and job_blog.lower() != BLOG_ID.lower():
        raise bc.SaveError(
            f"BLOG_ID_MISMATCH: 이 job 은 '{job_blog}' 용인데 이 워커는 '{BLOG_ID}' 입니다 — "
            f"다른 블로그에 저장되는 사고를 막기 위해 중단합니다(.env 의 BLOG_ID 확인)")

    images, body, _tmp = bc.download_manifest(job.get("manifest") or [])
    blocks = bc.parse_body_to_blocks(body, images)
    bc.preflight(job.get("title"), blocks, body, images)
    bc.log(f"블록 파싱: 텍스트 {sum(1 for b in blocks if b['type']=='text')} · "
           f"이미지 {sum(1 for b in blocks if b['type']=='image')} · "
           f"인용구 {sum(1 for b in blocks if b['type']=='quote')}")
    with sync_playwright() as p:
        page = bc.connect(p, cdp_url)
        mode = (job.get("mode") or "save").strip().lower()
        if mode == "publish":
            bc.log("🔴 이 작업은 **발행(공개)** 모드입니다 — 되돌릴 수 없습니다")
        return save_draft(page, job.get("title") or "제목", blocks, dry_run=dry_run,
                          mode=mode, open_type=(job.get("open_type") or "public"),
                          tags=job.get("tags"))


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
