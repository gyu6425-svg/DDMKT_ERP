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
from dotenv import load_dotenv

_HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_HERE, "..", ".env"))
load_dotenv(os.path.join(_HERE, ".env"))
_SB = os.getenv("SUPABASE_URL", "").rstrip("/")
_KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
_H = {"apikey": _KEY, "Authorization": f"Bearer {_KEY}", "Content-Type": "application/json"}
_SUBTYPE = "카페 배포"


def _get(path):
    r = requests.get(f"{_SB}/rest/v1/{path}", headers=_H, timeout=30)
    return r.json() if r.status_code == 200 else []


def _norm(s):
    return (s or "").strip().replace(" ", "")


def _manual_keywords():
    """일반 배포(직접형 접수) 키워드 — client_id → {정규화 키워드}.
       일반 배포는 인기탭을 안 따지므로 '발행되면 그 자체가 실적'이다(5위 24h를 기다리지 않는다).
       인기탭 배포는 종전대로 5위 24시간 유지에서만 +1 — 두 계약의 조건이 다르므로 집계를 나눈다."""
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
                 "top5_achieved_at,top5_seeded,excluded&limit=5000")
    manual_kw = _manual_keywords()
    contracts = _get(f"client_contracts?subtype=eq.{quote(_SUBTYPE)}&select=id,client_id,goal_count,remain_count")
    changed = 0
    for ct in contracts:
        cid = ct.get("client_id")
        goal = ct.get("goal_count") or 0
        if not cid or not goal:
            continue
        accs = [a for a in accounts if a.get("client_id") == cid]
        acc_ids = {a["id"] for a in accs}
        boards = {a.get("board_short") for a in accs}
        base = sum(a.get("done_count") or 0 for a in accs)
        mine = manual_kw.get(cid, set())
        achieved = normal = 0
        for p in posts:
            if not (p.get("cafe_account_id") in acc_ids or p.get("board") in boards):
                continue
            if p.get("excluded"):
                continue
            kw = _norm(p.get("keyword_manual") or p.get("keyword"))
            if kw and kw in mine:
                normal += 1                      # 일반 배포 — 발행 자체가 실적
            elif p.get("top5_achieved_at") and not p.get("top5_seeded"):
                achieved += 1                    # 인기탭 배포 — 5위 24시간 유지
        done = base + achieved + normal
        remain = max(0, goal - done)
        if remain == (ct.get("remain_count")):
            continue
        r = requests.patch(
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
