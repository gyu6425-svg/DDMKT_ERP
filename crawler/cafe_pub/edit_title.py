# -*- coding: utf-8 -*-
"""발행글 '제목만' 수정 — 편집 URL(.../articles/<id>/modify) 직접 진입 → 제목칸 교체 → 저장.
본문/이미지/태그는 건드리지 않음. 저장 확인창은 승인.
사용: python edit_title.py <articleid> "<새 제목>" [--apply]
      --apply 없으면 현재 제목만 확인(저장 안 함)."""
import sys, re
import publish_cafe as pc
from playwright.sync_api import sync_playwright
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

CLUB = "31754130"


def edit_title(art, new_title, apply=False):
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(pc.DEFAULT_CDP)
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        page = ctx.new_page()   # 전용 새 탭(다른 탭 안 건드림)
        # 대화상자가 우리가 처리하기 전에 스스로 닫히면 accept()가 "No dialog is showing" 예외를 던져
        #   콜백 안에서 프로세스를 죽인다(publish_cafe 에서 겪은 크래시) → 삼킨다.
        def _safe_accept(d):
            try:
                d.accept()
            except Exception:
                pass
        page.on("dialog", _safe_accept)   # 저장 확인창 승인
        try:
            page.goto(f"https://cafe.naver.com/ca-fe/cafes/{CLUB}/articles/{art}/modify",
                      wait_until="domcontentloaded")
            page.wait_for_timeout(3000)
            if re.search(r"nid\.naver\.com|nidlogin", page.url or ""):
                raise RuntimeError("LOGIN_REQUIRED")
            t = pc._first(page, pc.SEL_TITLE, timeout=12000)
            if not t:
                raise RuntimeError("편집기 제목칸 못 찾음(수정 진입 실패)")
            page.wait_for_timeout(800)
            cur = (t.input_value() or "").strip()
            print(f"[art {art}] 현재: {cur}")
            print(f"[art {art}] 변경: {new_title}")
            if not cur:
                raise RuntimeError("현재 제목 비어있음 — 수정 진입 실패로 판단, 중단")
            if not apply:
                print("  (dry: 저장 안 함)"); return
            t.click(); t.fill(new_title); page.wait_for_timeout(500)
            sub = pc._first(page, pc.SEL_SUBMIT, timeout=8000)
            if not sub:
                raise RuntimeError("등록/수정완료 버튼 못 찾음")
            before = page.url
            sub.click()
            for _ in range(24):
                page.wait_for_timeout(500)
                if "/modify" not in page.url and page.url != before:
                    print(f"  ✅ 저장 완료 → {page.url}"); return
            print(f"  ⚠️ 이동 확인 애매(현재 {page.url}) — 카페에서 제목 확인 요망")
        finally:
            try:
                page.close()
            except Exception:
                pass


if __name__ == "__main__":
    art = sys.argv[1]; new_title = sys.argv[2]
    apply = "--apply" in sys.argv[3:]
    edit_title(art, new_title, apply=apply)
