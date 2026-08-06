# -*- coding: utf-8 -*-
"""카페 순위 크롤 — cafe_rank_posts 의 글들을 통합탭에서 측정해 measurements 에 누적.
   blog_rank_crawler 의 측정·차단회피·양보(_pause) 로직 그대로 재사용. crawl_bydate 미러.

실행: python cafe_rank_crawler.py            (전체)
      python cafe_rank_crawler.py --today    (오늘 발행분만)
전제: ../.env 의 SUPABASE_SERVICE_KEY (service_role, RLS 우회).
"""
import sys
import time
import datetime
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore
truststore.inject_into_ssl()
import blog_rank_crawler as c

TODAY = c.TODAY
# 차단 대응 — 이 크롤은 블로그 크롤(수백 콜) 직후에 돌아 누적 호출량이 이미 많다.
COOLDOWN_SEC = 300      # 연속 실패 5건 = 차단 추정 → 이만큼 쉬고 재개
MAX_COOLDOWNS = 3       # 쿨다운을 이만큼 했는데도 계속 막히면 중단(내일 재측정)
HARD_STOP = "09:00"     # 다음 크롤(Today 09:05 / Place 09:20)과 겹치지 않게 이 시각엔 멈춘다
# ★ 위 가드는 새벽 예약 실행(01:00 시작)용이다. 낮에 수동으로 돌릴 땐 시작하자마자 멈추면 안 되므로,
#   시작 시각이 이미 HARD_STOP 을 넘었으면 가드를 끈다(수동 재측정 허용).
_STARTED = datetime.datetime.now().strftime("%H:%M")
_GUARD_ON = _STARTED < HARD_STOP


def _past_stop():
    return _GUARD_ON and datetime.datetime.now().strftime("%H:%M") >= HARD_STOP


def main():
    c.need_config()
    today_only = "--today" in sys.argv
    params = {"excluded": "eq.false", "select": "*", "order": "published_date.desc"}
    if today_only:
        params["published_date"] = f"eq.{TODAY}"
    posts = c.sb_get("cafe_rank_posts", params)
    try:
        account_rows = c.sb_get("cafe_accounts", {"select": "id,company_key,display_name", "active": "eq.true"})
    except Exception:
        account_rows = []  # SQL 적용 전 레거시 폴백: board를 업체 표시명으로 사용
    account_by_id = {a["id"]: a for a in account_rows}
    print(f"=== 카페 순위 크롤 {TODAY} · 대상 {len(posts)}글{' (오늘분)' if today_only else ''} ===", flush=True)
    ok = fail = 0

    def measure_one(p):
        """1글 측정 → ti_status 반환. 성공분만 저장한다(차단은 측정결과가 아니므로 기록하지 않음)."""
        kw = (p.get("keyword_manual") or p.get("keyword") or "").strip()
        cafe_name = (p.get("cafe_name") or "").strip()
        club_id = (p.get("club_id") or "").strip() or None
        article_id = str(p.get("article_id") or "").strip()
        account = account_by_id.get(p.get("cafe_account_id")) or {}
        company = account.get("display_name") or p.get("board") or "미분류"
        if not kw or not article_id:
            print(f"  [스킵] 키워드/글번호 없음: {p.get('title', '')[:20]}", flush=True)
            return "skip"
        ti, ti_s = c.measure_cafe_rank(kw, cafe_name, article_id, club_id=club_id)
        if ti_s == "fail":
            # ★ 차단·일시실패를 measurements 에 쓰지 않는다. 예전엔 '실패'를 그대로 저장해
            #   그날 순위 이력이 차단 흔적으로 덮였다(2026-08-06: 118건).
            print(f"  [{company} · {p.get('published_date')}] {cafe_name}/{article_id} · '{kw}' → 통합 실패(미기록)", flush=True)
            return "fail"
        recs = [r for r in (p.get("measurements") or []) if r.get("date") != TODAY]
        recs.append({"date": TODAY, "ti": ti, "ti_status": ti_s})
        try:
            c.sb_patch("cafe_rank_posts", {"id": f"eq.{p['id']}"}, {"measurements": recs})
        except Exception as exc:
            print(f"  [저장실패] {cafe_name}/{article_id}: {exc}", flush=True)
        tg = f"{ti}위" if ti_s == "ok" else ("권외" if ti_s == "out" else "측정불가(섹션없음)")
        print(f"  [{company} · {p.get('published_date')}] {cafe_name}/{article_id} · '{kw}' → 통합 {tg}", flush=True)
        return ti_s

    # 차단 대응 — 블로그 크롤 뒤라 누적 호출량이 이미 많다. 연속 실패가 쌓이면 계속 두들기지 말고 쉰다.
    #   실측(2026-08-06): 블로그 635 + 카페 240 = 875콜에서 122건 뒤부터 전멸(118 연속 실패).
    consec, cooldowns, retry = 0, 0, []
    for p in posts:
        if _past_stop():
            print(f"  ⏹ {HARD_STOP} 도달 — 다음 크롤(09:05)과 겹치지 않게 중단. 남은 글은 내일 측정.", flush=True)
            break
        st = measure_one(p)
        if st == "skip":
            continue
        if st == "fail":
            fail += 1
            consec += 1
            retry.append(p)
            if consec >= 5:
                cooldowns += 1
                if cooldowns > MAX_COOLDOWNS:
                    print(f"  ⛔ 차단 지속({cooldowns}회 쿨다운) — 남은 {len(posts) - ok - fail}글 중단. 내일 재측정.", flush=True)
                    break
                print(f"  ⚠ 연속 실패 {consec}건 = 차단 추정 → {COOLDOWN_SEC // 60}분 쿨다운({cooldowns}/{MAX_COOLDOWNS})", flush=True)
                time.sleep(COOLDOWN_SEC)
                consec = 0
            continue
        ok += 1
        consec = 0
        c._pause(c.REQUEST_DELAY)   # 차단회피 + 즉시검색 양보
    # 실패분 1회 재시도 — 쿨다운으로 회복됐으면 여기서 대부분 살아난다.
    if retry and cooldowns <= MAX_COOLDOWNS and not _past_stop():
        print(f"=== 실패 {len(retry)}글 재시도 ===", flush=True)
        again = 0
        for p in retry:
            if _past_stop():
                break
            if measure_one(p) not in ("fail", "skip"):
                again += 1
                ok += 1
                fail -= 1
            c._pause(c.REQUEST_DELAY)
        print(f"=== 재시도 완료: {again}/{len(retry)}글 회복 ===", flush=True)
    print(f"=== 완료: {len(posts)}글 측정 (ok {ok} / fail {fail}) ===", flush=True)
    try:
        c.log_crawl_run("카페순위", ok + fail, fail)
    except Exception:
        pass
    try:
        import cafe_top5_tracker
        cafe_top5_tracker.run()   # 5위 24h 유지 실적 집계(+1)
    except Exception as exc:
        print(f"  top5 집계 오류: {exc}", flush=True)
    try:
        import cafe_contract_sync
        cafe_contract_sync.sync()  # 실적(+1) → 계약관리 '카페 배포' remain 반영(고객ERP/우리ERP 일치)
    except Exception as exc:
        print(f"  계약 sync 오류: {exc}", flush=True)


if __name__ == "__main__":
    main()
