# -*- coding: utf-8 -*-
"""카페 순위 크롤 — cafe_rank_posts 의 글들을 통합탭에서 측정해 measurements 에 누적.
   blog_rank_crawler 의 측정·차단회피·양보(_pause) 로직 그대로 재사용. crawl_bydate 미러.

실행: python cafe_rank_crawler.py            (전체)
      python cafe_rank_crawler.py --today    (오늘 발행분만)
전제: ../.env 의 SUPABASE_SERVICE_KEY (service_role, RLS 우회).
"""
import sys
import time
import random
import datetime
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore
truststore.inject_into_ssl()
import blog_rank_crawler as c

TODAY = c.TODAY
# 차단 대응 — 이 크롤은 블로그 크롤(수백 콜) 직후에 돌아 누적 호출량이 이미 많다.
COOLDOWN_SEC = 300      # 연속 실패 5건 = 차단 추정 → 이만큼(×횟수 점증) 쉬고 재개
MAX_COOLDOWNS = 5       # 3→5: 01:00~09:00 시간 여유 충분 → 더 끈질기게 회복 시도(중단 대신)
HARD_STOP = "09:00"     # 다음 크롤(Today 09:05 / Place 09:20)과 겹치지 않게 이 시각엔 멈춘다
# ★ 차단 원천 예방(2026-08-06 118건 전멸 대응). 원인=블로그 635콜 직후 카페 240콜이 붙어 누적볼륨(≈875)에서 막힘.
#   시간 예산이 크므로(01:00 시작·09:00 마감=7.5h) 아낌없이 느리게 돌려 차단 자체를 안 만든다.
PRECOOL_SEC = 180                        # 시작 전 대기 — 블로그 크롤 직후 IP 레이트 윈도가 식게(예약 실행 때만)
CAFE_DELAY = max(c.REQUEST_DELAY, 4.5)   # 요청 간격 소폭 상향(누적 부하가 커 블로그보다 더 느리게)
REST_EVERY = max(1, c.BLOCK_REST_EVERY)  # N개 측정마다 긴 휴식(누적 레이트리밋 예방 — 블로그와 동일 방식)
REST_SEC = c.BLOCK_REST_SEC
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
    # 마이클의 정보세상(ddmkt2) 카페는 순위 체크 제외(사용자 지정 2026-08-06).
    #   실측상 실패 118건이 전부 이 카페의 오래된 글이었고, 제외하면 누적 콜/차단이 크게 준다.
    _before = len(posts)
    posts = [p for p in posts if (p.get("cafe_name") or "").strip() != "ddmkt2"]
    _skipped_mk = _before - len(posts)
    try:
        account_rows = c.sb_get("cafe_accounts", {"select": "id,company_key,display_name", "active": "eq.true"})
    except Exception:
        account_rows = []  # SQL 적용 전 레거시 폴백: board를 업체 표시명으로 사용
    account_by_id = {a["id"]: a for a in account_rows}
    print(f"=== 카페 순위 크롤 {TODAY} · 대상 {len(posts)}글{' (오늘분)' if today_only else ''}"
          f"{f' · 마이클정보세상(ddmkt2) {_skipped_mk}글 제외' if _skipped_mk else ''} ===", flush=True)
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
    # 프리쿨 — 블로그 크롤 직후(예약 01:00 실행) IP 레이트 윈도가 식도록 잠깐 대기. 차단 원천 예방.
    if _GUARD_ON and PRECOOL_SEC and posts:
        print(f"  ⏳ 프리쿨 {PRECOOL_SEC // 60}분 — 블로그 크롤 직후 누적 차단 예방(레이트 윈도 리셋)", flush=True)
        time.sleep(PRECOOL_SEC)
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
                cd = COOLDOWN_SEC * cooldowns   # 점증 쿨다운(5/10/15…분) — 볼륨 차단은 짧은 휴식으론 안 풀린다
                print(f"  ⚠ 연속 실패 {consec}건 = 차단 추정 → {cd // 60}분 쿨다운({cooldowns}/{MAX_COOLDOWNS})", flush=True)
                time.sleep(cd)
                consec = 0
            continue
        ok += 1
        consec = 0
        c._pause(CAFE_DELAY)   # 차단회피 + 즉시검색 양보(블로그보다 약간 느리게)
        # N개마다 긴 휴식 — 누적 레이트리밋을 미리 흩어 차단을 안 만든다(블로그 크롤과 동일 방식).
        if REST_EVERY > 0 and ok % REST_EVERY == 0:
            rest = REST_SEC + random.uniform(0, REST_SEC * 0.5)
            print(f"  ⏸ 누적 차단 예방 휴식 {rest:.0f}s (측정 {ok}건째)", flush=True)
            time.sleep(rest)
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
            c._pause(CAFE_DELAY)
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
