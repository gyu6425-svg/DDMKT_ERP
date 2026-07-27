# -*- coding: utf-8 -*-
"""카페 인기글 '5위 24시간 유지' → 실적(top5_achieved) 자동 집계.
   글별 상태(top5_since / top5_achieved_at)만 갱신한다. cafe_accounts.done_count(수동 베이스라인)은
   절대 건드리지 않는다(UI 절대값 저장과 충돌·유실 방지). 실적 표시는 UI에서
   done_count + (top5_achieved_at 있고 top5_seeded=false 글 수) 로 계산.
멱등: 전체 글을 매번 훑어 변경분만 patch. 측정 직후(cafe_periodic/cafe_rank_crawler)에서 호출.
"""
import datetime
import blog_rank_crawler as c

HOLD = datetime.timedelta(hours=23, minutes=30)   # 24h - 여유(슬롯 지터로 하루 밀리는 것 방지)


def _now():
    return datetime.datetime.now(datetime.timezone.utc)


def _parse(ts):
    if not ts:
        return None
    try:
        return datetime.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except Exception:
        return None


def run():
    try:
        posts = c.sb_get("cafe_rank_posts", {
            "excluded": "eq.false",
            "select": "id,measurements,top5_since,top5_achieved_at,top5_seeded",
        })
    except Exception as exc:
        print(f"[top5 tracker] 조회 실패(SQL 미적용?): {exc}", flush=True)
        return
    now = _now()
    changed = achieved = 0
    for p in posts:
        ms = p.get("measurements") or []
        cur = ms[-1] if ms else {}
        st = cur.get("ti_status")
        ti = cur.get("ti")
        in_top5 = st == "ok" and isinstance(ti, (int, float)) and not isinstance(ti, bool) and ti <= 5
        since = _parse(p.get("top5_since"))
        patch = {}
        if in_top5:
            if since is None:
                patch["top5_since"] = now.isoformat()          # 진입 시각 기록
            elif not p.get("top5_achieved_at") and not p.get("top5_seeded") and (now - since) >= HOLD:
                patch["top5_achieved_at"] = now.isoformat()    # 24h 유지 달성 = 실적 +1
                achieved += 1
        else:
            # fail(측정오류)은 상태 유지 — 진짜 하락(out/no_section/ok&ti>5)일 때만 리셋.
            if st != "fail" and since is not None:
                patch["top5_since"] = None
        if patch:
            try:
                c.sb_patch("cafe_rank_posts", {"id": f"eq.{p['id']}"}, patch)
                changed += 1
            except Exception as exc:
                print(f"  [갱신실패] {p.get('id')}: {exc}", flush=True)
    if changed or achieved:
        print(f"[top5 tracker] {changed}글 상태 갱신 · 신규 달성 {achieved}", flush=True)


if __name__ == "__main__":
    c.need_config()
    run()
