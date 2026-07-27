# -*- coding: utf-8 -*-
"""카페 발행완료 큐 → 업체별 카페 순위추적 동기화.

게시판 표시명은 board, 안정적인 업체 연결은 cafe_account_id를 사용한다.
검색 측정키(cafe_name + article_id)는 변경하지 않는다.
실행 전 docs/cafe-accounts.sql 적용 권장. 미적용 환경은 레거시 board 방식으로 폴백한다.
"""
import sys
import os
import re
import pathlib
import datetime
import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
requests.packages.urllib3.disable_warnings()

HERE = pathlib.Path(__file__).resolve().parent
for envp in (HERE / ".env", HERE / "cafe_pub" / ".env"):
    if envp.exists():
        for line in envp.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = re.match(r'^([A-Z_]+)\s*=\s*"?([^"\n\r]+)"?', line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip()

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

CAFE_VANITY = "ddmkt2"
DEFAULT_CLUB = "31754130"
MENUID_BOARD = {"1": "누수", "2": "설고점", "3": "더맨시스템"}
COMPANY_BOARD = {
    "leak": "누수", "dirty": "더티클리닉", "seolgo": "설고점", "theman": "더맨시스템",
}
BOARD_COMPANY = {v: k for k, v in COMPANY_BOARD.items()}


def _rest_get(table, select):
    r = requests.get(f"{URL}/rest/v1/{table}", headers=H, params={"select": select, "order": "created_at.desc"}, timeout=40, verify=False)
    data = r.json()
    return data if r.status_code < 300 else {"status": r.status_code, "body": data}


def queue_rows():
    fields = "title,posted_url,manifest,board,menu_id,keyword,region,company,club_id,done_at,created_at"
    data = _rest_get("cafe_publish_queue", fields)
    if isinstance(data, list):
        return data
    # board 컬럼 적용 전 DB 폴백: manifest[type=board]를 사용한다.
    legacy = _rest_get("cafe_publish_queue", fields.replace("board,", ""))
    if not isinstance(legacy, list):
        raise RuntimeError(f"cafe_publish_queue 조회 실패: {legacy}")
    return legacy


def manifest_board(x):
    for block in x.get("manifest") or []:
        if isinstance(block, dict) and block.get("type") == "board":
            return (block.get("name") or "").strip()
    return ""


def short_board(x):
    full = manifest_board(x) or (x.get("board") or "").strip()
    if full:
        for short in ("더티클리닉", "더맨시스템", "설고점", "누수"):
            if short in full:
                return short
        return full.split()[0]
    company = (x.get("company") or "").strip().lower()
    if company in COMPANY_BOARD:
        return COMPANY_BOARD[company]
    menu_id = str(x.get("menu_id") or "").strip()
    if not menu_id:
        mm = re.search(r"menuid=(\d+)", x.get("posted_url") or "")
        menu_id = mm.group(1) if mm else ""
    return MENUID_BOARD.get(menu_id, "누수")


def company_key(x, board):
    raw = (x.get("company") or "").strip().lower()
    return raw if raw in COMPANY_BOARD else BOARD_COMPANY.get(board, "leak")


def art_id(pu):
    m = re.search(r"articleid=(\d+)", pu) or re.search(r"/articles/(\d+)", pu) or re.search(r"/ddmkt2/(\d+)", pu)
    return m.group(1) if m else None


def derive_kw(x, board):
    kw = (x.get("keyword") or "").strip().strip(" ,")
    region = (x.get("region") or "").strip()
    if kw:
        return f"{region} {kw}" if region and region not in kw else kw
    if board == "누수" and region:
        return f"{region} 누수탐지"
    title = (x.get("title") or "").strip()
    return " ".join(title.split()[:2]).strip(" ,") if title else board


def done_date(x):
    for key in ("done_at", "created_at"):
        value = x.get(key)
        if value:
            try:
                return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()
            except Exception:
                return value[:10]
    return None


def get_accounts():
    data = requests.get(f"{URL}/rest/v1/cafe_accounts", headers=H,
                        params={"select": "id,company_key,board_short", "active": "eq.true"}, timeout=30, verify=False).json()
    return {x["company_key"]: x for x in data} if isinstance(data, list) else {}


def main():
    published = [x for x in queue_rows() if x.get("posted_url")]
    accounts = get_accounts()

    fields = "id,cafe_name,article_id,board,published_date,cafe_account_id"
    r = requests.get(f"{URL}/rest/v1/cafe_rank_posts", headers=H, params={"select": fields}, timeout=30, verify=False)
    existing = r.json()
    account_column = isinstance(existing, list)
    if not account_column:
        r = requests.get(f"{URL}/rest/v1/cafe_rank_posts", headers=H,
                         params={"select": "id,cafe_name,article_id,board,published_date"}, timeout=30, verify=False)
        existing = r.json()
    if not isinstance(existing, list):
        print("✋ cafe_rank_posts 조회 실패 — docs/cafe-accounts.sql을 먼저 실행하세요.\n" f"   ({existing})", flush=True)
        sys.exit(1)

    by_key = {(str(row.get("cafe_name") or CAFE_VANITY), str(row["article_id"])): row for row in existing}
    inserted = updated = skipped = failed = 0
    seen = set()
    for item in published:
        aid = art_id(item.get("posted_url") or "")
        cafe_name = CAFE_VANITY
        key = (cafe_name, aid)
        if not aid or key in seen:
            skipped += 1
            continue
        seen.add(key)
        board = short_board(item)
        ckey = company_key(item, board)
        account_id = (accounts.get(ckey) or {}).get("id")
        row = by_key.get(key)
        if row:
            patch = {}
            if board and row.get("board") != board:
                patch["board"] = board
            if not row.get("published_date"):
                patch["published_date"] = done_date(item)
            if account_column and account_id and row.get("cafe_account_id") != account_id:
                patch["cafe_account_id"] = account_id
            if patch:
                pr = requests.patch(f"{URL}/rest/v1/cafe_rank_posts", headers=H,
                                    params={"id": f"eq.{row['id']}"}, json=patch, timeout=20, verify=False)
                if pr.status_code < 300:
                    updated += 1
                else:
                    failed += 1
                    print(f"  ! 갱신실패 {ckey}/#{aid}: {pr.status_code} {pr.text[:120]}", flush=True)
            continue
        body = {
            "club_id": item.get("club_id") or DEFAULT_CLUB,
            "cafe_name": cafe_name,
            "article_id": aid,
            "post_url": item.get("posted_url"),
            "title": item.get("title"),
            "keyword": derive_kw(item, board),
            "board": board,
            "published_date": done_date(item),
            "excluded": False,
        }
        if account_column and account_id:
            body["cafe_account_id"] = account_id
        pr = requests.post(f"{URL}/rest/v1/cafe_rank_posts", headers={**H, "Prefer": "resolution=merge-duplicates"},
                           json=body, timeout=20, verify=False)
        if pr.status_code < 300:
            inserted += 1
            print(f"  + [{ckey}/{board}] #{aid} '{body['keyword']}' | {(body['title'] or '')[:34]}", flush=True)
        else:
            failed += 1
            print(f"  ! 등록실패 {ckey}/#{aid}: {pr.status_code} {pr.text[:120]}", flush=True)

    print(f"\n=== 동기화 완료: 신규 {inserted} · 갱신 {updated} · 스킵 {skipped} · 실패 {failed} (발행완료 {len(published)}) ===", flush=True)
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()