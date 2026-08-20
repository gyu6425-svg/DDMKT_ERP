# -*- coding: utf-8 -*-
"""카페 인기글 '5위 24시간 유지' → 실적(top5_achieved) 자동 집계.
   글별 상태(top5_since / top5_achieved_at)만 갱신한다. cafe_accounts.done_count(수동 베이스라인)은
   절대 건드리지 않는다(UI 절대값 저장과 충돌·유실 방지). 실적 표시는 UI에서
   done_count + (top5_achieved_at 있고 top5_seeded=false 글 수) 로 계산.
멱등: 전체 글을 매번 훑어 변경분만 patch. 측정 직후(cafe_periodic/cafe_rank_crawler)에서 호출.
"""
import datetime
import collections
import blog_rank_crawler as c

HOLD = datetime.timedelta(hours=23, minutes=30)   # 24h - 여유(슬롯 지터로 하루 밀리는 것 방지)


def _auto_by_account():
    """업체(계정)별 자동 달성 수(top5_achieved_at 있고 seeded 아님). top5 컬럼 없으면 전부 0."""
    try:
        posts = c.sb_get("cafe_rank_posts", {"excluded": "eq.false", "select": "cafe_account_id,board,top5_achieved_at,top5_seeded"})
    except Exception:
        return {}
    accts = c.sb_get("cafe_accounts", {"select": "id,board_short"})
    by_board = {a["board_short"]: a["id"] for a in accts}
    auto = collections.Counter()
    for p in posts:
        if p.get("top5_achieved_at") and not p.get("top5_seeded"):
            aid = p.get("cafe_account_id") or by_board.get(p.get("board"))
            if aid:
                auto[aid] += 1
    return auto


def _attrib_map():
    """client_id → 실적 귀속 대상(하위 업체는 부모 대행사). cafe_contract_sync 와 같은 규칙."""
    try:
        rows = c.sb_get("clients", {"select": "id,parent_client_id"})
    except Exception:
        return {}
    return {r["id"]: (r.get("parent_client_id") or r["id"]) for r in rows}


def sync_contracts():
    """카페 업체 실적(done_count 베이스라인 + 자동달성)을 계약관리 '카페' 계약의 진행(remain_count)에 반영.
    계약 카드는 완료=목표-잔여 로 계산하므로, 잔여=목표-실적 으로 맞추면 카드 카운트가 카페 대시보드와 일치."""
    accounts = c.sb_get("cafe_accounts", {"select": "id,client_id,display_name,done_count"})
    auto = _auto_by_account()
    # ⚠️ 업체(client)별로 '합산' 해야 함 — 계정별로 remain 을 쓰면 같은 계약을 여러 번 덮어써
    #   마지막 계정(마이클 ddmkt2)의 실적만 남아 대시보드/고객ERP가 틀린 값을 보인다.
    #   자체 카페 + 마이클 공유카페의 실적을 client 단위로 합쳐 한 번만 반영한다(관리시트와 동일).
    #   ★ 대행사 계층: 하위 업체의 실적은 부모 대행사 계약으로 올린다(사장님 확정 2026-08-20).
    #     대행사는 발행하지 않고 하위가 쓴다. 단 대행사가 자기 카페로도 발행하는 경우가 있어
    #     (더업스) 부모 자기 계정 + 하위 계정을 **합산** 해야 한다.
    #     ⚠️ 이 파일과 cafe_contract_sync.py 는 같은 remain_count 에 쓴다. 한쪽만 고치면
    #       30분 주기(cafe_periodic)의 이 함수가 밤사이 옳게 쓴 값을 도로 덮어쓴다.
    attrib = _attrib_map()
    by_client = {}
    for a in accounts:
        cid = a.get("client_id")
        if not cid:
            continue
        cid = attrib.get(cid, cid)          # 하위 → 부모로 귀속
        realized = (a.get("done_count") or 0) + auto.get(a["id"], 0)
        d = by_client.setdefault(cid, {"realized": 0, "name": a.get("display_name")})
        d["realized"] += realized
    n = 0
    for cid, d in by_client.items():
        if attrib.get(cid, cid) != cid:     # 하위 업체 계약 행에는 쓰지 않는다(이중 계상 방지)
            continue
        realized = d["realized"]
        try:
            cons = c.sb_get("client_contracts", {"client_id": f"eq.{cid}", "category": "eq.카페", "select": "id,goal_count,remain_count"})
        except Exception:
            continue
        for ct in (cons or []):
            goal = ct.get("goal_count") or 0
            remain = max(0, goal - realized)
            if ct.get("remain_count") != remain:
                c.sb_patch("client_contracts", {"id": f"eq.{ct['id']}"}, {"remain_count": remain})
                n += 1
                print(f"  {d['name']} 실적 {realized}/{goal} → 계약 잔여 {remain}", flush=True)
    if n:
        print(f"[top5] 계약 진행 동기화 {n}건", flush=True)


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
        # measurements 는 마지막 1건만 쓴다(아래 ms[-1]). 전체를 받으면 이력이 큰 글에서
        #   payload 가 통째로 나간다 — Egress 절감(2026-08-19, SUB3 지적).
        #   서버에서 잘라 받고, 아래 로직이 그대로 돌게 리스트 모양으로 되돌린다.
        posts = c.sb_get("cafe_rank_posts", {
            "excluded": "eq.false",
            "select": "id,top5_since,top5_achieved_at,top5_seeded,last:measurements->-1",
        })
        for _p in posts:
            _last = _p.pop("last", None)
            _p["measurements"] = [_last] if _last else []
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
        # ok = 인기글 테마섹션 내 순위 / list_ok = 인기글 섹션이 없는 키워드의 통합리스트 순위.
        #   둘 다 '화면에서 위에서부터 센 5위'라는 점은 같아 실적 판정은 동일하게 본다(사장님 확정 2026-08-06).
        #   ※ 나중에 배포 종류별로 기준을 다르게 할 거면 여기서 st 로 갈라 주면 된다.
        in_top5 = (st in ("ok", "list_ok")
                   and isinstance(ti, (int, float)) and not isinstance(ti, bool) and ti <= 5)
        since = _parse(p.get("top5_since"))
        patch = {}
        if in_top5:
            if since is None:
                patch["top5_since"] = now.isoformat()          # 진입 시각 기록
            elif not p.get("top5_achieved_at") and not p.get("top5_seeded") and (now - since) >= HOLD:
                patch["top5_achieved_at"] = now.isoformat()    # 24h 유지 달성 = 실적 +1
                achieved += 1
        else:
            # fail(측정오류)은 상태 유지 — 진짜 하락(out/list_out/no_section/no_list/5위밖)일 때만 리셋.
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
    sync_contracts()   # 실적을 계약 진행에 반영(카드 카운트 일치)


if __name__ == "__main__":
    c.need_config()
    run()
