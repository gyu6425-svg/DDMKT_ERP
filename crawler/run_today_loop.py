# 당일(오늘 발행) 글 연속 반복 크롤 데몬 + 차단 감지/알림.
#   · 09~20시만 크롤  · 크롤 패스 사이 30분 텀(IP 차단 예방)  · 10분마다 IP(차단) 수시 확인
#   · 차단 감지 시 crawl_status.phase='blocked' 로 기록 → 웹 '크롤링 현황'에 빨간 알림 배너 표시(잠시 후 시도)
#   · 다른 크롤(25/26 전체)이 돌면 끝날 때까지 대기(중복 방지)
#   세션 프로세스라 PC 로그인 유지되는 동안 계속 동작.
import sys, time, datetime, subprocess, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore; truststore.inject_into_ssl()
import blog_rank_crawler as c

INTERVAL_MIN = 30          # 크롤 패스 사이 텀(분)
CHECK_MIN = 10             # 차단 수시 확인 주기(분)
WINDOW = (9, 20)           # 크롤 동작 시간대 [09시, 20시)
HERE = os.path.dirname(os.path.abspath(__file__))


def now():
    return datetime.datetime.now()


def is_blocked():
    """네이버 검색이 막혔는지 — 가벼운 SERP 1회(필요시 2회) 확인. 둘 다 비200이면 차단."""
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
    for _ in range(60):
        try:
            r = c.sb_get("crawl_status", {"id": "eq.1", "select": "running"})[0]
            if not r.get("running"):
                return
        except Exception:
            return
        time.sleep(30)


print(f"[{now():%m-%d %H:%M}] 당일 글 반복 크롤 데몬 시작 (크롤 09~20시·{INTERVAL_MIN}분 텀 / 차단확인 {CHECK_MIN}분)", flush=True)
last_crawl = 0.0
while True:
    h = now().hour
    in_window = WINDOW[0] <= h < WINDOW[1]

    if is_blocked():
        c.set_crawl_status(running=False, phase="blocked",
                           current_blog="네이버 차단 감지됨 — 잠시 후 자동 재시도합니다")
        print(f"[{now():%H:%M}] ⚠ 차단 감지 → 알림 기록, {CHECK_MIN}분 후 재확인", flush=True)
    elif in_window and (time.time() - last_crawl) >= INTERVAL_MIN * 60:
        wait_other_crawl()
        print(f"[{now():%H:%M}] === 당일 글 크롤 1패스 ===", flush=True)
        try:
            subprocess.run([sys.executable, "-u", os.path.join(HERE, "crawl_bydate.py"), "1"], cwd=HERE)
        except Exception as exc:
            print(f"[{now():%H:%M}] 패스 오류: {exc}", flush=True)
        last_crawl = time.time()
        print(f"[{now():%H:%M}] 패스 완료 → 다음 패스 {INTERVAL_MIN}분 후", flush=True)
    elif not in_window:
        print(f"[{now():%H:%M}] 크롤 시간(09~20시) 아님 — 차단확인만 계속", flush=True)

    time.sleep(CHECK_MIN * 60)
