# -*- coding: utf-8 -*-
"""Phase 0 — 네이버 블로그 글쓰기 페이지 실측 도구 (셀렉터/프레임/엔드포인트 확정).

이 스크립트는 **아무것도 입력하지 않고 아무 버튼도 누르지 않는다.** 구조를 보기만 한다.

[준비] SUB1 에서
  1) run_chrome_blog.bat  → 크롬(포트 9235, 전용 프로필) 기동
  2) 그 창에서 대상 블로그 계정으로 1회 수동 로그인
  3) blog_pub/.env 에 BLOG_WRITE_URL 설정

[사용]
  python diag_blog.py                # 프레임/입력칸/버튼/에디터 덤프
  python diag_blog.py --record 180   # 180초 동안 네트워크 요청을 기록(_endpoints.txt)
      → 이 시간 동안 **사람이 직접** 저장을 눌러 본다. 어떤 POST 가 나가는지 기록된다.
      → 발행 엔드포인트도 알아야 차단할 수 있다. 다만 발행 실측은 **테스트 블로그에서만** 할 것.

결과로 selectors.py 를 채우고 CONFIRMED_ON 에 날짜를 적으면 save_blog.py 가 저장 모드를 허용한다.
"""
import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_common as bc          # noqa: E402
# ⚠️ 파일명이 blog_selectors 인 이유: 'selectors' 는 파이썬 표준 라이브러리 모듈명이라
#    sys.path 최우선에 이 폴더를 넣는 순간 asyncio/Playwright 가 쓰는 stdlib selectors 를 가려버린다.
import blog_selectors as sel      # noqa: E402
from playwright.sync_api import sync_playwright   # noqa: E402

bc.load_env()
CDP = os.environ.get("BLOG_CDP", "http://127.0.0.1:9235")
WRITE_URL = os.environ.get("BLOG_WRITE_URL", "")

DUMP_JS = """() => {
  const pick = (sel) => [...document.querySelectorAll(sel)].slice(0, 25).map(e => ({
    t: e.tagName,
    c: (e.className || '').toString().slice(0, 60),
    ph: e.getAttribute('placeholder') || '',
    dl: e.getAttribute('data-log') || '',
    txt: (e.innerText || '').replace(/\\s+/g, ' ').slice(0, 24),
  }));
  return {
    inputs: pick('input,textarea'),
    buttons: pick('button,a[role=button],a.btn,a[class*=button]'),
    editable: pick('[contenteditable=true]'),
  };
}"""


def _dump(ctx, label):
    try:
        info = ctx.evaluate(DUMP_JS)
    except Exception as e:
        bc.log(f"  [{label}] 평가 실패: {str(e)[:80]}")
        return
    n = len(info["inputs"]) + len(info["buttons"]) + len(info["editable"])
    if not n:
        return
    bc.log(f"── [{label}] ──")
    bc.log("  입력칸: " + json.dumps(info["inputs"], ensure_ascii=False))
    bc.log("  버튼:   " + json.dumps(info["buttons"], ensure_ascii=False))
    bc.log("  에디터: " + json.dumps(info["editable"], ensure_ascii=False))
    # 저장/발행처럼 보이는 버튼만 따로 추려서 눈에 띄게
    hits = [b for b in info["buttons"] if re.search(r"저장|발행|예약|공개", b.get("txt", ""))]
    if hits:
        bc.log("  ⭐ 저장/발행 후보: " + json.dumps(hits, ensure_ascii=False))


def _record(page, seconds):
    """사람이 직접 조작하는 동안 나가는 요청을 기록 — 저장 vs 발행 엔드포인트 분리용."""
    seen = []

    def on_req(req):
        try:
            if req.method in ("POST", "PUT"):
                seen.append({"m": req.method, "url": req.url[:300]})
                bc.log(f"  [{req.method}] {req.url[:160]}")
        except Exception:
            pass

    page.on("request", on_req)
    bc.log(f"⏺ {seconds}초 동안 기록합니다. 지금 브라우저에서 '저장'을 눌러 보세요.")
    bc.log("   (발행은 테스트 블로그에서만! 발행 엔드포인트는 '차단 대상'을 알기 위해 필요합니다.)")
    deadline = time.time() + seconds
    while time.time() < deadline:
        page.wait_for_timeout(1000)
    out = os.path.join(bc.HERE, "_endpoints.txt")
    with open(out, "w", encoding="utf-8") as f:
        for s in seen:
            f.write(f"{s['m']} {s['url']}\n")
    bc.log(f"✔ {len(seen)}건 기록 → {out}")
    bc.log("   이 목록에서 저장 요청 URL 조각 → selectors.SAVE_URL_PARTS,")
    bc.log("                발행 요청 URL 조각 → selectors.BLOCK_URL_PARTS 에 넣으세요.")
    bc.log("   ⚠️ 둘이 같은 엔드포인트면 URL 차단은 쓸 수 없습니다 — selectors.py 주석에 기록할 것.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cdp", default=CDP)
    ap.add_argument("--record", type=int, default=0, help="N초 동안 네트워크 요청 기록")
    a = ap.parse_args()

    if not WRITE_URL:
        bc.log("BLOG_WRITE_URL 미설정 — blog_pub/.env 에 글쓰기 주소를 넣으세요.")
        return 2

    with sync_playwright() as p:
        page = bc.connect(p, a.cdp)
        page.goto(WRITE_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(3000)
        bc.log(f"URL: {page.url}")
        if re.search(r"nid\.naver\.com|nidlogin", page.url or ""):
            bc.log("🔴 로그인 페이지로 튕겼습니다 — 크롬 창에서 수동 로그인 후 다시 실행하세요.")
            return 3

        bc.log(f"프레임 {len(page.frames)}개:")
        for f in page.frames:
            bc.log(f"  · name={f.name!r} url={(f.url or '')[:100]}")

        _dump(page.main_frame, "main")
        for f in page.frames:
            if f != page.main_frame:
                _dump(f, f"frame:{f.name or (f.url or '')[:40]}")

        # 현재 selectors.py 후보가 실제로 맞는지 즉석 검증
        bc.log("── 현재 selectors.py 후보 매칭 결과 ──")
        try:
            ctx, where = bc.resolve_ctx(page, sel.FRAME_HINT, sel.SEL_EDITOR)
            bc.log(f"  에디터 컨텍스트: {where}")
        except Exception as e:
            ctx, where = page, "page(폴백-미검증)"
            bc.log(f"  🔴 에디터 컨텍스트 못 찾음: {e}")
        for name, cands in [("SEL_TITLE", sel.SEL_TITLE), ("SEL_BODY", sel.SEL_BODY),
                            ("SEL_EDITOR", sel.SEL_EDITOR),
                            ("SEL_IMG_BTN", sel.SEL_IMG_BTN), ("SEL_SAVE", sel.SEL_SAVE),
                            ("SEL_DRAFT_COUNT", sel.SEL_DRAFT_COUNT)]:
            for s in cands:
                try:
                    c = ctx.locator(s).count()
                except Exception:
                    c = -1
                mark = "✔" if c > 0 else ("?" if c == 0 else "!")
                bc.log(f"  {mark} {name}: {s}  → {c}개")

        if a.record:
            _record(page, a.record)

        bc.log("완료. 위 결과로 selectors.py 를 채우고 CONFIRMED_ON 에 오늘 날짜를 적으세요.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
