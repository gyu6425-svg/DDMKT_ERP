# -*- coding: utf-8 -*-
"""카페 발행 실적 → 계약관리(client_contracts '카페 배포') 자동 동기화.

  카페 관리시트가 쓰는 '실적' = 수동 베이스라인(cafe_accounts.done_count) + 5위 24h 달성(top5_achieved_at).
  이 실적을 각 업체(client)의 '카페 배포' 계약 remain_count 에 반영한다(remain = goal - 실적).
  → 24시간 유지 +1 이 관리시트뿐 아니라 계약관리(우리 ERP)·고객ERP 모두에 반영된다.
    (고객ERP·관리시트는 실시간 계산이라 자동 반영. 계약 remain 은 저장값이라 이 sync 가 필요.)

  실행: python cafe_contract_sync.py          (독립 실행)
        from cafe_contract_sync import sync ; sync()   (크롤러가 측정 후 호출)
  전제: ../.env 의 SUPABASE_URL · SUPABASE_SERVICE_KEY.
"""
import os
import sys
from urllib.parse import quote

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore

truststore.inject_into_ssl()
import requests

# Supabase REST 전용 재시도 세션 — 터널/컨테이너 순간 끊김 1회로 사이클이 통째로
#   날아가는 것을 막는다. POST 재시도 제외: POST 없음(GET/PATCH 만).
import sb_retry
_SBS = sb_retry.session(allow_post=False)
from dotenv import load_dotenv

_HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_HERE, "..", ".env"))
load_dotenv(os.path.join(_HERE, ".env"))
_SB = os.getenv("SUPABASE_URL", "").rstrip("/")
_KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
_H = {"apikey": _KEY, "Authorization": f"Bearer {_KEY}", "Content-Type": "application/json"}
_SUBTYPE = "카페 배포"


# PostgREST 는 서버 설정(db-max-rows)에 걸려 **limit 을 크게 줘도 1000행에서 조용히 잘린다.**
#   실측 2026-08-18: blog_posts?select=id → 200 OK 인데 content-range 0-999/*.
#   에러가 아니라 정상 응답이라 그대로 계산하면 충전/소진이 과소집계되고,
#   target=min(published,grant) 가 매 실행마다 어긋나 **중복 차감 또는 무상 발행**이 난다.
#   → Range 헤더로 끝까지 넘긴다. 정렬(order=id)을 고정하지 않으면 페이지가 겹치거나 빠진다.
_PAGE = 1000


def _get(path):
    sep = "&" if "?" in path else "?"
    if "order=" not in path:
        path = f"{path}{sep}order=id"
    out = []
    start = 0
    while True:
        h = dict(_H)
        h["Range-Unit"] = "items"
        h["Range"] = f"{start}-{start + _PAGE - 1}"
        r = _SBS.get(f"{_SB}/rest/v1/{path}", headers=h, timeout=30)
        if r.status_code not in (200, 206):
            break
        chunk = r.json()
        if not isinstance(chunk, list):
            return chunk
        out.extend(chunk)
        if len(chunk) < _PAGE:
            break
        start += _PAGE
        if start > 200000:      # 폭주 방지
            print("  ! 페이지네이션 상한 도달 — 조회 중단", flush=True)
            break
    return out


def _norm(s):
    return (s or "").strip().replace(" ", "")


def _attrib_map():
    """client_id → 실적을 귀속시킬 client_id. 하위 업체는 부모 대행사로 올린다.

    대행사는 발행하지 않고 하위 업체가 쓴다(사장님 확정 2026-08-20).
    그래서 하위 업체의 달성 글이 **부모 대행사의 계약** 진행률로 차올라야 한다.
    ★ 조회 시점의 해석일 뿐이고 cafe_accounts.client_id 를 옮기지 않는다 —
      옮기면 토큰 차감 주체까지 부모로 바뀌어 하위 잔액이 안 줄어든다.
    """
    try:
        rows = _get("clients?select=id,parent_client_id")
    except Exception:
        return {}
    return {r["id"]: (r.get("parent_client_id") or r["id"]) for r in rows}


def _manual_keywords():
    """일반 배포(직접형 접수) 키워드 — client_id → {정규화 키워드}.
       달성 기준은 인기탭 배포와 같다(5위 24시간). 이 목록은 '어느 쪽 배포로 달성했는지'를
       로그에 나눠 찍기 위한 것이다 — 나중에 기준을 갈라야 할 때 바로 쓸 수 있게 남겨 둔다."""
    out = {}
    for r in _get("cafe_deploy_requests?deploy_type=eq." + quote("직접형")
                  + "&select=client_id,selected_keywords,keyword"):
        cid = r.get("client_id")
        if not cid:
            continue
        s = out.setdefault(cid, set())
        # selected_keywords 는 {keyword, volume, theme} 객체 배열이다(문자열 아님).
        for k in (r.get("selected_keywords") or []):
            kw = _norm(k.get("keyword") if isinstance(k, dict) else k)
            if kw:
                s.add(kw)
        if _norm(r.get("keyword")):
            s.add(_norm(r.get("keyword")))
    return out


