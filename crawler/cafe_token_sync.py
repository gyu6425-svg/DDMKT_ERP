# -*- coding: utf-8 -*-
"""카페 발행 토큰 → 실제 발행 건수 동기화. (토큰 1 = 발행 1건)

  '발행할 고객사 선택'·고객ERP 잔여 토큰이 SUB 발행분에도 맞도록: 각 고객의 소진 토큰을
  '실제 발행된 글 수'(cafe_rank_posts, 그 고객 계정/게시판)에 맞춘다. 부족분만 -차감 추가.
    잔여 = 충전 - 발행건수 (충전 상한, 음수 방지). 멱등(목표-현재 차이만 반영).
  실행: python cafe_token_sync.py           (독립)
        from cafe_token_sync import sync ; sync()   (크롤 후 호출)
"""
import os
import sys

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


def _get(path):
    r = requests.get(f"{_SB}/rest/v1/{path}", headers=_H, timeout=30)
    return r.json() if r.status_code == 200 else []


def sync(verbose=True):
    if not _SB or not _KEY:
        if verbose:
            print("SUPABASE_URL/SERVICE_KEY 없음 — token sync 건너뜀", flush=True)
        return 0
    accounts = _get("cafe_accounts?select=id,client_id,board_short")
    posts = _get("cafe_rank_posts?select=cafe_account_id,board&limit=10000")
    tokens = _get("cafe_tokens?select=client_id,delta&limit=5000")
    # 고객별 충전(+합)·현재 소진(-합)
    grant, consumed = {}, {}
    for t in tokens:
        cid = t.get("client_id")
        d = t.get("delta") or 0
        if d > 0:
            grant[cid] = grant.get(cid, 0) + d
        elif d < 0:
            consumed[cid] = consumed.get(cid, 0) + (-d)
    changed = 0
    for cid, g in grant.items():
        if not cid:
            continue
        accs = [a for a in accounts if a.get("client_id") == cid]
        acc_ids = {a["id"] for a in accs}
        boards = {a.get("board_short") for a in accs if a.get("board_short")}
        published = sum(
            1 for p in posts
            if p.get("cafe_account_id") in acc_ids or p.get("board") in boards
        )
        target = min(published, g)              # 발행건수만큼 소진(충전 상한)
        cur = consumed.get(cid, 0)
        if target > cur:
            add = target - cur
            requests.post(f"{_SB}/rest/v1/cafe_tokens", headers=_H, json=[{
                "client_id": cid, "delta": -add, "kind": "발행반영",
                "note": f"실제 발행 {published}건 반영(+{add} 차감)",
            }], timeout=15)
            changed += 1
            if verbose:
                print(f"  토큰 sync: client {cid[:8]} · 발행 {published} · 소진 {cur}→{target} (충전 {g}) → 잔여 {g - target}", flush=True)
    if verbose:
        print(f"=== 카페 토큰 sync 완료: {changed}건 반영 ===", flush=True)
    return changed


if __name__ == "__main__":
    sync()
