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


# ── Egress 절감 ─────────────────────────────────────────────────────────────
#   왜: 이 데몬은 30분마다 cafe_rank_posts 를 통째로(select=*) 읽는다. measurements 가 무거워
#       1회 428 KB · 하루 19.6 MB 였다. 그런데 '무엇을 잴지 고르는' 데는 마지막 측정 1건이면 충분하다.
#       실측 2026-08-18: 428 KB -> 108 KB(75% 감소) · 하루 19.6 -> 4.9 MB.
#   대신 저장 직전에 그 글의 measurements 원본만 따로 읽어 이력을 보존한다(1건 ~71 B).
SEL_LITE = ("id,cafe_name,article_id,club_id,keyword,keyword_manual,board,"
            "published_date,created_at,last:measurements->-1")


def _lite(rows):
    """last(마지막 측정 1건)를 measurements 리스트 모양으로 되돌린다 — 아래 판정 로직을 그대로 쓰기 위함."""
    out = []
    for r in rows:
        last = r.pop("last", None)
        r["measurements"] = [last] if last else []
        out.append(r)
    return out


def _full_measurements(pid):
    """저장 직전 이력 원본 — 선별 조회는 마지막 1건만 받았으므로 여기서 전체를 받아 이어붙인다.
       ★ 이걸 빼먹으면 매 측정마다 이력이 1건으로 잘려 순위 추이가 통째로 사라진다."""
    try:
        rows = c.sb_get("cafe_rank_posts", {"id": f"eq.{pid}", "select": "measurements"})
        return (rows[0].get("measurements") if rows else None) or []
    except Exception:
        return None          # 실패 시 None -> 호출부가 저장을 건너뛴다(이력 파괴 금지)


def _measure_new():
    today = datetime.date.today().isoformat()
    # 최신 발행 우선 정렬 — 측정 창이 짧게 끊겨도 최근 등록 글이 뒤로 반복 밀리지 않게(독립검증 R3).
    posts = _lite(c.sb_get("cafe_rank_posts", {"excluded": "eq.false", "select": SEL_LITE, "order": "published_date.desc.nullslast"}))
    posts = [p for p in posts if (p.get("cafe_name") or "").strip() != "ddmkt2"]  # 마이클정보세상(ddmkt2) 순위체크 제외(사용자 지정)
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
        hist = _full_measurements(p["id"])
        if hist is None:
            print(f"    [건너뜀] #{aid}: 이력 조회 실패 — 덮어쓰지 않는다", flush=True)
            continue
        recs = [r for r in hist if r.get("date") != today]
        recs.append({"date": today, "ti": ti, "ti_status": ti_s})
        try:
            c.sb_patch("cafe_rank_posts", {"id": f"eq.{p['id']}"}, {"measurements": recs})
        except Exception as exc:
            print(f"    [저장실패] #{aid}: {exc}", flush=True)
        tag = f"{ti}위" if ti_s == "ok" else {"out": "권외", "no_section": "측정불가", "fail": "실패"}.get(ti_s, ti_s)
        print(f"    [{p.get('board') or '?'}] #{aid} '{kw}' → {tag}", flush=True)
        c._pause(c.REQUEST_DELAY)


