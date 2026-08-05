# -*- coding: utf-8 -*-
"""카페 주기 측정 — 신규/미측정 글만, 블로그 크롤과 절대 안 겹치게.
   매 N분:  (1) cafe_rank_sync 로 신규 발행분 편입(네이버 호출 없음, 항상 실행)
            (2) '오늘 미측정' 글만 측정 — 단, 아래 게이트를 통과할 때만.
   게이트(충돌 방지):
     - 블로그 크롤 실행 중(crawl_status.running, updated_at 변화로 살아있는지 판별) → 이번 주기 측정 건너뜀
     - 새벽 바쁜 시간대(02:50~09:30) = 블로그 Full/당일/플레이스/데일리 카페체인 구간 → 측정 안 함
   → 신규 발행은 즉시 트래커에 뜨고(측정대기), 실제 순위 측정은 '안전한 창'에서만.
실행: python cafe_periodic.py [간격초=1800]
"""
import sys
import time
import datetime
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore
truststore.inject_into_ssl()
import blog_rank_crawler as c
import cafe_rank_sync
import cafe_board_crawl
import cafe_top5_tracker
import cafe_token_sync

INTERVAL = int(sys.argv[1]) if len(sys.argv) > 1 else 1800   # 기본 30분
# 블로그 크롤에 막혔을 때는 30분을 통째로 기다리지 않고 짧게 재시도한다.
#   당일 크롤이 :05/:35 마다 돌아서 주기가 물리면(위상 겹침) 매번 건너뛰어 신규글이 계속 밀리던 문제 해결.
RETRY_SEC = 240
# 새벽 블로그/카페 크롤 구간 = 측정 금지. Full 이 01:00 시작이므로 00:50 부터 막아 구간 전체를 덮는다
#   (01:00~08:30 Full → 체인 카페측정 → 09:05 당일건 → 09:20 플레이스까지).
#   ★09:45 까지 연장: 플레이스 크롤은 crawl_status.running 을 안 세워 _blog_active 로 못 막으므로,
#     플레이스(09:20 시작)가 09:30 을 넘겨 돌 때 카페 09:40 슬롯과 같은 IP 충돌하는 갭을 시간대로 차단.
#     (독립검증 R1 — 플레이스 무플래그 + band 조기종료 갭. 09:45 로 여유 확보, 카페 첫 측정은 09:55 슬롯.)
BUSY_START, BUSY_END = datetime.time(0, 50), datetime.time(9, 45)

_seen = {"ua": None, "since": 0.0}


def _blog_active():
    """블로그 크롤이 '살아서' 도는가. running=True + updated_at 이 변하면 active(대기).
    같은 updated_at 이 15분 넘게 굳어 있으면 좀비 플래그로 보고 False(진행)."""
    try:
        rows = c.sb_get("crawl_status", {"id": "eq.1", "select": "running,updated_at"})
    except Exception:
        return False
    r = (rows or [{}])[0]
    if not r.get("running"):
        _seen["ua"] = None
        return False
    ua = r.get("updated_at")
    now = time.time()
    if ua != _seen["ua"]:
        _seen["ua"] = ua
        _seen["since"] = now
        return True
    return (now - _seen["since"]) <= 900   # 15분 이상 정지 = 좀비 → False


def _in_busy_band():
    t = datetime.datetime.now().time()
    return BUSY_START <= t <= BUSY_END


# 카페 '당일 크롤' 고정 슬롯 — 매시 :10 / :25 / :40 / :55 (15분 주기).
#   발행현황·순위트래커 반영을 빠르게(발행 후 최대 15분). 블로그 당일크롤(:05/:35)과 최소 5분 이격 + _blog_active 게이트로 겹침 방지.
#   (기존 :20/:50 = 30분 주기라 발행 반영이 느렸음.)
SLOT_MINUTES = (10, 25, 40, 55)


def _sleep_to_next_slot():
    now = datetime.datetime.now()
    cands = [now.replace(minute=m, second=0, microsecond=0) for m in SLOT_MINUTES]
    future = [t for t in cands if t > now]
    nxt = future[0] if future else (now + datetime.timedelta(hours=1)).replace(
        minute=SLOT_MINUTES[0], second=0, microsecond=0)
    wait = max(5.0, (nxt - now).total_seconds())
    print(f"[{now:%H:%M}] 다음 카페 당일크롤 {nxt:%H:%M} 대기({int(wait // 60)}분)", flush=True)
    time.sleep(wait)


