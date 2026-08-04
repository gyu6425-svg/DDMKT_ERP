# -*- coding: utf-8 -*-
"""카페 게시판 최신글 자동 수집·등록 — 발행 경로와 무관하게 게시판에 올라온 글을 트래커에 편입.
   여러 카페를 지원한다(마이클의 정보 세상 / 더반클린 …). 각 (카페, menuid) 글목록을
   ArticleListV2(공개 API)로 가져와 cafe_rank_posts 에 없는 글을 등록(board·키워드·계정 연결).
   ⚠ 글번호(article_id)는 카페마다 중복되므로 유일키는 (cafe_name, article_id).
실행: python cafe_board_crawl.py [게시판당_페이지수=2]
"""
import sys
import os
import re
import pathlib
import datetime
import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore
truststore.inject_into_ssl()
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
DB = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

# 추적 대상: (club_id, 카페 vanity, menuid, 게시판 표시명, company_key)
#   vanity 는 순위 매칭(measure_cafe_rank)에 쓰이므로 정확해야 한다.
TARGETS = [
    ("31754130", "ddmkt2", "1", "누수", "leak"),
    ("31754130", "ddmkt2", "2", "설고점", "seolgo"),
    ("31754130", "ddmkt2", "3", "더맨시스템", "theman"),
    ("31754130", "ddmkt2", "5", "더티클리닉", "dirty"),
    ("31761053", "thebanclean", "2", "더반클린", "theban"),   # 더반클린 - 청소 솔루션
    ("31762300", "ddnusu", "2", "누수상담소", "nusu"),         # 누수탐지 상담소 - 후기·시공사례
    ("31764949", "themansys", "1", "더맨시스템", "theman2"),   # 더맨 자체카페(마이클과 별개)
    ("31764966", "ojh097", "1", "설고점", "seolgo2"),          # 설고 자체카페(마이클과 별개)
]
PER_PAGE = 50
PAGES = int(sys.argv[1]) if len(sys.argv) > 1 else 2

# 업체별 추적 시작일(YYYY-MM-DD) — 이 날짜 이전 발행 글은 (재)등록하지 않는다.
#   옛 발행분을 정리(삭제)한 뒤 게시판에 남은 옛 글이 크롤로 다시 유입되는 것을 막는 용도.
TRACK_SINCE = {
    "dirty": "2026-08-04",   # 더티클리닉 — 옛 히스토리 정리, 이 날짜부터 새로 집계
}

WEB = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}


def derive_kw(subject):
    # 제목 앞 2어절(지역+제품키워드) — 문장부호 제거(콜론 등이 붙으면 네이버 검색 깨짐). UI 재검색으로 보정 가능.
    t = re.sub(r"[,·|/:;~!?\"'()\[\]<>]", " ", subject or "").strip()
    return " ".join(t.split()[:2]).strip() or (subject or "")[:12]


def fetch_articles(club, menuid):
    out = []
    for page in range(1, PAGES + 1):
        u = (f"https://apis.naver.com/cafe-web/cafe2/ArticleListV2.json"
             f"?search.clubid={club}&search.menuid={menuid}&search.page={page}"
             f"&search.perPage={PER_PAGE}&search.queryType=lastArticle")
        try:
            r = requests.get(u, headers={**WEB, "Referer": f"https://cafe.naver.com/f-e/cafes/{club}/menus/{menuid}"}, timeout=20)
            j = r.json()
        except Exception as exc:
            print(f"    [카페 {club}/menu {menuid} p{page}] 조회 실패: {exc}", flush=True)
            break
        res = (j.get("message") or {}).get("result") or {}
        for a in (res.get("articleList") or []):
            aid = a.get("articleId")
            if not aid:
                continue
            out.append({"aid": str(aid), "subject": a.get("subject") or "",
                        "wdate": a.get("writeDate") or a.get("writeDateTimestamp")})
        if not res.get("hasNext"):
            break
    return out


def to_date(w):
    if not w:
        return None
    try:
        if isinstance(w, (int, float)) or str(w).isdigit():
            ts = int(w) / (1000 if int(w) > 10_000_000_000 else 1)
            return datetime.datetime.fromtimestamp(ts).date().isoformat()
    except Exception:
        pass
    m = re.search(r"(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})", str(w))
    return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else None


