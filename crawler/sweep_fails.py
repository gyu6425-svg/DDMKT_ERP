"""실패건 sweep — 진행 중인 크롤이 끝나길 기다렸다가, 오늘 측정 실패(ti/bl/웹 status=fail)를
모두 다시 잡는다. 크롤러의 non-force 재실행이 '오늘 성공분은 skip, 실패분만 재측정'이라 이걸 반복한다.

흐름:
  1) crawl_status.running == False 가 될 때까지 대기(현재 크롤 종료 기다림).
  2) 오늘 실패 수를 센다 → 0이면 종료.
  3) c.run(force=False) 로 실패분만 재측정 → 다시 센다. 0이 되거나 더 안 줄면(차단아닌 진짜 권외/구조)
     최대 ROUNDS 회까지 반복.

실행:  python sweep_fails.py            # 현재 크롤 끝난 뒤 자동 sweep
       python sweep_fails.py --now     # 대기 없이 즉시 sweep(크롤 안 돌 때)
"""
import sys
import time
import datetime
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore; truststore.inject_into_ssl()
import blog_rank_crawler as c

ROUNDS = 5
TODAY = c.TODAY


def _today_fail_count():
    """오늘 날짜 측정 중 status=fail 인 글/키워드/웹 건수."""
    n = 0
    posts = c.sb_get("blog_posts", {"select": "measurements", "limit": "5000"})
    for p in posts:
        tr = next((r for r in (p.get("measurements") or []) if r.get("date") == TODAY), None)
        if tr and (tr.get("ti_status") == "fail" or tr.get("bl_status") == "fail"):
            n += 1
    kws = c.sb_get("blog_keywords", {"select": "measurements", "limit": "5000"})
    for p in kws:
        tr = next((r for r in (p.get("measurements") or []) if r.get("date") == TODAY), None)
        if tr and (tr.get("ti_status") == "fail" or tr.get("bl_status") == "fail"):
            n += 1
    accs = c.sb_get("blog_accounts", {"select": "website_measurements", "limit": "5000"})
    for a in accs:
        tr = next((r for r in (a.get("website_measurements") or []) if r.get("date") == TODAY), None)
        if tr and tr.get("status") == "fail":
            n += 1
    return n


def _wait_for_idle():
    """현재 크롤이 끝날 때까지(running=False) 대기."""
    print(f"[{datetime.datetime.now():%H:%M:%S}] 현재 크롤 종료 대기…", flush=True)
    while True:
        try:
            r = c.sb_get("crawl_status", {"id": "eq.1", "select": "running,done,total"})
            cs = r[0] if r else {}
            if not cs.get("running"):
                print(f"  → 크롤 종료 확인(done={cs.get('done')}/{cs.get('total')})", flush=True)
                return
            print(f"  진행 {cs.get('done')}/{cs.get('total')}…", flush=True)
        except Exception as exc:
            print(f"  대기중 조회오류: {exc}", flush=True)
        time.sleep(30)


def main():
    if "--now" not in sys.argv:
        _wait_for_idle()
    prev = None
    for rd in range(1, ROUNDS + 1):
        fails = _today_fail_count()
        print(f"[sweep {rd}] 시작 전 실패 {fails}건", flush=True)
        if fails == 0:
            print("  실패 0 — 완료.", flush=True)
            return
        if prev is not None and fails >= prev:
            print(f"  더 안 줄어듦({prev}→{fails}) — 남은 건은 진짜 권외/구조(차단 아님). 중단.", flush=True)
            break
        prev = fails
        print(f"  non-force 재측정 시작(실패분만)…", flush=True)
        c.run_breadth(force=False)  # 라운드로빈·성공분 skip, 실패분만 재측정(MAX_POSTS_PER_BLOG=5)
        time.sleep(5)
    final = _today_fail_count()
    print(f"\n[완료] 남은 실패 {final}건", flush=True)


if __name__ == "__main__":
    main()
