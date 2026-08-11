# -*- coding: utf-8 -*-
"""Phase 0-B — 본문/제목 분리 + 빈 문서 기준선 실측 (읽기 전용).

⚠️ **아무것도 타이핑하지 않고 저장/발행도 하지 않는다.** 셀렉터 개수를 세고,
   선택 영역이 어디까지 잡히는지 읽기만 한다(Ctrl+A 후 선택 텍스트를 읽고 즉시 해제).

Phase 0(diag_blog.py) 결과로 드러난, 반드시 확정해야 하는 3가지를 잰다:

  Q1. 본문 전용 셀렉터 — `.se-content .se-text-paragraph` 는 제목+본문 2개가 잡힌다.
      first() 가 제목을 집어 본문이 제목칸에 들어가는 사고를 막으려면 본문만 고르는 셀렉터가 필요.

  Q2. **빈 문서의 .se-component 개수** — save_blog._clear_editor 는 `n <= 1` 을 '비었다'로 본다.
      블로그는 제목 섹션 + 본문 섹션이라 빈 상태에서도 2 이상일 수 있고, 그러면 비우기가
      **영원히 실패**해 모든 작업이 죽는다. 실측값을 EMPTY_COMPONENT_COUNT 에 넣어야 한다.

  Q3. **Ctrl+A 가 제목까지 선택하는가** — 편집영역이 문서 전체 하나면 제목도 함께 지워진다.
      그러면 '제목 입력 → 비우기' 순서가 틀린 것이고 '비우기 → 제목' 으로 뒤집어야 한다.

  Q4. placeholder 마크업 + **엔진의 '비었나' 판정 JS 가 빈 문서에서 정말 '' 를 내는가**.
      빈 문서 innerText 가 "제목 / 나를 돌아보는 회고…#모두의회고 / 추가할 컴포넌트를 선택하세요."
      였고, 가운데는 네이버가 날마다 바꾸는 프롬프트라 문자열 목록으로는 못 쫓아간다.
      그래서 엔진을 'placeholder 요소를 DOM 에서 제거하고 남는 텍스트' 방식으로 바꿨는데,
      그 방식이 이 페이지에서 실제로 통하는지 확인해야 한다. False 면 비우기가 영원히 실패한다.

  Q5. (선택) 더미 입력 → 비우기 → 검증까지 **전체 사이클**. Ctrl+A 범위도 내용이 있는 상태에서
      다시 재기 때문에 고신뢰다. ⚠️ 타이핑하므로 네이버 **자동저장이 임시저장 1건을 만들 수 있다**
      (테스트 블로그에서만 하고, 끝나면 임시저장함에서 'PROBE…' 건을 지울 것).

[사용] 크롬(9235)에 로그인된 상태에서, **빈 글쓰기 화면**으로 실행할 것.
  python probe_editor.py                    # Q1~Q4 (읽기 전용, 타이핑 없음)
  PROBE_DIRTY=1 python probe_editor.py      # + Q5 (더미 입력 포함)
  Windows cmd:  set PROBE_DIRTY=1 && python probe_editor.py
  ⚠️ 이전 글이 복원돼 있으면 Q2 가 오염된다. 화면에 글이 남아 있으면 먼저 손으로 비우고 실행.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_common as bc          # noqa: E402
import blog_selectors as sel      # noqa: E402
from playwright.sync_api import sync_playwright   # noqa: E402

bc.load_env()
CDP = os.environ.get("BLOG_CDP", "http://127.0.0.1:9235")
WRITE_URL = os.environ.get("BLOG_WRITE_URL", "")

# Q1 후보 — 본문만 잡아야 한다(제목 제외).
BODY_CANDIDATES = [
    '.se-section-text .se-text-paragraph',
    '.se-component.se-text .se-text-paragraph',
    '.se-section-text',
    '.se-component.se-text',
]
TITLE_CANDIDATES = [
    '.se-section-documentTitle .se-text-paragraph',
    '.se-title-text',
    '.se-documentTitle',
    '.se-section-documentTitle',
]


def count(ctx, s):
    try:
        return ctx.locator(s).count()
    except Exception:
        return -1


def main():
    if not WRITE_URL:
        bc.log("BLOG_WRITE_URL 미설정")
        return 2
    with sync_playwright() as p:
        page = bc.connect(p, CDP)
        page.goto(WRITE_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(3000)
        if re.search(r"nid\.naver\.com|nidlogin", page.url or ""):
            bc.log("🔴 로그인 필요")
            return 3
        ctx, where = bc.resolve_ctx(page, sel.FRAME_HINT, sel.SEL_EDITOR)
        bc.log(f"컨텍스트: {where}  URL: {page.url[:80]}")

        # ── Q2. 빈 문서 기준선 ────────────────────────────────────────────
        bc.log("── Q2. 빈 문서 기준선 (이전 글이 남아 있으면 오염됨!) ──")
        n_comp = count(ctx, '.se-component')
        try:
            inner = ctx.evaluate("() => (document.querySelector('.se-content') || {}).innerText || ''")
        except Exception as e:
            inner = f"<읽기실패 {e}>"
        bc.log(f"  .se-component 개수 = {n_comp}   ← EMPTY_COMPONENT_COUNT 후보")
        bc.log(f"  .se-content innerText = {json.dumps((inner or '')[:200], ensure_ascii=False)}")
        for s in ['.se-component.se-text', '.se-component.se-documentTitle',
                  '[contenteditable="true"]', '.se-section']:
            bc.log(f"  {s} = {count(ctx, s)}")

        # ── Q1. 제목 / 본문 분리 ──────────────────────────────────────────
        bc.log("── Q1. 제목 후보 ──")
        for s in TITLE_CANDIDATES:
            bc.log(f"  {count(ctx, s):>3}개  {s}")
        bc.log("── Q1. 본문 후보 (제목이 안 섞여야 정답) ──")
        for s in BODY_CANDIDATES:
            c = count(ctx, s)
            mark = "✔" if c == 1 else ("?" if c > 1 else " ")
            bc.log(f"  {mark} {c:>3}개  {s}")

        # 본문 후보가 정말 '제목이 아닌지' DOM 위치로 교차검증
        bc.log("── Q1. 교차검증: 각 후보의 첫 요소가 제목 섹션 안에 있는가 ──")
        for s in BODY_CANDIDATES + TITLE_CANDIDATES:
            try:
                inside = ctx.evaluate(
                    """(sel) => { const e = document.querySelector(sel);
                         if (!e) return null;
                         return !!e.closest('.se-section-documentTitle, .se-documentTitle'); }""", s)
            except Exception:
                inside = "err"
            bc.log(f"  {s} → 제목섹션 안? {inside}")

        # ── Q3. Ctrl+A 범위 (읽기만 하고 즉시 해제 — 삭제 없음) ───────────
        bc.log("── Q3. Ctrl+A 선택 범위 (타이핑·삭제 없음) ──")
        body_sel = next((s for s in BODY_CANDIDATES if count(ctx, s) >= 1), None)
        if not body_sel:
            bc.log("  본문 후보를 못 찾아 Q3 생략")
        else:
            try:
                loc = ctx.locator(body_sel).first
                loc.click()
                page.wait_for_timeout(200)
                page.keyboard.press("Control+a")
                page.wait_for_timeout(300)
                info = ctx.evaluate("""() => {
                    const s = window.getSelection();
                    if (!s || s.rangeCount === 0) return {text: '', title: null};
                    const r = s.getRangeAt(0);
                    const frag = r.cloneContents();
                    const div = document.createElement('div'); div.appendChild(frag);
                    const titleEl = document.querySelector('.se-section-documentTitle, .se-documentTitle');
                    return {
                        text: (s.toString() || '').slice(0, 200),
                        titleSelected: titleEl ? r.intersectsNode(titleEl) : null,
                    };
                }""")
                bc.log(f"  선택 텍스트: {json.dumps(info.get('text', ''), ensure_ascii=False)}")
                bc.log(f"  ⭐ 제목이 선택에 포함됐나: {info.get('titleSelected')}")
                bc.log("     → True 면 '비우기 → 제목' 순서여야 한다(제목 먼저 치면 지워짐)")
            except Exception as e:
                bc.log(f"  Q3 실패: {str(e)[:100]}")
            finally:
                try:   # 선택 해제 — 아무것도 지우지 않는다
                    page.keyboard.press("ArrowRight")
                    ctx.evaluate("() => window.getSelection().removeAllRanges()")
                except Exception:
                    pass

        # ── 저장/발행 버튼 재확인 ─────────────────────────────────────────
        bc.log("── 저장/발행 버튼 ──")
        for label, cands in [("SEL_SAVE", sel.SEL_SAVE),
                             ("SEL_DRAFT_COUNT", sel.SEL_DRAFT_COUNT),
                             ("BLOCK(발행)", sel.BLOCK_CLICK_SELECTORS)]:
            for s in cands:
                bc.log(f"  {count(ctx, s):>3}개  [{label}] {s}")
        try:
            btns = ctx.evaluate("""() => [...document.querySelectorAll('button')]
                .map(b => ({c: (b.className||'').toString().slice(0,40),
                            t: (b.innerText||'').replace(/\\s+/g,' ').trim().slice(0,20)}))
                .filter(b => /저장|발행|예약/.test(b.t) || /save|publish|reserve/i.test(b.c))""")
            bc.log("  실제 버튼 목록: " + json.dumps(btns, ensure_ascii=False))
        except Exception as e:
            bc.log(f"  버튼 열거 실패: {str(e)[:80]}")

        # ── Q4. placeholder 마크업 + 엔진의 '비었나' 판정 JS 실검증 ────────
        #   빈 문서 innerText 가 "제목 / (날마다 바뀌는 프롬프트) / 추가할 컴포넌트를 선택하세요."
        #   라서 문자열 빼기로는 못 잡는다. 엔진은 placeholder 요소를 DOM 에서 빼는 방식으로 바꿨는데,
        #   그 방식이 **이 페이지에서 실제로 빈 문자열을 내는지**가 핵심이다.
        bc.log("── Q4. placeholder 마크업 / 엔진 판정 JS 실검증 ──")
        try:
            phs = ctx.evaluate("""() => [...document.querySelectorAll('[class*=placeholder i]')]
                .slice(0, 10).map(e => ({tag: e.tagName, c: (e.className||'').toString().slice(0,60),
                                         t: (e.innerText||'').slice(0,40)}))""")
            bc.log("  placeholder 요소: " + json.dumps(phs, ensure_ascii=False))
        except Exception as e:
            bc.log(f"  placeholder 열거 실패: {str(e)[:80]}")
        for label, s in [("제목 문단", '.se-section-documentTitle .se-text-paragraph'),
                         ("본문 문단", '.se-section-text .se-text-paragraph')]:
            try:
                html = ctx.evaluate("(sel)=>{const e=document.querySelector(sel);return e?e.outerHTML.slice(0,400):null;}", s)
                bc.log(f"  {label} outerHTML: {html}")
            except Exception as e:
                bc.log(f"  {label} 실패: {str(e)[:60]}")
        # ⚠️ 엔진과 **같은 함수**를 부른다(blog_common.CONTENT_TEXT_JS). 복붙 두 벌이면
        #    probe 는 통과하는데 엔진은 다른 걸 검사하는 상태가 된다 — 실제로 그랬다.
        try:
            engine_txt = bc.content_text(ctx, sel.PLACEHOLDER_CLASS_HINTS)
            ok = (engine_txt == "")
            bc.log(f"  ⭐ 엔진 판정 텍스트 = {json.dumps(engine_txt[:120], ensure_ascii=False)}")
            bc.log(f"     빈 문서에서 '' 인가: {ok}  ← False 면 비우기가 영원히 실패한다")
            if engine_txt == "<NO_SE_NODE>":
                bc.log("     🔴 .se-text-paragraph .__se-node 를 못 찾음 = 마크업 변경. 셀렉터 재확정 필요")
            n_node = count(ctx, '.se-text-paragraph .__se-node')
            n_ph = count(ctx, '.se-text-paragraph .se-placeholder')
            bc.log(f"     내용노드(.__se-node)={n_node} · placeholder={n_ph}  (빈 문서면 노드는 있고 텍스트만 비어야 정상)")
        except Exception as e:
            bc.log(f"  엔진 판정 JS 실패: {str(e)[:80]}")

        # ── Q5. (선택) 더러운 상태 → 비우기 → 검증 전체 사이클 ────────────
        if os.environ.get("PROBE_DIRTY") == "1":
            bc.log("── Q5. 더미 입력 → 비우기 사이클 (⚠️ 자동저장이 임시저장 1건을 만들 수 있음) ──")
            try:
                tl = ctx.locator('.se-section-documentTitle .se-text-paragraph').first
                bl = ctx.locator('.se-section-text .se-text-paragraph').first
                tl.click(); page.wait_for_timeout(200)
                page.keyboard.type("PROBE 제목 테스트", delay=40)
                bl.click(); page.wait_for_timeout(200)
                page.keyboard.type("PROBE 본문 첫 줄", delay=40)
                page.wait_for_timeout(1200)
                bc.log(f"  더미 입력 후 component={count(ctx, '.se-component')}")
                # Ctrl+A 범위 재측정 (내용이 있는 상태 = 고신뢰)
                bl.click(); page.wait_for_timeout(200)
                page.keyboard.press("Control+a"); page.wait_for_timeout(300)
                info = ctx.evaluate("""() => {
                    const s = window.getSelection();
                    if (!s || s.rangeCount === 0) return {text:'', titleSelected:null};
                    const r = s.getRangeAt(0);
                    const t = document.querySelector('.se-section-documentTitle, .se-documentTitle');
                    return {text:(s.toString()||'').slice(0,120), titleSelected: t ? r.intersectsNode(t) : null};
                }""")
                bc.log(f"  ⭐ Ctrl+A 선택 텍스트: {json.dumps(info.get('text',''), ensure_ascii=False)}")
                bc.log(f"  ⭐ 제목 포함 여부: {info.get('titleSelected')}  (고신뢰 — 내용이 있는 상태)")
                # 엔진과 같은 방식으로 비우기: 제목/본문 각각 Ctrl+A + Delete/Backspace
                for key in ("Delete", "Backspace"):
                    for s in ('.se-section-text .se-text-paragraph',
                              '.se-section-documentTitle .se-text-paragraph'):
                        try:
                            ctx.locator(s).first.click(); page.wait_for_timeout(180)
                            page.keyboard.press("Control+a"); page.wait_for_timeout(200)
                            page.keyboard.press(key); page.wait_for_timeout(400)
                        except Exception:
                            pass
                n2 = count(ctx, '.se-component')
                t2 = bc.content_text(ctx, sel.PLACEHOLDER_CLASS_HINTS)
                bc.log(f"  ⭐ 비우기 후: component={n2} · 엔진텍스트={json.dumps(t2[:120], ensure_ascii=False)}")
                bc.log(f"     성공 조건(component<=2 and 텍스트==''): {n2 <= 2 and t2 == ''}")
            except Exception as e:
                bc.log(f"  Q5 실패: {str(e)[:120]}")
            bc.log("  ⚠️ 자동저장으로 임시저장이 생겼을 수 있습니다 — 임시저장함에서 'PROBE…' 건을 지워주세요.")

        bc.log("완료 — 출력 전체를 main 에 전달하세요.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