def model_b_targets():
    """모델B(고객 자기 카페·SUB2 발행) 크롤 대상 — cafe_studio_settings.board_url 에서 clubid·menuid 파싱.
       반환: [(club, menuid, client_id, board_name)]. 더맨·설고처럼 이들 게시판도 크롤해 순위트래커에 등록."""
    try:
        rows = requests.get(f"{URL}/rest/v1/cafe_studio_settings",
                            params={"select": "client_id,board_url,board_name"}, headers=DB, timeout=20, verify=False).json()
    except Exception:
        return []
    out = []
    for x in (rows if isinstance(rows, list) else []):
        url = x.get("board_url") or ""
        m = re.search(r"cafes/(\d+)/menus/(\d+)", url)
        if m and x.get("client_id"):
            out.append((m.group(1), m.group(2), x["client_id"], x.get("board_name") or "고객카페"))
    return out


def main():
    accounts = requests.get(f"{URL}/rest/v1/cafe_accounts", headers=DB,
                            params={"select": "id,company_key,client_id", "active": "eq.true"}, timeout=20, verify=False).json()
    acc_by_company = {a["company_key"]: a["id"] for a in accounts} if isinstance(accounts, list) else {}
    # 모델B: dep_<client_id> cafe_account 를 client_id 로 매핑(포스트 링크용).
    acc_by_client = {a["client_id"]: a["id"] for a in (accounts if isinstance(accounts, list) else []) if a.get("client_id")}

    existing = requests.get(f"{URL}/rest/v1/cafe_rank_posts", headers=DB,
                            params={"select": "cafe_name,article_id"}, timeout=30, verify=False).json()
    have = {(str(x.get("cafe_name")), str(x["article_id"])) for x in existing} if isinstance(existing, list) else set()

    total_new = 0
    for club, vanity, mid, board, company in TARGETS:
        arts = fetch_articles(club, mid)
        new = [a for a in arts if (vanity, a["aid"]) not in have]
        # 추적 시작일 이전(옛 글) 제외 — 정리한 옛 히스토리가 크롤로 재유입되지 않게.
        since = TRACK_SINCE.get(company)
        if since:
            new = [a for a in new if not (to_date(a["wdate"]) and to_date(a["wdate"]) < since)]
        print(f"■ {board}({vanity}/menu {mid}): 목록 {len(arts)}글 · 신규 {len(new)}", flush=True)
        for a in new:
            body = {
                "club_id": club, "cafe_name": vanity, "article_id": a["aid"],
                "post_url": f"https://cafe.naver.com/{vanity}/{a['aid']}",
                "title": a["subject"], "keyword": derive_kw(a["subject"]),
                "board": board, "published_date": to_date(a["wdate"]), "excluded": False,
            }
            acid = acc_by_company.get(company)
            if acid:
                body["cafe_account_id"] = acid
            r = requests.post(f"{URL}/rest/v1/cafe_rank_posts",
                              headers={**DB, "Prefer": "resolution=merge-duplicates"}, json=body, timeout=20, verify=False)
            if r.status_code < 300:
                total_new += 1
                have.add((vanity, a["aid"]))
                print(f"    + #{a['aid']} '{body['keyword']}' | {a['subject'][:34]}", flush=True)
            else:
                print(f"    ! 등록실패 #{a['aid']}: {r.status_code} {r.text[:100]}", flush=True)

    # ── 모델B(고객 자기 카페) — board_url 파싱해 크롤·등록. client_id 로 스코프(고객 순위트래커에 노출). ──
    for club, mid, cid, board in model_b_targets():
        arts = fetch_articles(club, mid)
        # 모델B는 vanity 대신 clubid 로 dedup(고유). 클럽ID 기반 URL.
        new = [a for a in arts if (club, a["aid"]) not in have]
        print(f"■ [모델B] {board}(club {club}/menu {mid}): 목록 {len(arts)}글 · 신규 {len(new)}", flush=True)
        for a in new:
            body = {
                "club_id": club, "cafe_name": club, "article_id": a["aid"],
                "post_url": f"https://cafe.naver.com/ca-fe/cafes/{club}/articles/{a['aid']}",
                "title": a["subject"], "keyword": derive_kw(a["subject"]),
                "board": board, "published_date": to_date(a["wdate"]), "excluded": False,
                "client_id": cid,
            }
            acid = acc_by_client.get(cid)
            if acid:
                body["cafe_account_id"] = acid
            r = requests.post(f"{URL}/rest/v1/cafe_rank_posts",
                              headers={**DB, "Prefer": "resolution=merge-duplicates"}, json=body, timeout=20, verify=False)
            if r.status_code < 300:
                total_new += 1
                have.add((club, a["aid"]))
                print(f"    + #{a['aid']} '{body['keyword']}' | {a['subject'][:34]}", flush=True)
            else:
                print(f"    ! 등록실패 #{a['aid']}: {r.status_code} {r.text[:100]}", flush=True)

    print(f"\n=== 게시판 수집 완료: 신규 {total_new}글 등록 ===", flush=True)


if __name__ == "__main__":
    main()