def sync(verbose=True):
    """모든 '카페 배포' 계약의 remain_count 를 카페 실적으로 갱신. 변경 건수 반환.
       실적 = 베이스(done_count) + 인기탭 배포 5위24h 달성 + 일반 배포 발행분."""
    if not _SB or not _KEY:
        if verbose:
            print("SUPABASE_URL/SERVICE_KEY 없음 — sync 건너뜀", flush=True)
        return 0
    accounts = _get("cafe_accounts?select=id,client_id,board_short,done_count")
    posts = _get("cafe_rank_posts?select=board,cafe_account_id,keyword,keyword_manual,"
                 "top5_achieved_at,top5_seeded,excluded")
    manual_kw = _manual_keywords()
    contracts = _get(f"client_contracts?subtype=eq.{quote(_SUBTYPE)}&select=id,client_id,goal_count,remain_count")
    attrib = _attrib_map()
    changed = 0
    for ct in contracts:
        cid = ct.get("client_id")
        goal = ct.get("goal_count") or 0
        if not cid or not goal:
            continue
        # ★ 하위 업체의 계약 행에는 쓰지 않는다 — 실적은 부모 대행사 계약으로 올라간다.
        #   여기서 안 거르면 같은 달성이 부모·자식 두 행에 각각 잡힌다(이중 계상).
        if attrib.get(cid, cid) != cid:
            continue
        # 귀속: 이 계약에 묶이는 계정 = 자기 계정 + (대행사면) 하위 업체들의 계정.
        #   대행사도 자기 카페로 직접 발행하는 경우가 있다(더업스) — 자기 것을 빼면 실적이 증발한다.
        accs = [a for a in accounts if attrib.get(a.get("client_id"), a.get("client_id")) == cid]
        acc_ids = {a["id"] for a in accs}
        # ⚠️ 빈 board_short 를 넣으면 board 가 빈 글이 그 계정들 전부의 실적으로 잡힌다.
        #   같은 목적의 cafe_token_sync 는 이미 거르고 있었다 — 규칙을 맞춘다.
        boards = {a.get("board_short") for a in accs if a.get("board_short")}
        base = sum(a.get("done_count") or 0 for a in accs)
        # 일반배포 판정 키워드도 하위 것까지 합친다(합계는 같고 로그의 인기탭/일반 분류만 정확해진다).
        mine = set()
        for c2, kws in manual_kw.items():
            if attrib.get(c2, c2) == cid:
                mine |= kws
        achieved = normal = 0
        for p in posts:
            if not (p.get("cafe_account_id") in acc_ids or p.get("board") in boards):
                continue
            if p.get("excluded"):
                continue
            # ★ 일반 배포도 인기탭 배포와 같은 기준(5위 24시간 유지)으로 센다 — 사장님 확정 2026-08-06.
            #   인기글 섹션이 없는 키워드는 통합리스트 순위(list_ok)로 잡히고, 그것도 top5_achieved_at
            #   으로 흘러온다(cafe_top5_tracker 가 ok/list_ok 를 같이 인정).
            #   집계만 배포 종류별로 나눠 두어(normal), 나중에 기준을 바꿀 때 여기만 손대면 되게 한다.
            if p.get("top5_achieved_at") and not p.get("top5_seeded"):
                kw = _norm(p.get("keyword_manual") or p.get("keyword"))
                if kw and kw in mine:
                    normal += 1                  # 일반 배포분(표시용 분리)
                else:
                    achieved += 1                # 인기탭 배포분
        done = base + achieved + normal
        remain = max(0, goal - done)
        if remain == (ct.get("remain_count")):
            continue
        r = _SBS.patch(
            f"{_SB}/rest/v1/client_contracts?id=eq.{ct['id']}",
            headers=_H, json={"remain_count": remain}, timeout=15,
        )
        if r.status_code < 300:
            changed += 1
            if verbose:
                print(f"  계약 sync: client {cid[:8]} · 실적 {done}"
                      f"(base{base}+인기탭{achieved}{f'+일반{normal}' if normal else ''}) "
                      f"→ remain {remain}/{goal}", flush=True)
    if verbose:
        print(f"=== 카페 계약 sync 완료: {changed}건 갱신 ===", flush=True)
    return changed


if __name__ == "__main__":
    sync()
