"""ERP 주문서 작성 화면 캡처 — 노션 안내 페이지에 넣을 그림.
   ⚠️ 테스트 계정(test0819)만 쓴다. 실제 고객 계정으로 찍으면 남의 업체 정보가 공개 페이지에 올라간다."""
import sys, pathlib
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
OUT = pathlib.Path(r"C:\Users\ddmkt\AppData\Local\Temp\claude\c--Users-ddmkt-DDMKT-ERP\8bcc1bc1-1e65-4a48-8b04-aa70156182f9\scratchpad\shots")
OUT.mkdir(exist_ok=True)
BASE = "https://ddmkt-erp.pages.dev"
ID, PW = "test0819", "test0819"


def shot(page, sel, name, pad=8):
    el = page.query_selector(sel)
    if not el:
        print(f"  ! 못 찾음 {name} ({sel})")
        return False
    el.scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    box = el.bounding_box()
    if not box or box["height"] < 10:
        print(f"  ! 크기 0 {name}")
        return False
    page.screenshot(path=str(OUT / f"{name}.png"), clip={
        "x": max(0, box["x"] - pad), "y": max(0, box["y"] - pad),
        "width": box["width"] + pad * 2, "height": min(box["height"] + pad * 2, 1600)})
    print(f"  ✓ {name}.png  ({int(box['width'])}x{int(box['height'])})")
    return True


with sync_playwright() as p:
    # headless shell 은 안 깔려 있고 전체 chromium 은 있다 — 실행 파일을 직접 지정한다.
    b = p.chromium.launch(headless=True, executable_path=p.chromium.executable_path)
    pg = b.new_page(viewport={"width": 1400, "height": 1000}, device_scale_factor=2)
    pg.goto(f"{BASE}/login", wait_until="networkidle")
    pg.fill('input[type="text"]', ID)
    pg.fill('input[type="password"]', PW)
    pg.click('button[type="submit"]')
    pg.wait_for_timeout(4000)
    print("로그인 후 URL:", pg.url)

    pg.goto(f"{BASE}/portal/cafe?tab=intake", wait_until="networkidle")
    pg.wait_for_timeout(3500)
    # 가이드 오버레이가 자동으로 뜨면 화면을 덮고 클릭까지 가로챈다.
    #   ESC 로 닫는다(GuideOverlay 가 Escape 를 종료로 받는다). 버튼 클릭은 오버레이 자신이 막는다.
    for _ in range(6):
        if not pg.query_selector('[role="dialog"][aria-label="사용 가이드"]'):
            break
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(700)
    print("오버레이 남음:", bool(pg.query_selector('[role="dialog"][aria-label="사용 가이드"]')))
    # ★ 충전 가이드가 스스로 ?tab=charge 로 밀어 버린다(하부 업체는 충전 안내가 먼저 뜬다).
    #   오버레이를 닫은 뒤 다시 접수 탭으로 간다 — 안 하면 엉뚱한 화면을 찍는다.
    for _ in range(3):
        if "tab=intake" in pg.url and pg.query_selector('[data-tour="cafe-deploy-type-cards"]'):
            break
        pg.goto(f"{BASE}/portal/cafe?tab=intake", wait_until="networkidle")
        pg.wait_for_timeout(3000)
        for _ in range(4):
            if not pg.query_selector('[role="dialog"][aria-label="사용 가이드"]'):
                break
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(600)
    print("접수 화면:", pg.url)
    pg.screenshot(path=str(OUT / "00-full.png"), full_page=True)

    shot(pg, '[data-tour="cafe-deploy-type-cards"]', "01-배포종류")

    # 인기탭 배포 → 키워드 방식이 나온다
    for label in ("인기탭 배포", "인기탭"):
        el = pg.query_selector(f'[data-tour="cafe-deploy-type-cards"] >> text={label}')
        if el:
            el.click(); pg.wait_for_timeout(1200); break
    shot(pg, '[data-tour="cafe-deploy-kwmode"]', "02-키워드방식")

    modes = [("지역형", "03-지역형"), ("키워드형", "04-키워드형"),
             ("직접 입력형", "05-직접입력형"), ("정보형", "06-정보형")]
    for label, name in modes:
        el = pg.query_selector(f'[data-tour="cafe-deploy-kwmode"] >> text={label}')
        if not el:
            print(f"  ! 방식 버튼 없음 {label}")
            continue
        el.click()
        pg.wait_for_timeout(1500)
        for sel in ('[data-tour="cafe-deploy-kw-seed"]', '[data-tour="cafe-deploy-kw-manual"]',
                    '[data-tour="cafe-deploy-region"]', '[data-tour="cafe-deploy-keyword"]',
                    '[data-tour="cafe-deploy-url"]'):
            if shot(pg, sel, name):
                break

    shot(pg, '[data-tour="cafe-deploy-schedule"]', "07-일정건수")
    shot(pg, '[data-tour="cafe-deploy-account"]', "08-발행정보")
    shot(pg, '[data-tour="cafe-deploy-photos"]', "09-사진")
    b.close()

print("\n저장:", OUT)
for f in sorted(OUT.glob("*.png")):
    print(" ", f.name, f.stat().st_size // 1024, "KB")
