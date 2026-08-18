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
#   ★ 마이클의 정보세상(ddmkt2, club 31754130) 4개 게시판은 2026-08-18 사장님 지시로 추적 중단.
#     그 카페엔 더 발행하지 않는다(마지막 발행 08-04). 순위 측정은 이미 2026-08-06 부터 제외돼 있었고,
#     이제 게시판 크롤도 끊어 새 글이 트래커로 들어오지 않게 한다. 옛 글은 excluded=true 로 내렸다.
#     (설고점·더맨은 계약이 살아 있지만 자체카페 ojh097/themansys 로 계속 추적된다)
TARGETS = [
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


# 발주 키워드로 인정할 최대 어절 수 — 이보다 길면 검색 키워드가 아니라 짜깁기 제목으로 본다.
GEN_KW_MAXW = 2

_genkw_cache = {}
def gen_keywords(cid):
    """이 고객의 원고 생성 키워드 집합(cafe_gen_requests.company = dep_*_<client_id>)."""
    if cid in _genkw_cache:
        return _genkw_cache[cid]
    out = set()
    try:
        rows = requests.get(f"{URL}/rest/v1/cafe_gen_requests", headers=DB, timeout=20, verify=False,
                            params={"select": "keyword", "company": f"like.*{cid}*", "limit": "2000"}).json()
        for x in (rows if isinstance(rows, list) else []):
            k = (x.get("keyword") or "").strip()
            if k:
                out.add(k)
    except Exception:
        pass
    _genkw_cache[cid] = out
    return out


def derive_kw_b(subject, cid):
    """모델B 키워드 — 제목이 발주 키워드로 시작하면 '거기까지만' 자른다. 아니면 종전 2어절.

       왜: 원고 제목은 "<발주 키워드> <수식어…>" 로 나온다. 2어절 규칙은 발주 키워드가
           한 단어일 때 뒤 수식어를 물고 들어간다.
             '주택바닥공사 내구·위생기준별 …'  → '주택바닥공사 내구'   (실측 2026-08-18)
             '공장바닥공사 맞춤 시공과 …'       → '공장바닥공사 맞춤'   (실측 2026-08-14)
           그렇게 만든 키워드로 재면 인기글 섹션 자체가 안 잡혀 '권외/측정불가'가 된다.
           실제로 '주택바닥공사'로 다시 재니 1위였다.
       어떻게: 발주 키워드 중 '제목이 그것으로 시작하는' 것들 가운데 가장 긴 것을 쓴다.
           단어 수와 무관하게 맞는다('헬스장바닥' 1어절 · '광교역 에폭시' 2어절 모두).
       경계 검사: 매칭 뒤가 공백이거나 끝이어야 한다 — '주택바닥공사장'이 '주택바닥공사'로
           잘리는 것을 막는다.
       ★ 2어절까지만 인정한다(GEN_KW_MAXW). 발주 키워드가 짜깁기 제목인 업체가 있다 —
           방문재활은 발주가 '구로 방문재활 방문요양 파킨슨병 장기요양등급'(5어절)이라
           그대로 쓰면 검색되지도 않는 문장으로 순위를 재게 된다. 그런 건 종전 2어절로 둔다.
       누수·방문재활처럼 '지역 제품' 발주는 결과가 2어절과 같아 사실상 종전 동작 유지."""
    t = re.sub(r"[,·|/:;~!?\"'()\[\]<>]", " ", subject or "").strip()
    norm = " ".join(t.split())
    best = ""
    for k in gen_keywords(cid):
        kk = " ".join((k or "").split())
        if not kk or len(kk.split()) > GEN_KW_MAXW or len(kk) <= len(best):
            continue
        if norm.startswith(kk) and (len(norm) == len(kk) or norm[len(kk)] == " "):
            best = kk
    return best or derive_kw(subject)


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


_vanity_cache = {}
def cafe_vanity(club, sample_aid):
    """clubid → 카페 vanity(cafeUrl). 네이버 검색 결과가 vanity로 노출돼, model-B 글도 vanity로 저장해야 순위 매칭됨.
       실패 시 clubid 폴백(최소 등록은 되게). article API 응답의 최상단 '\"url\":\"<slug>\"'."""
    if club in _vanity_cache:
        return _vanity_cache[club]
    van = None
    try:
        r = requests.get(f"https://apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes/{club}/articles/{sample_aid}",
                         headers=WEB, timeout=15, verify=False)
        m = re.search(r'"url"\s*:\s*"([a-zA-Z0-9_-]{2,30})"', r.text)
        van = m.group(1) if m else None
    except Exception:
        van = None
    _vanity_cache[club] = van or club
    return _vanity_cache[club]


_menu_cache = {}
def first_board_menu(club):
    """menuid 가 없는 board_url 구제 — 카페의 첫 게시판(menuType=B) menuid 를 알아낸다.
       실측 2026-08-14: DH크리트 board_url 이 '.../cafes/31770367/articles/write' 라 menuid 가 없었고,
       그 탓에 model-B 대상에서 통째로 빠져 발행분 5글이 트래커에 하나도 안 들어왔다."""
    if club in _menu_cache:
        return _menu_cache[club]
    mid = None
    try:
        r = requests.get(f"https://apis.naver.com/cafe-web/cafe2/SideMenuList?cafeId={club}",
                         headers=WEB, timeout=15, verify=False)
        menus = ((r.json().get("message") or {}).get("result") or {}).get("menus") or []
        for m in menus:
            if str(m.get("menuType")) == "B" and m.get("menuId"):
                mid = str(m["menuId"])
                break
    except Exception:
        mid = None
    _menu_cache[club] = mid
    return mid


def model_b_targets():
    """모델B(고객 자기 카페·SUB2 발행) 크롤 대상 — cafe_studio_settings.board_url 에서 clubid·menuid 파싱.
       반환: [(club, menuid, client_id, board_name)]. 더맨·설고처럼 이들 게시판도 크롤해 순위트래커에 등록.
       ⚠ 파싱 실패는 조용히 넘기지 않는다 — 안 잡히는 업체가 로그에 보여야 한다."""
    try:
        rows = requests.get(f"{URL}/rest/v1/cafe_studio_settings",
                            params={"select": "client_id,board_url,board_name"}, headers=DB, timeout=20, verify=False).json()
    except Exception:
        return []
    # fixed TARGETS 가 이미 크롤하는 카페(clubid)는 제외 — 중복 등록(cafe_name=vanity vs clubid) 방지.
    #   더맨·설고·더반·누수 self-카페(themansys/ojh097/thebanclean/ddnusu)는 fixed 로 추적 중이므로 model-B 재크롤 안 함.
    fixed_clubs = {t[0] for t in TARGETS}
    out = []
    for x in (rows if isinstance(rows, list) else []):
        url = x.get("board_url") or ""
        cid = x.get("client_id")
        club, menuid = _parse_club_menu(url)
        if club and not menuid:
            menuid = first_board_menu(club)
            if menuid:
                print(f"  · [모델B] board_url 에 menuid 가 없어 카페 첫 게시판(menu {menuid})로 보정 — client {cid}", flush=True)
        if club in fixed_clubs:
            continue
        if not (club and menuid and cid):
            if cid and url:
                print(f"  ! [모델B] 크롤 제외 — board_url 에서 clubid/menuid 를 못 읽음: client {cid} · {url}", flush=True)
            continue
        out.append((club, menuid, cid, x.get("board_name") or "고객카페"))
    return out


def _parse_club_menu(url):
    """글쓰기/게시판 주소에서 (club, menuid) 추출 — 여러 형식 지원.
       신형:  .../cafes/<club>/menus/<menuid>[/articles/write]
       구형:  ArticleWrite.nhn?clubid=<club>&menuid=<menuid>  (PC 글쓰기)
       모바일/일반: ?clubid=<club>&menuid=<menuid>  또는  search.clubid/search.menuid."""
    if not url:
        return None, None
    m = re.search(r"cafes/(\d+)/menus/(\d+)", url)
    if m:
        return m.group(1), m.group(2)
    club = re.search(r"(?:search\.)?clubid=(\d+)", url)
    menu = re.search(r"(?:search\.)?menuid=(\d+)", url)
    if club and menu:
        return club.group(1), menu.group(1)
    return None, None


def main():
    # ★ 발주 키워드 캐시는 매 사이클 비운다 — cafe_periodic 은 30분마다 main() 만 다시 부르는
    #   장기 프로세스라, 캐시를 두면 '기동 이후 새로 들어온 발주'를 영영 모른다.
    #   실측 2026-08-18: '주택바닥공사' 발주가 08-18 01:26 에 들어왔는데 데몬은 08-14 15:49 기동이라
    #   그 키워드를 몰랐고, 2어절 규칙으로 '주택바닥공사 내구'가 저장돼 순위가 권외로 찍혔다
    #   (같은 글을 '주택바닥공사'로 재면 1위).
    _genkw_cache.clear()
    accounts = requests.get(f"{URL}/rest/v1/cafe_accounts", headers=DB,
                            params={"select": "id,company_key,client_id", "active": "eq.true"}, timeout=20, verify=False).json()
    acc_by_company = {a["company_key"]: a["id"] for a in accounts} if isinstance(accounts, list) else {}
    # 계약이 끝나 정리한 업체(active=false)의 게시판은 아예 훑지 않는다.
    #   ★ TARGETS 가 하드코딩이라, 계정만 active=false 로 내려도 크롤은 계속 돌아 새 글이
    #     excluded=false 로 다시 들어왔다(2026-08-18 더반클린 정리하며 발견). 여기서 끊는다.
    #     계정 자체가 없는 대상(company_key 미등록)은 예전처럼 그대로 크롤한다 — 계정 미등록과 정리는 다르다.
    retired = set()
    try:
        allacc = requests.get(f"{URL}/rest/v1/cafe_accounts", headers=DB,
                              params={"select": "company_key,active"}, timeout=20, verify=False).json()
        retired = {a["company_key"] for a in allacc if a.get("active") is False and a.get("company_key")}
    except Exception as exc:
        print(f"  ! 정리 업체 조회 실패(전체 크롤 계속): {exc}", flush=True)
    # 모델B: dep_<client_id> cafe_account 를 client_id 로 매핑(포스트 링크용).
    acc_by_client = {a["client_id"]: a["id"] for a in (accounts if isinstance(accounts, list) else []) if a.get("client_id")}

    existing = requests.get(f"{URL}/rest/v1/cafe_rank_posts", headers=DB,
                            params={"select": "cafe_name,article_id"}, timeout=30, verify=False).json()
    have = {(str(x.get("cafe_name")), str(x["article_id"])) for x in existing} if isinstance(existing, list) else set()

    total_new = 0
    for club, vanity, mid, board, company in TARGETS:
        if company in retired:
            print(f"■ {board}({vanity}/menu {mid}): 계약 종료로 정리된 업체 — 크롤 건너뜀", flush=True)
            continue
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
        # ★ cafe_name = vanity(clubid 아님). 네이버 검색 카드가 vanity로 노출돼 순위 매칭에 vanity 필요.
        van = cafe_vanity(club, arts[0]["aid"]) if arts else club
        # dedup 은 저장키(vanity, aid) 기준 — 기존 글도 vanity로 저장돼 있어야 중복 안 남.
        new = [a for a in arts if (van, a["aid"]) not in have]
        print(f"■ [모델B] {board}(club {club}→{van}/menu {mid}): 목록 {len(arts)}글 · 신규 {len(new)}", flush=True)
        for a in new:
            body = {
                "club_id": club, "cafe_name": van, "article_id": a["aid"],
                "post_url": f"https://cafe.naver.com/{van}/{a['aid']}",
                "title": a["subject"], "keyword": derive_kw_b(a["subject"], cid),
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
                have.add((van, a["aid"]))
                print(f"    + #{a['aid']} '{body['keyword']}' | {a['subject'][:34]}", flush=True)
            else:
                print(f"    ! 등록실패 #{a['aid']}: {r.status_code} {r.text[:100]}", flush=True)

    print(f"\n=== 게시판 수집 완료: 신규 {total_new}글 등록 ===", flush=True)


if __name__ == "__main__":
    main()
