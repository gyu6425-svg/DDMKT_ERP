# DDMKT 크롤 통합 데몬 — 작업 스케줄러(04시 255 튕김) 대신 '상시 파이썬 프로세스 하나'로 전부 처리.
#   · 평일(월~금) 04:00~09:00 → 전체크롤(모든 추적글, 09시까지) 1회
#   · 매일 09:00~23:59 → 당일 글 반복(평일 30분 / 주말 90분 텀)
#   · 주말(토·일)은 전체크롤 안 함(가끔 당일글만)
#   · 10분마다 네이버 차단 확인 → 감지 시 크롤현황 빨간 알림 + 대기
#   PC 로그인 유지되는 동안 계속 동작(밤새 생존 검증됨). 시작프로그램 등록 시 부팅/로그인마다 자동 실행.
import sys, os, time, datetime, subprocess
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore; truststore.inject_into_ssl()
import blog_rank_crawler as c

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
CHECK_MIN = 10
WEEKDAY_INTERVAL_MIN = 30
WEEKEND_INTERVAL_MIN = 90
FULL_START, FULL_END = 4, 9      # 전체크롤 시간대(평일만) [04,09)
TODAY_START, TODAY_END = 9, 24   # 당일 글 시간대 [09,24)


def now():
    return datetime.datetime.now()


def decide(hour, weekday, full_done_today, secs_since_today,
           wkday_int=WEEKDAY_INTERVAL_MIN, wkend_int=WEEKEND_INTERVAL_MIN):
    """순수 함수(독립검증용). 반환: 'full' | 'today' | 'idle'.
    weekday: 0=월 … 5=토, 6=일."""
    weekend = weekday >= 5
    if FULL_START <= hour < FULL_END and not weekend and not full_done_today:
        return "full"
    if TODAY_START <= hour < TODAY_END:
        interval = wkend_int if weekend else wkday_int
        if secs_since_today >= interval * 60:
            return "today"
    return "idle"


def is_blocked():
    from urllib.parse import quote
    url = "https://m.search.naver.com/search.naver?query=" + quote("날씨")
    try:
        code, _ = c._fetch_html(url)
        if code == 200:
            return False
        time.sleep(5)
        code2, _ = c._fetch_html(url)
        return code2 != 200
    except Exception:
        time.sleep(5)
        try:
            code2, _ = c._fetch_html(url)
            return code2 != 200
        except Exception:
            return True


def wait_other_crawl():
    """다른 크롤(수동 실행 등)이 돌면 끝날 때까지 최대 40분 대기 — 동시 요청 방지."""
    for _ in range(80):
        try:
            r = c.sb_get("crawl_status", {"id": "eq.1", "select": "running"})[0]
            if not r.get("running"):
                return
        except Exception:
            return
        time.sleep(30)


def run_full():
    env = dict(os.environ, CRAWL_DELAY="4", CRAWL_REST_EVERY="6", CRAWL_REST_SEC="45")
    subprocess.run([PY, "-u", os.path.join(HERE, "blog_rank_crawler.py"),
                    "--spread", "--chunk-size", "5", "--gap", "6", "--max-posts", "5", "--deadline", "09:00"],
                   cwd=HERE, env=env)


def run_today():
    subprocess.run([PY, "-u", os.path.join(HERE, "crawl_bydate.py"), "1"], cwd=HERE)


def run_place():
    # 플레이스 순위 크롤 — 하루 1회(place_accounts x place_keywords).
    subprocess.run([PY, "-u", os.path.join(HERE, "place_rank_crawler.py")], cwd=HERE)


def main():
    print(f"[{now():%m-%d %H:%M}] 통합 데몬 시작 — 평일 04~09 전체 / 매일 09~24 당일(평일30·주말90분) / 차단확인 10분", flush=True)
    full_done_date = None
    place_done_date = None
    last_today = 0.0
    while True:
        n = now()
        if is_blocked():
            c.set_crawl_status(running=False, phase="blocked", current_blog="네이버 차단 감지됨 — 잠시 후 자동 재시도합니다")
            print(f"[{n:%H:%M}] ⚠ 차단 감지 → 대기", flush=True)
            time.sleep(CHECK_MIN * 60)
            continue
        # 플레이스 순위 크롤 — 매일 1회(09시 이후, 주말 포함). 블로그 전체크롤 창(04~09)과 분리.
        if n.hour >= 9 and place_done_date != n.date().isoformat():
            wait_other_crawl()
            print(f"[{n:%H:%M}] === 플레이스 순위 크롤 ===", flush=True)
            try:
                run_place()
            except Exception as exc:
                print(f"[{n:%H:%M}] 플레이스크롤 오류: {exc}", flush=True)
            place_done_date = n.date().isoformat()
        full_done = (full_done_date == n.date().isoformat())
        action = decide(n.hour, n.weekday(), full_done, time.time() - last_today)
        if action == "full":
            wait_other_crawl()
            print(f"[{n:%H:%M}] === 평일 전체크롤 시작(09시까지) ===", flush=True)
            try:
                run_full()
            except Exception as exc:
                print(f"[{n:%H:%M}] 전체크롤 오류: {exc}", flush=True)
            full_done_date = n.date().isoformat()
        elif action == "today":
            wait_other_crawl()
            print(f"[{n:%H:%M}] === 당일 글 크롤 1패스 ===", flush=True)
            try:
                run_today()
            except Exception as exc:
                print(f"[{n:%H:%M}] 당일크롤 오류: {exc}", flush=True)
            last_today = time.time()
        time.sleep(CHECK_MIN * 60)


# ── 독립검증(--test): 시각·요일별 결정이 의도대로인지 자동 점검 ──
def _selftest():
    MIN = 60
    cases = [
        # (설명, hour, weekday, full_done, secs_since_today, 기대값)
        ("평일 04시·전체미완 → full", 4, 0, False, 9999, "full"),
        ("평일 08시·전체미완 → full", 8, 2, False, 9999, "full"),
        ("평일 04시·전체완료 → idle", 4, 0, True, 9999, "idle"),
        ("주말(토) 04시 → idle(전체크롤 안함)", 4, 5, False, 9999, "idle"),
        ("주말(일) 06시 → idle", 6, 6, False, 9999, "idle"),
        ("새벽 02시 → idle", 2, 0, False, 9999, "idle"),
        ("평일 09시(전체창 끝) → today", 9, 0, False, 9999, "today"),
        ("평일 10시·31분경과 → today", 10, 0, True, 31 * MIN, "today"),
        ("평일 10시·10분경과 → idle(30분 미달)", 10, 0, True, 10 * MIN, "idle"),
        ("주말 10시·91분경과 → today", 10, 5, False, 91 * MIN, "today"),
        ("주말 10시·40분경과 → idle(90분 미달)", 10, 5, False, 40 * MIN, "idle"),
        ("평일 23:30 상당·경과 → today", 23, 4, True, 99 * MIN, "today"),
        ("00시 → idle(크롤 없음)", 0, 0, True, 99 * MIN, "idle"),
    ]
    print("=== 통합 데몬 결정 로직 독립검증 ===")
    ok = True
    for desc, h, wd, done, secs, exp in cases:
        got = decide(h, wd, done, secs)
        mark = "✅" if got == exp else "❌"
        if got != exp:
            ok = False
        print(f"  {mark} {desc}  → {got} (기대 {exp})")
    print("=== 전체 통과 ===" if ok else "=== ❌ 실패 있음 ===")
    return ok


if __name__ == "__main__":
    if "--test" in sys.argv:
        sys.exit(0 if _selftest() else 1)
    main()
