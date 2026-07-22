# -*- coding: utf-8 -*-
"""카페 발행완료 큐 → 순위추적(cafe_rank_posts) 동기화.
   cafe_publish_queue 에서 발행완료(posted_url 있음) 글을 읽어 cafe_rank_posts 에 등록/갱신한다.
   - board(게시판): queue.board 첫 단어, 없으면 posted_url 의 menuid 로 판정(1 누수·2 설고점·3 더맨시스템).
   - keyword(측정 키워드): queue.keyword(+region), 없으면 지역+업종/제목에서 유추. (UI 에서 수동 보정 가능)
   - published_date: queue.done_at 날짜.
   기존 행은 board/발행일만 채우고 사용자가 고친 키워드(keyword_manual)는 건드리지 않는다.
실행: python cafe_rank_sync.py
필요: docs/cafe-board.sql(board 컬럼) 먼저 실행.
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

CAFE_VANITY = "ddmkt2"          # 마이클의 정보 세상
DEFAULT_CLUB = "31754130"
MENUID_BOARD = {"1": "누수", "2": "설고점", "3": "더맨시스템"}


def short_board(x):
    b = (x.get("board") or "").strip()
    if b:
        return b.split()[0]                          # '설고점 소방의 모든 것' → '설고점'
    pu = x.get("posted_url") or ""
    mm = re.search(r"menuid=(\d+)", pu)
    return MENUID_BOARD.get(mm.group(1) if mm else "", "누수")


def art_id(pu):
    m = re.search(r"articleid=(\d+)", pu) or re.search(r"/articles/(\d+)", pu) or re.search(r"/ddmkt2/(\d+)", pu)
    return m.group(1) if m else None


def derive_kw(x, board):
    kw = (x.get("keyword") or "").strip()
    region = (x.get("region") or "").strip()
    if kw:
        return f"{region} {kw}" if region and region not in kw else kw
    if board == "누수" and region:
        return f"{region} 누수탐지"
    t = (x.get("title") or "").strip()
    return " ".join(t.split()[:2]) if t else board     # 최후: 제목 앞 2어절(UI에서 보정)


def done_date(x):
    for k in ("done_at", "created_at"):
        v = x.get(k)
        if v:
            try:
                return datetime.datetime.fromisoformat(v.replace("Z", "+00:00")).date().isoformat()
            except Exception:
                return v[:10]
    return None


def main():
    q = requests.get(f"{URL}/rest/v1/cafe_publish_queue", headers=H,
                     params={"select": "title,posted_url,board,keyword,region,company,club_id,done_at,created_at",
                             "order": "id.desc"}, timeout=40, verify=False).json()
    pub = [x for x in q if x.get("posted_url")]

    existing = requests.get(f"{URL}/rest/v1/cafe_rank_posts", headers=H,
                            params={"select": "id,article_id,board,published_date"}, timeout=30, verify=False).json()
    by_aid = {str(r["article_id"]): r for r in existing}

    ins = upd = skip = 0
    seen = set()
    for x in pub:
        aid = art_id(x.get("posted_url") or "")
        if not aid or aid in seen:
            skip += 1
            continue
        seen.add(aid)
        board = short_board(x)
        if aid in by_aid:
            row = by_aid[aid]
            patch = {}
            if not row.get("board"):
                patch["board"] = board
            if not row.get("published_date"):
                patch["published_date"] = done_date(x)
            if patch:
                requests.patch(f"{URL}/rest/v1/cafe_rank_posts", headers=H,
                               params={"id": f"eq.{row['id']}"}, json=patch, timeout=20, verify=False)
                upd += 1
            continue
        body = {
            "club_id": x.get("club_id") or DEFAULT_CLUB,
            "cafe_name": CAFE_VANITY,
            "article_id": aid,
            "post_url": x.get("posted_url"),
            "title": x.get("title"),
            "keyword": derive_kw(x, board),
            "board": board,
            "published_date": done_date(x),
            "excluded": False,
        }
        r = requests.post(f"{URL}/rest/v1/cafe_rank_posts", headers={**H, "Prefer": "resolution=merge-duplicates"},
                          json=body, timeout=20, verify=False)
        if r.status_code < 300:
            ins += 1
            print(f"  + [{board}] #{aid} '{body['keyword']}' | {(body['title'] or '')[:34]}", flush=True)
        else:
            skip += 1
            print(f"  ! 등록실패 #{aid}: {r.status_code} {r.text[:120]}", flush=True)

    print(f"\n=== 동기화 완료: 신규 {ins} · 갱신 {upd} · 스킵 {skip} (발행완료 {len(pub)}) ===", flush=True)


if __name__ == "__main__":
    main()
