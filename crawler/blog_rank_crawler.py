"""
블로그 순위 크롤러 (사무실 PC에서 매일 자동 실행)
─────────────────────────────────────────────────────────────
역할:
  1) Supabase의 활성 blog_accounts(관리 블로그)를 읽는다
  2) 각 블로그의 네이버 RSS에서 최신 글을 가져와 blog_posts에 upsert
  3) 각 추적 글의 키워드로 네이버 검색 순위를 측정해 measurements(jsonb)에 오늘 값 추가
        - 블로그탭(bl): 네이버 공식 검색 API (JSON, 안정적)  ← 권장
        - 통합검색(ti): 모바일 통합검색 HTML 파싱 (공식 API 없음, best-effort)

특징:
  - HTTP 요청만 사용. AI/토큰 사용 없음.
  - Supabase에는 service_role 키로 직접 기록(RLS 우회). 외부 노출 절대 금지.

검증(디버그):
  python blog_rank_crawler.py --debug "송파 입주청소" --blog-id yellowhead76
    → 해당 키워드의 블로그탭 상위 결과와, 그 블로그의 순위를 바로 출력
"""

import os
import re
import sys
import time
import html
import json
import datetime
from urllib.parse import quote, unquote, urlparse

import requests

try:
    import feedparser
except ImportError:
    print("feedparser 가 필요합니다:  pip install -r requirements.txt")
    sys.exit(1)

from bs4 import BeautifulSoup
from dotenv import load_dotenv

# ── 설정 ─────────────────────────────────────────────────
load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# 네이버 검색 오픈 API (https://developers.naver.com → 애플리케이션 등록 → 검색)
NAVER_CLIENT_ID = os.environ.get("NAVER_CLIENT_ID", "")
NAVER_CLIENT_SECRET = os.environ.get("NAVER_CLIENT_SECRET", "")

UA = (
    "Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36"
)
REQUEST_DELAY = 1.0        # 검색 요청 사이 간격(초)
MAX_POSTS_PER_BLOG = 8     # 블로그당 RSS에서 가져올 최신 글 수
MAX_RANK_SCAN = 30         # 이 순위까지 탐색(넘으면 권외=99)
OUT_OF_RANK = 99

TODAY = datetime.date.today().isoformat()


# ── 공용 유틸 ────────────────────────────────────────────
def parse_blog_url(url: str):
    """blog.naver.com/{id}/{logNo} → (id, logNo). 둘 다 없으면 (None, None)."""
    m = re.search(r"(?:m\.)?blog\.naver\.com/([^/?#]+)(?:/(\d{6,}))?", url or "")
    if not m:
        return None, None
    return m.group(1), m.group(2)


def extract_log_no(url: str) -> str:
    return parse_blog_url(url)[1] or ""


TAILS = [
    "후기", "비용", "정리", "추천", "방법", "안내", "가격", "내돈내산",
    "솔직후기", "체크리스트", "비교", "총정리",
]


def extract_keyword(title: str) -> str:
    t = html.unescape(title or "").strip()
    t = re.sub(r"<[^>]+>", "", t)
    t = re.sub(r"[\[\]\(\)·,.!?~\-_/|]", " ", t)
    words = [w for w in t.split() if w and w not in TAILS]
    return " ".join(words[:2]) if words else t[:12]


# ── Supabase REST ────────────────────────────────────────
def need_config():
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("환경변수 SUPABASE_URL / SUPABASE_SERVICE_KEY 가 필요합니다. crawler/.env 확인.")
        sys.exit(1)


def sb_headers(extra=None):
    h = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    if extra:
        h.update(extra)
    return h


def sb_get(path, params=None):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=sb_headers(), params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def sb_insert(path, rows, on_conflict=None):
    params, prefer = {}, ["return=representation"]
    if on_conflict:
        params["on_conflict"] = on_conflict
        prefer.append("resolution=merge-duplicates")
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers=sb_headers({"Prefer": ",".join(prefer)}),
        params=params, data=json.dumps(rows), timeout=30,
    )
    r.raise_for_status()
    return r.json()


def sb_patch(path, params, payload):
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers=sb_headers({"Prefer": "return=representation"}),
        params=params, data=json.dumps(payload), timeout=30,
    )
    r.raise_for_status()
    return r.json()


# ── RSS 수집 ─────────────────────────────────────────────
def fetch_rss_posts(blog_id: str):
    parsed = feedparser.parse(f"https://rss.blog.naver.com/{blog_id}.xml")
    posts = []
    for entry in parsed.entries[:MAX_POSTS_PER_BLOG]:
        link = entry.get("link", "")
        pub = None
        if entry.get("published_parsed"):
            pub = datetime.date(*entry.published_parsed[:3]).isoformat()
        posts.append({"url": link, "title": html.unescape(entry.get("title", "")), "published_date": pub})
    return posts