def _measure_new():
    today = datetime.date.today().isoformat()
    # 최신 발행 우선 정렬 — 측정 창이 짧게 끊겨도 최근 등록 글이 뒤로 반복 밀리지 않게(독립검증 R3).
    posts = c.sb_get("cafe_rank_posts", {"excluded": "eq.false", "select": "*", "order": "published_date.desc.nullslast"})
    # 대상 = ① 오늘 미측정 글 + ② 매 사이클(15분) 재측정: 현재 순위권(ok) OR 최근 발행 신규글.
    #   순위권 글은 순위 변동을 바로바로 반영, 최근 신규글은 아직 변동이 커 매번 추적(진입/이탈 즉시 포착).
    #   권외·측정불가 옛글은 매 사이클 안 돌고 하루 1회만(전체 재측정 시 ~22분=차단위험이라 순위권+신규로 한정).
    recent_cut = (datetime.date.today() - datetime.timedelta(days=2)).isoformat()  # 최근 2일 발행분
    def _track(p):
        ms = p.get("measurements") or []
        cur = ms[-1] if ms else {}
        ranked = cur.get("ti_status") == "ok"                      # 현재 순위권 = 순위 변동 즉시 반영
        recent = (p.get("published_date") or "") >= recent_cut     # 최근 신규글 = 변동 큼, 매번 추적
        return ranked or recent
    todo = [p for p in posts
            if (not any((m.get("date") == today) for m in (p.get("measurements") or []))) or _track(p)]
    if not todo:
        print(f"[{datetime.datetime.now():%H:%M}] 재측정 대상 없음 — {len(posts)}글", flush=True)
        return
    print(f"[{datetime.datetime.now():%H:%M}] 미측정 {len(todo)}글 측정 시작", flush=True)
    for p in todo:
        if _blog_active() or _in_busy_band():   # 측정 도중 블로그 크롤이 뜨면 즉시 중단
            print("  ⏸ 블로그 크롤/바쁜시간 진입 — 중단(다음 주기)", flush=True)
            break
        kw = (p.get("keyword_manual") or p.get("keyword") or "").strip()
        aid = str(p.get("article_id") or "").strip()
        if not kw or not aid:
            continue
        club = str(p.get("club_id")).strip() if p.get("club_id") else None
        ti, ti_s = c.measure_cafe_rank(kw, (p.get("cafe_name") or "").strip() or None, aid, club_id=club)
        recs = [r for r in (p.get("measurements") or []) if r.get("date") != today]
        recs.append({"date": today, "ti": ti, "ti_status": ti_s})
        try:
            c.sb_patch("cafe_rank_posts", {"id": f"eq.{p['id']}"}, {"measurements": recs})
        except Exception as exc:
            print(f"    [저장실패] #{aid}: {exc}", flush=True)
        tag = f"{ti}위" if ti_s == "ok" else {"out": "권외", "no_section": "측정불가", "fail": "실패"}.get(ti_s, ti_s)
        print(f"    [{p.get('board') or '?'}] #{aid} '{kw}' → {tag}", flush=True)
        c._pause(c.REQUEST_DELAY)


def main():
    c.need_config()
    print(f"[카페 주기측정 시작] {datetime.datetime.now():%H:%M} · 간격 {INTERVAL // 60}분 · 블로그크롤 겹침 방지 게이트 ON", flush=True)
    while True:
        # 게이트: 블로그 크롤 중이거나 새벽 바쁜 시간대면 네이버 접촉 전부 건너뜀(겹침 방지)
        if _blog_active():
            print(f"[{datetime.datetime.now():%H:%M}] 블로그 크롤 중 — {RETRY_SEC // 60}분 뒤 재시도", flush=True)
            time.sleep(RETRY_SEC)   # 당일크롤은 금방 끝나므로 짧게 재시도(위상 겹침 방지)
            continue
        if _in_busy_band():
            print(f"[{datetime.datetime.now():%H:%M}] 새벽 크롤 시간대({BUSY_START:%H:%M}~{BUSY_END:%H:%M}) — 건너뜀", flush=True)
        else:
            # 1) 게시판 직접 수집(네이버 API) — 발행경로 무관하게 신규글 등록
            try:
                cafe_board_crawl.main()
            except SystemExit:
                pass
            except Exception as exc:
                print(f"  게시판수집 오류: {exc}", flush=True)
            # 2) 발행큐 sync(DB만, 중복 무해)
            try:
                cafe_rank_sync.main()
            except SystemExit:
                pass
            except Exception as exc:
                print(f"  sync 오류: {exc}", flush=True)
            # 3) 신규 포함 미측정 글 + 현재 5위 글 재측정
            try:
                _measure_new()
            except Exception as exc:
                print(f"  측정 오류: {exc}", flush=True)
            # 4) 5위 24h 유지 실적 집계(글별 상태만 갱신, done_count 미변경)
            try:
                cafe_top5_tracker.run()
            except Exception as exc:
                print(f"  top5 집계 오류: {exc}", flush=True)
            # 5) 발행 토큰 → 실제 발행건수 동기화(잔여 토큰 최신화)
            try:
                cafe_token_sync.sync()
            except Exception as exc:
                print(f"  토큰 sync 오류: {exc}", flush=True)
        _sleep_to_next_slot()   # 다음 고정 슬롯(:20/:50)까지 — 블로그 당일크롤(:05/:35)과 15분 어긋남


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[카페 주기측정 종료]")