def _measure_priority(cap=20):
    """블로그 당일크롤 중에도 '오늘 발행 신규글'만 소량 우선 측정 — 발행 직후 순위 즉시 반영.
       대량(전체 순위권) 재측정은 블로그 끝난 자유슬롯에서 _measure_new 가 한다. m.search 소량이라 부하 낮음."""
    today = datetime.date.today().isoformat()
    posts = _lite(c.sb_get("cafe_rank_posts", {"excluded": "eq.false", "select": SEL_LITE,
                                               "published_date": f"eq.{today}", "order": "created_at.desc"}))
    posts = [p for p in posts if (p.get("cafe_name") or "").strip() != "ddmkt2"]  # 마이클정보세상(ddmkt2) 순위체크 제외(사용자 지정)
    todo = [p for p in posts
            if not any((m.get("date") == today) for m in (p.get("measurements") or []))][:cap]
    if not todo:
        return
    print(f"[{datetime.datetime.now():%H:%M}] (블로그 중) 오늘 신규 {len(todo)}글 우선측정", flush=True)
    for p in todo:
        kw = (p.get("keyword_manual") or p.get("keyword") or "").strip()
        aid = str(p.get("article_id") or "").strip()
        if not kw or not aid:
            continue
        club = str(p.get("club_id")).strip() if p.get("club_id") else None
        ti, ti_s = c.measure_cafe_rank(kw, (p.get("cafe_name") or "").strip() or None, aid, club_id=club)
        hist = _full_measurements(p["id"])
        if hist is None:
            print(f"    [건너뜀] #{aid}: 이력 조회 실패 — 덮어쓰지 않는다", flush=True)
            continue
        recs = [r for r in hist if r.get("date") != today]
        recs.append({"date": today, "ti": ti, "ti_status": ti_s})
        try:
            c.sb_patch("cafe_rank_posts", {"id": f"eq.{p['id']}"}, {"measurements": recs})
        except Exception as exc:
            print(f"    [저장실패] #{aid}: {exc}", flush=True)
        tag = f"{ti}위" if ti_s == "ok" else ti_s
        print(f"    [{p.get('board') or '?'}] #{aid} '{kw}' → {tag}", flush=True)
        c._pause(c.REQUEST_DELAY)


def main():
    c.need_config()
    print(f"[카페 주기측정 시작] {datetime.datetime.now():%H:%M} · 간격 {INTERVAL // 60}분 · 블로그크롤 겹침 방지 게이트 ON", flush=True)
    while True:
        # ① 새벽 Full 구간(00:50~09:45) = 전면 양보 — 무거운 새벽 크롤과 절대 겹치지 않게 등록·측정 모두 건너뜀.
        if _in_busy_band():
            print(f"[{datetime.datetime.now():%H:%M}] 새벽 크롤 시간대({BUSY_START:%H:%M}~{BUSY_END:%H:%M}) — 건너뜀", flush=True)
            _sleep_to_next_slot()
            continue
        # ② 당일 블로그 크롤 중 — 등록(게시판 API=m.search 안 씀, 무충돌)은 항상 + 오늘 신규글만 우선측정(소량).
        #    대량 재측정(전체 순위권)은 블로그 끝난 자유슬롯에서. → 발행 직후 '오늘 발행'·순위가 바로 잡힘.
        if _blog_active():
            try:
                cafe_board_crawl.main()
            except SystemExit:
                pass
            except Exception as exc:
                print(f"  게시판수집 오류: {exc}", flush=True)
            try:
                _measure_priority()
            except Exception as exc:
                print(f"  우선측정 오류: {exc}", flush=True)
            print(f"[{datetime.datetime.now():%H:%M}] 블로그 크롤 중 — 등록+신규측정만, {RETRY_SEC // 60}분 뒤 재시도", flush=True)
            time.sleep(RETRY_SEC)
            continue
        # ③ 자유 슬롯 — 풀 사이클(등록 + sync + 전체 재측정 + 실적/토큰).
        try:
            cafe_board_crawl.main()   # 게시판 직접 수집 — 발행경로 무관 신규글 등록
        except SystemExit:
            pass
        except Exception as exc:
            print(f"  게시판수집 오류: {exc}", flush=True)
        try:
            cafe_rank_sync.main()     # 발행큐 sync(DB만)
        except SystemExit:
            pass
        except Exception as exc:
            print(f"  sync 오류: {exc}", flush=True)
        try:
            _measure_new()            # 신규+순위권 전체 재측정
        except Exception as exc:
            print(f"  측정 오류: {exc}", flush=True)
        try:
            cafe_top5_tracker.run()   # 5위 24h 유지 실적 집계
        except Exception as exc:
            print(f"  top5 집계 오류: {exc}", flush=True)
        try:
            cafe_token_sync.sync()    # 발행 토큰 동기화
        except Exception as exc:
            print(f"  토큰 sync 오류: {exc}", flush=True)
        _sleep_to_next_slot()   # 다음 고정 슬롯(:10/:25/:40/:55)까지


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[카페 주기측정 종료]")