# ── 블로그탭 순위: 네이버 공식 검색 API (안정적) ─────────
def naver_blog_search(keyword, display=100):
    url = "https://openapi.naver.com/v1/search/blog.json"
    headers = {"X-Naver-Client-Id": NAVER_CLIENT_ID, "X-Naver-Client-Secret": NAVER_CLIENT_SECRET}
    params = {"query": keyword, "display": min(100, display), "start": 1, "sort": "sim"}
    r = requests.get(url, headers=headers, params=params, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f"Naver API {r.status_code}: {r.text[:160]}")
    return r.json().get("items", [])


def measure_blog_rank_api(keyword, blog_id, log_no, debug=False):
    items = naver_blog_search(keyword, display=max(30, MAX_RANK_SCAN))
    for i, it in enumerate(items[:MAX_RANK_SCAN], start=1):
        lid, llog = parse_blog_url(it.get("link", ""))
        bid, _ = parse_blog_url(it.get("bloggerlink", ""))
        if debug:
            title = re.sub(r"<[^>]+>", "", it.get("title", ""))
            print(f"   {i:>2}. {lid or bid}  {title[:36]}")
        if log_no and llog == log_no:
            return i
        if not log_no and (lid == blog_id or bid == blog_id):
            return i
    return OUT_OF_RANK


# ── 블로그탭 순위: HTML 폴백 (API 키 없을 때) ────────────
def measure_blog_rank_html(keyword, blog_id, log_no):
    url = f"https://m.search.naver.com/search.naver?where=m_blog&query={quote(keyword)}"
    r = requests.get(url, headers={"User-Agent": UA}, timeout=20)
    return _rank_from_permalinks(r.text, blog_id, log_no)


# ── 통합검색 순위: 모바일 HTML (공식 API 없음) ──────────
def measure_integrated_rank(keyword, blog_id, log_no):
    url = f"https://m.search.naver.com/search.naver?query={quote(keyword)}"
    r = requests.get(url, headers={"User-Agent": UA}, timeout=20)
    return _rank_from_permalinks(r.text, blog_id, log_no)


# 네이버 검색결과의 '블로그 결과 목록' 후보 컨테이너 (구·신 구조 모두 시도).
# 구조가 바뀌어도 아래 후보 중 하나가 맞으면 그 영역만 정확히 스캔하고,
# 모두 빗나가면 페이지 전체 퍼머링크 스캔으로 안전하게 폴백한다.
RESULT_CONTAINERS = [
    "ul.lst_view > li",        # 모바일 블로그탭(구)
    "li.bx",                   # 통합/블로그 공통 아이템
    "div.view_wrap",           # 신 구조
    "div.total_wrap",
    "div.api_subject_bx li",   # 통합검색 블로그 섹션
]

# 결과 링크에서 실제 블로그 URL을 뽑아낼 후보 속성/파라미터
URL_ATTRS = ["data-cr-url", "data-url", "data-lnk", "href"]
_U_PARAM = re.compile(r"[?&](?:u|url|cru)=([^&]+)")


def _real_blog_url(anchor):
    """리다이렉트로 감싼 링크까지 풀어서 blog.naver.com URL을 반환."""
    from urllib.parse import unquote

    for attr in URL_ATTRS:
        val = anchor.get(attr, "")
        if not val:
            continue
        if "blog.naver.com" in val and "search.naver" not in val:
            return val
        m = _U_PARAM.search(val)
        if m:
            decoded = unquote(m.group(1))
            if "blog.naver.com" in decoded:
                return decoded
    return ""


def _iter_blog_keys(anchors):
    """앵커 목록에서 (blog_id, log_no)를 문서 순서대로, 중복 제거하며 생성."""
    seen = []
    for a in anchors:
        url = _real_blog_url(a)
        bid, lno = parse_blog_url(url)
        if not bid:
            continue
        key = (bid, lno)
        if key in seen:
            continue
        seen.append(key)
        yield len(seen), bid, lno


