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
        r = requests.get(f"{_SB}/rest/v1/{path}", headers=h, timeout=30)
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


def sync(verbose=True):
    if not _SB or not _KEY:
        if verbose:
            print("SUPABASE_URL/SERVICE_KEY 없음 — token sync 건너뜀", flush=True)
        return 0
    accounts = _get("cafe_accounts?select=id,client_id,board_short")
    posts = _get("cafe_rank_posts?select=cafe_account_id,board")
    tokens = _get("cafe_tokens?select=client_id,delta,kind")  # ★ kind 필수 — 없으면 회수/발행 구분이 통째로 무너진다
    # 고객별 충전(순증)·현재 소진 — ★ 부호가 아니라 kind 로 나눈다.
    #   예전엔 '음수 = 소진'으로 봤는데, 회수/취소('조정')도 음수라 소진으로 잡혔다.
    #   그러면 이미 소진이 발행건수보다 커 보여서 실제 발행분이 영영 안 깎인다.
    #   실측 2026-08-18 금융책사: 지급 +300(발행 활성화 실패로 3번 지급) → 회수 -200 인데
    #   그 -200 이 '소진 200'으로 잡혀, 24건을 발행하고도 잔여가 100 그대로였다.
    #   충전 = 소진 이외 kind 의 합(회수는 마이너스로 그대로 반영) / 소진 = 발행 관련 kind 만.
    CONSUME_KINDS = {"발행", "발행반영"}
    grant, consumed = {}, {}
    for t in tokens:
        cid = t.get("client_id")
        d = t.get("delta") or 0
        kind = (t.get("kind") or "").strip()
        if kind in CONSUME_KINDS:
            if d < 0:
                consumed[cid] = consumed.get(cid, 0) + (-d)
        else:
            grant[cid] = grant.get(cid, 0) + d
    changed = 0
    for cid, g in grant.items():
        if not cid or g <= 0:
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
