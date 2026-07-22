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
STALE_MIN = 8                  # 이 분 이상 지난 pending 은 무시. 당일 크롤 대기를 감안해 넉넉히(3→8).
CRAWL_WAIT_MAX = 240           # 당일 측정 글 크롤이 도는 동안 측정 대기 최대치(초). 초과 시 그냥 진행.


def _wait_for_today_crawl():
    """당일 측정 글 크롤(crawl_status.running)이 도는 중이면 끝날 때까지 대기 — 동시 네이버 요청(차단) 방지."""
    waited = 0
    announced = False
    while waited < CRAWL_WAIT_MAX:
        try:
            rows = c.sb_get("crawl_status", {"id": "eq.1", "select": "running"})
        except Exception:
            return
        if not (rows and rows[0].get("running")):
            return
        if not announced:
            print("  ⏸ 당일 크롤 진행 중 — 끝나면 측정 진행(겹침 방지)", flush=True)
            announced = True
        time.sleep(5)
        waited += 5


def _now():
    return datetime.datetime.now(datetime.timezone.utc)


def _age_min(created_at):
    try:
        dt = datetime.datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        return (_now() - dt).total_seconds() / 60
    except Exception:
        return 0


def _process_cafe():
    """카페 재검색 큐(cafe_measure_requests) 처리 — measure_cafe_rank 로 인기글 섹션 순위 측정.
    블로그 measure_requests 와 완전 분리(별도 테이블). 테이블 없으면(SQL 미적용) 조용히 통과."""
    try:
        creqs = c.sb_get("cafe_measure_requests", {
            "status": "eq.pending", "order": "created_at.asc", "limit": "3", "select": "*",
        })
    except Exception:
        return  # 테이블 없음/조회 실패 → 통과(블로그 처리에 영향 없음)
    for r in (creqs or []):
        rid = r["id"]
        kw = (r.get("keyword") or "").strip()
        if _age_min(r.get("created_at", "")) > STALE_MIN:
            c.sb_patch("cafe_measure_requests", {"id": f"eq.{rid}"}, {"status": "fail"})
            continue
        c.sb_patch("cafe_measure_requests", {"id": f"eq.{rid}"}, {"status": "processing"})
        try:
            cafe_name = (r.get("cafe_name") or "").strip() or None
            club_id = str(r.get("club_id")).strip() if r.get("club_id") else None
            ti, ti_s = c.measure_cafe_rank(kw, cafe_name, str(r.get("article_id") or "").strip(), club_id=club_id)
            c.sb_patch("cafe_measure_requests", {"id": f"eq.{rid}"}, {
                "status": "done", "ti": ti, "ti_status": ti_s, "done_at": _now().isoformat(),
            })
            print(f"  ✓카페 '{kw}'(#{r.get('article_id')}) → 인기글 {ti}({ti_s})", flush=True)
        except Exception as exc:
            c.sb_patch("cafe_measure_requests", {"id": f"eq.{rid}"}, {"status": "fail"})
            print(f"  ✗카페 '{kw}': {exc}", flush=True)


def main():
    c.need_config()
    print(f"[리스너 시작] {datetime.datetime.now():%H:%M:%S} — measure_requests 폴링 (간격 {POLL_SEC}s)", flush=True)
    _reap_at = [0.0]
    while True:
        # ★ orphan 'processing' 청소(H4/2026-07-22 하드닝) — 리스너가 처리 중 죽으면 그 행이 processing 으로
        #   영원히 남고, 크롤의 _yield_to_immediate_search 가 그 행 때문에 매 요청 최대 45초씩 양보 → 크롤 10배 감속·마감초과.
        #   pending 만 보던 기존 로직은 이 orphan 을 못 치웠다. 여기서 STALE_MIN 초과 processing 을 fail 로 정리.
        if time.time() - _reap_at[0] > 30:
            _reap_at[0] = time.time()
            try:
                for s in (c.sb_get("measure_requests", {"status": "eq.processing", "select": "id,created_at", "limit": "20"}) or []):
                    if _age_min(s.get("created_at", "")) > STALE_MIN:
                        c.sb_patch("measure_requests", {"id": f"eq.{s['id']}"}, {"status": "fail"})
                        print(f"  ♻ orphan processing 정리(fail): {s['id'][:8]}", flush=True)
            except Exception:
                pass
            try:  # 카페 재검색 큐 orphan 도 함께 정리
                for s in (c.sb_get("cafe_measure_requests", {"status": "eq.processing", "select": "id,created_at", "limit": "20"}) or []):
                    if _age_min(s.get("created_at", "")) > STALE_MIN:
                        c.sb_patch("cafe_measure_requests", {"id": f"eq.{s['id']}"}, {"status": "fail"})
            except Exception:
                pass
        _process_cafe()  # ★ 카페 재검색 큐 처리(블로그 pending 유무와 무관하게 매 루프)
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
            # 선점(processing) — 중복 처리 방지. processing 이면 크롤(_pause)이 양보한다.
            c.sb_patch("measure_requests", {"id": f"eq.{rid}"}, {"status": "processing"})
            try:
                # 크롤과 겹쳐 빈응답(fail) 나면 잠깐 쉬고 재시도 — 크롤 요청 간격 사이 창을 노림(최대 3회).
                ti, ti_s, ws = c.measure_integrated_popular(kw, bid, lno)
                bl, bl_s = c.measure_blogtab_real(kw, bid, lno)
                for _try in range(2):
                    if ti_s != "fail" and bl_s != "fail":
                        break
                    time.sleep(5 + _try * 4)
                    if ti_s == "fail":
                        ti, ti_s, ws = c.measure_integrated_popular(kw, bid, lno)
                    if bl_s == "fail":
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