def _rank_from_permalinks(html_text, blog_id, log_no):
    """검색결과 HTML에서 이 블로그 글의 순위. 결과영역 우선, 실패 시 전체 폴백."""
    soup = BeautifulSoup(html_text, "html.parser")

    # 1) 알려진 결과 컨테이너 안의 제목 링크부터 시도
    anchors = []
    for sel in RESULT_CONTAINERS:
        nodes = soup.select(sel)
        if nodes:
            for node in nodes:
                a = node.find("a", href=True)
                if a:
                    anchors.append(a)
            if anchors:
                break

    # 2) 컨테이너를 못 찾으면 페이지 전체 블로그 링크로 폴백
    if not anchors:
        anchors = soup.select("a[href*='blog.naver.com'], a[data-cr-url], a[data-url]")

    for rank, bid, lno in _iter_blog_keys(anchors):
        if log_no and lno == log_no:
            return rank
        if not log_no and bid == blog_id:
            return rank
        if rank >= MAX_RANK_SCAN:
            break
    return OUT_OF_RANK


# ── 측정 통합 ────────────────────────────────────────────
USE_API = bool(NAVER_CLIENT_ID and NAVER_CLIENT_SECRET)


# ── 웹사이트 순위: 네이버 웹문서 검색 API (webkr) ─────────
# 통합검색 '웹사이트' 섹션의 회사 홈페이지(블로그 아님) 순위. 블로그탭과 동일 인증키 재사용.
# 주의: webkr 은 sort 미지원이고, API 순서가 실제 화면 노출순과 다를 수 있어 신뢰도가 ti/bl 보다 낮다.
def naver_web_search(keyword, display=100):
    url = "https://openapi.naver.com/v1/search/webkr.json"
    headers = {"X-Naver-Client-Id": NAVER_CLIENT_ID, "X-Naver-Client-Secret": NAVER_CLIENT_SECRET}
    params = {"query": keyword, "display": min(100, display), "start": 1}  # sort 미지원
    r = requests.get(url, headers=headers, params=params, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f"Naver webkr API {r.status_code}: {r.text[:160]}")
    return r.json().get("items", [])


def norm_host(u: str) -> str:
    """URL/도메인 → 비교용 호스트(scheme/www/경로/쿼리/포트 제거, 소문자)."""
    if not u:
        return ""
    s = u.strip()
    m = _U_PARAM.search(s)            # 검색 리다이렉트 래퍼(u/url/cru) 풀기
    if m:
        s = unquote(m.group(1))
    if "://" not in s:
        s = "http://" + s
    host = urlparse(s).netloc.lower().split(":", 1)[0]
    return host[4:] if host.startswith("www.") else host


def host_match(link: str, website_host: str) -> bool:
    """경로 무시, 호스트 동일성만 비교(가장 안전한 매칭)."""
    a, b = norm_host(link), norm_host(website_host)
    return bool(a) and a == b


def measure_web_rank(keyword, website_host):
    """(rank, status) 반환. status: ok=노출, out=권외, fail=API/네트워크 실패."""
    if not USE_API:
        return OUT_OF_RANK, "fail"      # 키 없으면 측정 불가(권외와 구분)
    try:
        items = naver_web_search(keyword, display=max(30, MAX_RANK_SCAN))
    except Exception as exc:
        print(f"    [웹사이트 실패] {keyword}: {exc}")
        return OUT_OF_RANK, "fail"
    for i, it in enumerate(items[:MAX_RANK_SCAN], start=1):
        if host_match(it.get("link", ""), website_host):
            return i, "ok"
    return OUT_OF_RANK, "out"


def measure_rank(keyword, blog_id, post_url):
    log_no = extract_log_no(post_url)

    # 블로그탭
    try:
        bl = measure_blog_rank_api(keyword, blog_id, log_no) if USE_API \
            else measure_blog_rank_html(keyword, blog_id, log_no)
    except Exception as exc:
        print(f"    [블로그탭 실패] {keyword}: {exc}")
        bl = OUT_OF_RANK
    time.sleep(REQUEST_DELAY)

    # 통합검색
    try:
        ti = measure_integrated_rank(keyword, blog_id, log_no)
    except Exception as exc:
        print(f"    [통합검색 실패] {keyword}: {exc}")
        ti = OUT_OF_RANK
    time.sleep(REQUEST_DELAY)

    return ti, bl


# ── 디버그: 키워드 하나로 실제 순위 검증 ────────────────
def debug_keyword(keyword, blog_id, post_url="", website_host=""):
    log_no = extract_log_no(post_url)
    print(f"[디버그] 키워드: {keyword} / 블로그ID: {blog_id} / logNo: {log_no or '(없음)'}")
    print(f"API 사용: {'예' if USE_API else '아니오(HTML 폴백)'}")
    if USE_API:
        print("── 블로그탭(공식 API) 상위 결과 ──")
        bl = measure_blog_rank_api(keyword, blog_id, log_no, debug=True)
    else:
        bl = measure_blog_rank_html(keyword, blog_id, log_no)
    ti = measure_integrated_rank(keyword, blog_id, log_no)
    print(f"\n결과 → 블로그탭: {bl if bl < OUT_OF_RANK else '권외'} / 통합검색: {ti if ti < OUT_OF_RANK else '권외'}")
    if website_host:
        we, status = measure_web_rank(keyword, website_host)
        print(f"웹사이트({norm_host(website_host)}): {we if status == 'ok' else status}")


