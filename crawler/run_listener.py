"""즉시 검색 리스너 — measure_requests 큐를 폴링해 PC IP로 네이버 순위를 측정하고 결과를 채운다.
검색 버튼이 Cloudflare(데이터센터 IP)로 조회하면 통합탭이 다르게 나오는 문제를 우회(PC 경유).
상시 실행(run_listener.bat / 작업 스케줄러 로그온 시 시작). 종료: Ctrl+C 또는 작업 종료.
"""
import sys
import time
import datetime
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore
truststore.inject_into_ssl()
import blog_rank_crawler as c

c.REQUEST_DELAY = 2.0          # 검색은 즉시성이 중요 → 약간 짧게(소량이라 차단 위험 낮음)
POLL_SEC = 2.0                 # 큐 폴링 간격
STALE_MIN = 3                  # 이 분 이상 지난 pending 은 무시(오래된 요청은 사용자가 이미 떠남)


def _now():
    return datetime.datetime.now(datetime.timezone.utc)


def _age_min(created_at):
    try:
        dt = datetime.datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        return (_now() - dt).total_seconds() / 60
    except Exception:
        return 0


def main():
    c.need_config()
    print(f"[리스너 시작] {datetime.datetime.now():%H:%M:%S} — measure_requests 폴링 (간격 {POLL_SEC}s)", flush=True)
    while True:
        try:
            reqs = c.sb_get("measure_requests", {
                "status": "eq.pending", "order": "created_at.asc", "limit": "3", "select": "*",
            })
        except Exception as exc:
            print(f"  폴링 오류: {exc}", flush=True)
            time.sleep(5)
            continue
        if not reqs:
            time.sleep(POLL_SEC)
            continue
        for r in reqs:
            rid = r["id"]
            kw = (r.get("keyword") or "").strip()
            bid = (r.get("blog_id") or "").strip()
            lno = (r.get("log_no") or "").strip()
            if _age_min(r.get("created_at", "")) > STALE_MIN:
                c.sb_patch("measure_requests", {"id": f"eq.{rid}"}, {"status": "fail"})
                continue
            # 선점(processing) — 중복 처리 방지.
            c.sb_patch("measure_requests", {"id": f"eq.{rid}"}, {"status": "processing"})
            try:
                ti, ti_s, ws = c.measure_integrated_popular(kw, bid, lno)
                bl, bl_s = c.measure_blogtab_real(kw, bid, lno)
                c.sb_patch("measure_requests", {"id": f"eq.{rid}"}, {
                    "status": "done", "ti": ti, "bl": bl, "ti_status": ti_s, "bl_status": bl_s,
                    "ws": ws, "done_at": _now().isoformat(),
                })
                print(f"  ✓ '{kw}'({bid}) → 통합 {ti}({ti_s}) / 블로그 {bl}({bl_s})", flush=True)
            except Exception as exc:
                c.sb_patch("measure_requests", {"id": f"eq.{rid}"}, {"status": "fail"})
                print(f"  ✗ '{kw}': {exc}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[리스너 종료]")