# ── 메인 ─────────────────────────────────────────────────
def run():
    need_config()
    print(f"=== 블로그 순위 크롤링 시작 {TODAY} / 블로그탭 측정: {'공식 API' if USE_API else 'HTML 폴백'} ===")
    if not USE_API:
        print("※ NAVER_CLIENT_ID/SECRET 가 없어 HTML 폴백을 씁니다. 안정적인 순위를 위해 공식 API 등록을 권장합니다.")

    accounts = sb_get("blog_accounts", {"is_active": "eq.true", "select": "*"})
    print(f"활성 블로그 {len(accounts)}개")

    for acc in accounts:
        blog_id = acc.get("blog_id") or parse_blog_url(acc.get("blog_url", ""))[0] or ""
        if not blog_id:
            continue
        try:
            rss = fetch_rss_posts(blog_id)
        except Exception as exc:
            print(f"  RSS 실패 {acc['name']}: {exc}")
            continue
        rows = [
            {
                "blog_account_id": acc["id"], "post_url": p["url"], "title": p["title"],
                "keyword": extract_keyword(p["title"]), "published_date": p["published_date"],
            }
            for p in rss if p["url"]
        ]
        if rows:
            sb_insert("blog_posts", rows, on_conflict="blog_account_id,post_url")
        print(f"  {acc['name']}: RSS {len(rows)}건 동기화")

    posts = sb_get("blog_posts", {"select": "*"})
    acc_by_id = {a["id"]: a for a in accounts}
    measured = 0
    for post in posts:
        acc = acc_by_id.get(post["blog_account_id"])
        if not acc:
            continue
        keyword = post.get("keyword") or ""
        if not keyword:
            continue
        blog_id = acc.get("blog_id") or parse_blog_url(acc.get("blog_url", ""))[0] or ""
        ti, bl = measure_rank(keyword, blog_id, post.get("post_url", ""))
        records = [r for r in (post.get("measurements") or []) if r.get("date") != TODAY]
        records.append({"date": TODAY, "ti": ti, "bl": bl})
        sb_patch("blog_posts", {"id": f"eq.{post['id']}"}, {"measurements": records})
        measured += 1
        print(f"    측정 [{acc['name']}] {keyword}: 통합 {ti} / 블로그 {bl}")

    # ── 웹사이트(회사 단위) 순위 측정 ──
    # 글 단위가 아니라 업체 단위 1회 측정 → blog_accounts.website_measurements 에 patch.
    # website_url/rep_keyword 미설정 업체는 건너뜀('해당없음').
    web_measured = 0
    for acc in accounts:
        host = (acc.get("website_url") or "").strip()
        kw = (acc.get("rep_keyword") or "").strip()
        if not host or not kw:
            continue
        we, status = measure_web_rank(kw, host)
        recs = [r for r in (acc.get("website_measurements") or []) if r.get("date") != TODAY]
        recs.append({"date": TODAY, "we": we, "status": status})
        # 부분 patch — website_measurements 키만 보내 다른 컬럼 불변.
        sb_patch("blog_accounts", {"id": f"eq.{acc['id']}"}, {"website_measurements": recs})
        web_measured += 1
        print(f"    웹사이트 [{acc['name']}] {kw}: {we if status == 'ok' else status}")
        time.sleep(REQUEST_DELAY)

    print(f"=== 완료: 글 {measured}건 측정 / 웹사이트 {web_measured}건 측정 ===")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--debug":
        kw = args[1] if len(args) > 1 else ""
        blog_id = ""
        post_url = ""
        website_host = ""
        if "--blog-id" in args:
            blog_id = args[args.index("--blog-id") + 1]
        if "--post-url" in args:
            post_url = args[args.index("--post-url") + 1]
        if "--website-host" in args:
            website_host = args[args.index("--website-host") + 1]
        if not kw:
            print('사용법: python blog_rank_crawler.py --debug "키워드" --blog-id 블로그아이디 [--post-url 글URL] [--website-host 도메인]')
            sys.exit(1)
        debug_keyword(kw, blog_id, post_url, website_host)
    else:
        run()
