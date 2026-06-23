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
MAX_KEYWORDS_PER_ACCOUNT = 3  # 블로그당 대표키워드 측정 상한(네이버 요청량/차단 가드)
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

# 동기화 주의: functions/lib/crawlLib.mjs 의 동일 리스트와 1:1 유지. 테스트(test_parsers.py / crawlLib.test.mjs)가 sync 보증.
MODIFIER_WORDS = ["아파트", "주택", "빌라", "상가", "사무실", "사무용", "사무", "오피스텔", "오피스", "빌딩", "신축", "구축", "단독주택", "다세대", "원룸", "투룸", "욕실", "화장실", "주방", "베란다", "발코니", "지하", "외벽", "내벽"]
MODIFIER_PREFIXES = ["스탠드형", "벽걸이형", "스탠드", "벽걸이", "천장형", "시스템", "가정용", "업소용", "이동식"]
SERVICE_SUFFIXES = ["청소", "교체", "탐지", "시공", "수리", "설치", "점검", "코팅", "철거", "방수", "줄눈", "인테리어", "제거", "도배", "장판", "보수", "복원", "리모델링", "세척", "폐기물", "폐기", "처리", "이전", "공사"]
GU_BLACKLIST = ["배수구", "입구", "출구", "환기구", "통풍구", "비상구", "가구", "도구", "연구", "욕구"]
DONG_BLACKLIST = ["운동", "이동", "활동", "자동", "공동", "행동", "변동", "진동", "노동", "충동"]
SI_BLACKLIST = ["사용시", "필요시", "이용시", "방문시", "구매시", "신청시", "설치시", "청소시", "발생시", "작동시", "외출시", "취침시", "가동시", "운전시", "주행시", "충전시", "교체시", "수리시", "점검시", "고장시", "정전시", "누수시", "결제시", "주문시", "배송시", "예약시", "상담시", "문의시", "계약시", "입주시", "이사시", "폐기시", "철거시", "건조시"]


def _strip_modifier_prefix(w):
    for p in MODIFIER_PREFIXES:
        if len(w) > len(p) and w.startswith(p):
            return w[len(p):]
    return w


def _ends_with_service(w):
    return any(w.endswith(s) for s in SERVICE_SUFFIXES)


def _is_region_candidate(w):
    return len(w) >= 3 and (w.endswith("동") or w.endswith("구"))


def extract_keyword(title: str) -> str:
    # 제목 폴백 — 지역(시>구>동>첫단어) + 지역 뒤 첫 '서비스 접미어' 단어(더 큰/앞선 카테고리).
    t = html.unescape(title or "").strip()
    t = re.sub(r"<[^>]+>", "", t)
    t = re.sub(r"[\[\]\(\)·,.!?~\-_/|]", " ", t)
    words = [w for w in t.split() if w and w not in TAILS]
    if not words:
        return t[:12]

    # 지역: 높은 행정단위 우선 ~시 > ~구 > ~동 > 첫 단어.
    region_idx = next((i for i, w in enumerate(words) if len(w) >= 3 and w.endswith("시") and w not in SI_BLACKLIST), None)
    if region_idx is None:
        region_idx = next((i for i, w in enumerate(words) if len(w) >= 3 and w.endswith("구") and w not in GU_BLACKLIST), None)
    if region_idx is None:
        region_idx = next((i for i, w in enumerate(words) if len(w) >= 3 and w.endswith("동") and w not in DONG_BLACKLIST), None)
    if region_idx is None:
        region_idx = 0
    region = words[region_idx]

    # 지역 토큰 자체가 서비스로 끝나면(지역+서비스 한 단어) 그대로.
    if _ends_with_service(region):
        return region

    stripped = [_strip_modifier_prefix(w) for w in words]
    # 서비스: 지역 '뒤'의 첫 서비스-접미어 단어, 없으면 지역 '앞'에서.
    svc_end = None
    for i in range(region_idx + 1, len(words)):
        sw = stripped[i]
        if not sw or sw in MODIFIER_WORDS:
            continue
        if _ends_with_service(sw):
            svc_end = i
            break
    if svc_end is None:
        for i in range(0, region_idx):
            sw = stripped[i]
            if not sw or sw in MODIFIER_WORDS:
                continue
            if _ends_with_service(sw):
                svc_end = i
                break

    service = ""
    if svc_end is not None:
        parts = []
        k = svc_end
        while k >= 0:
            if k == region_idx:
                break
            sw = stripped[k]
            if not sw or sw in MODIFIER_WORDS:
                break
            if k != svc_end and _is_region_candidate(sw):
                break
            parts.insert(0, sw)
            if k != svc_end and _ends_with_service(sw):
                break
            if len(parts) >= 2:  # 복합어 최대 2단어
                break
            k -= 1
        service = "".join(parts)
    else:
        for i in range(len(words)):
            if i == region_idx:
                continue
            sw = stripped[i]
            if not sw or sw in MODIFIER_WORDS or _is_region_candidate(sw):
                continue
            service = sw
            break

    if not service or region == service:
        return region
    return f"{region} {service}"


def _longest_common_suffix(arr):
    if not arr:
        return ""
    suffix = arr[0]
    for s in arr[1:]:
        i = 0
        while i < len(suffix) and i < len(s) and suffix[len(suffix) - 1 - i] == s[len(s) - 1 - i]:
            i += 1
        suffix = suffix[len(suffix) - i:]
        if not suffix:
            break
    return suffix


def pick_main_hashtag_keyword(tags):
    # 해시태그에서 메인키워드(지역+서비스). 예: [춘천유리교체,춘천아파트유리교체,유리교체] → '춘천 유리교체'
    clean = []
    for t in (tags or []):
        s = str(t or "").lstrip("#")
        s = re.sub(r"\s+", "", s).strip()
        if s:
            clean.append(s)
    if not clean:
        return ""
    uniq = list(dict.fromkeys(clean))
    if len(uniq) == 1:
        return uniq[0]
    service = _longest_common_suffix(uniq)
    if service and len(service) >= 2:
        best = ""
        for t in uniq:
            if t.endswith(service) and len(t) > len(service) and (not best or len(t) < len(best)):
                best = t
        if best:
            region = best[: len(best) - len(service)]
            return f"{region} {service}" if region else service
    return min(uniq, key=len)


def derive_keyword(title, tags):
    # 해시태그가 '지역+서비스'로 분리되면(공백 포함) 우선, 아니면 제목에서 추출.
    from_tags = pick_main_hashtag_keyword(tags)
    if from_tags and " " in from_tags:
        return from_tags
    return extract_keyword(title)


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
        # 네이버 RSS <tag> = 글 하단 해시태그(쉼표 구분). feedparser 가 노출 안 하면 빈 리스트(제목 폴백).
        tag_raw = entry.get("tag") or entry.get("tags") or ""
        if isinstance(tag_raw, list):
            tag_raw = ",".join(getattr(x, "term", None) or (x.get("term") if isinstance(x, dict) else str(x)) for x in tag_raw)
        tags = [t.strip() for t in html.unescape(str(tag_raw)).split(",") if t.strip()]
        posts.append({"url": link, "title": html.unescape(entry.get("title", "")), "published_date": pub, "tags": tags})
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


def unwrap_url(raw: str) -> str:
    """검색 리다이렉트 래퍼(u/url/cru=)를 풀어 실제 URL 반환. 임의 도메인용(_real_blog_url 과 달리 blog 한정 아님)."""
    if not raw:
        return ""
    m = _U_PARAM.search(raw)
    return unquote(m.group(1)) if m else raw


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


# ── 공용: entry.bootstrap JSON 파싱 도우미 ───────────────
# 네이버 m.search 는 결과를 script 내 entry.bootstrap({...JSON}) 으로 클라이언트 렌더한다.
# 각 JSON 블록 = 한 모듈/글. meta.area 로 섹션을 구분하고 clickLog...r 이 화면 절대순위.
# 실측 검증(dumps/): 석남동 ti=3·bl=순위밖, 인천석남동 ti=1.
_BLOG_RE = re.compile(r"blog\.naver\.com/([^/?#\"\\]+)")


def _block_min_r(node):
    """블록 안 clickLog(content/title/image).r 중 최솟값(=그 모듈의 화면 순위)."""
    rs = []

    def w(o):
        if isinstance(o, dict):
            cl = o.get("clickLog")
            if isinstance(cl, dict):
                for key in ("content", "title", "image"):
                    ct = cl.get(key)
                    if isinstance(ct, dict) and isinstance(ct.get("r"), int):
                        rs.append(ct["r"])
            for v in o.values():
                w(v)
        elif isinstance(o, list):
            for x in o:
                w(x)

    w(node)
    return min(rs) if rs else 999


def _iter_blog_posts(node):
    """블록 트리에서 (r, blog_id, log_no) 수집(contentHref 의 blog.naver.com 글)."""
    out = []

    def walk(o):
        if isinstance(o, dict):
            ch = o.get("contentHref", "")
            if isinstance(ch, str) and "blog.naver.com" in ch and "ader.naver.com" not in ch:
                cl = o.get("clickLog") or {}
                cont = cl.get("content") if isinstance(cl, dict) else None
                r = cont.get("r") if isinstance(cont, dict) else None
                m = re.search(r"blog\.naver\.com/([^/?#]+)/?(\d+)?", ch)
                if m:
                    out.append((r if r is not None else 999, m.group(1), m.group(2)))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for x in o:
                walk(x)

    walk(node)
    return out


_EXT_HOST_RE = re.compile(r"https?://[a-z0-9.-]+\.[a-z]{2,}", re.I)


def _has_external_site(raw):
    """외부(비네이버) 사이트 링크 존재 여부 — 웹문서/사이트 항목 판별."""
    for u in _EXT_HOST_RE.findall(raw):
        if not re.search(r"naver\.com|pstatic\.net|nstatic\.net|w3\.org", u, re.I):
            return True
    return False


# ── 통합탭(ti): 인기글(urB_coR) 섹션, '당근·광고만 제외' 후 사이트+카페+블로그 전부 r순 카운트 ──
# 화면 실측 일치(석남동=3, 인천연희동=5). 파싱/fetch 분리 — 덤프로 오프라인 회귀테스트 가능.
def _rank_in_popular(html_text, blog_id, log_no=""):
    """통합검색 HTML → (rank, status). urB_coR 에서 당근/광고만 빼고 사이트/카페/블로그 r순."""
    blocks = extract_bootstrap_json(html_text)
    if not blocks:
        return OUT_OF_RANK, "fail"      # JSON 없음 = 차단/구조변경 → 권외와 구분

    items = []   # (r, id)  — 당근/광고 제외한 인기글 섹션 항목 전부
    for b in blocks:
        try:
            j = json.loads(b)
        except Exception:
            continue
        if (j.get("meta") or {}).get("area", "") != "urB_coR":   # 인기글(상단) 섹션만
            continue
        r = _block_min_r(j)
        mb = _BLOG_RE.search(b)
        if mb:
            items.append((r, mb.group(1)))          # 블로그(우리 포함)
        elif "daangn" in b or "ader.naver.com" in b:
            continue                                # 당근·광고 제외
        elif "cafe.naver.com" in b:
            items.append((r, "(cafe)"))             # 카페
        elif _has_external_site(b):
            items.append((r, "(site)"))             # 외부 웹문서 사이트
        # 그 외(식별 불가) 제외
    items.sort(key=lambda x: x[0])
    for idx, (r, pid) in enumerate(items, start=1):
        if pid == blog_id:
            return idx, "ok"
    return OUT_OF_RANK, "out"


def measure_integrated_popular(keyword, blog_id, log_no=""):
    url = f"https://m.search.naver.com/search.naver?query={quote(keyword)}"
    try:
        code, html_text = _fetch_html(url)
        if code != 200:
            return OUT_OF_RANK, "fail"
    except Exception as exc:
        print(f"    [통합탭 실패] {keyword}: {exc}")
        return OUT_OF_RANK, "fail"
    return _rank_in_popular(html_text, blog_id, log_no)


# ── 블로그탭(bl): 진짜 블로그탭(ssc=tab.m_blog.all) HTML 파싱 ──
# 봇 GET 으로 where=m_blog 은 통합검색을 반환하지만 ssc=tab.m_blog.all 은 진짜 블로그탭(meta.ssc=tab.m_blog.*)을 준다.
# 공식 blog.json API 는 화면 블로그탭과 순서가 달라(석남동: API #4 vs 화면 순위밖) 쓰지 않는다.
def _rank_in_blogtab(html_text, blog_id, log_no=""):
    """진짜 블로그탭 HTML → (rank, status). blog 블록의 글 r순."""
    blocks = extract_bootstrap_json(html_text)
    if not blocks:
        return OUT_OF_RANK, "fail"

    posts, seen = [], set()
    for b in blocks:
        try:
            j = json.loads(b)
        except Exception:
            continue
        if "blog" not in (j.get("refs") or {}).get("blockId", ""):
            continue
        for r, pid, plog in _iter_blog_posts(j):
            if (pid, plog) not in seen:
                seen.add((pid, plog))
                posts.append((r, pid, plog))

    posts.sort(key=lambda x: x[0])
    for idx, (r, pid, plog) in enumerate(posts, start=1):
        if (log_no and plog == log_no) or (not log_no and pid == blog_id):
            return idx, "ok"
    return OUT_OF_RANK, "out"


def measure_blogtab_real(keyword, blog_id, log_no=""):
    url = f"https://m.search.naver.com/search.naver?ssc=tab.m_blog.all&query={quote(keyword)}"
    try:
        code, html_text = _fetch_html(url)
        if code != 200:
            return OUT_OF_RANK, "fail"
    except Exception as exc:
        print(f"    [블로그탭 실패] {keyword}: {exc}")
        return OUT_OF_RANK, "fail"
    return _rank_in_blogtab(html_text, blog_id, log_no)


def measure_rank(keyword, blog_id, post_url):
    log_no = extract_log_no(post_url)

    # 블로그탭(bl): 진짜 블로그탭 HTML 파싱
    bl, bl_status = measure_blogtab_real(keyword, blog_id, log_no)
    time.sleep(REQUEST_DELAY)

    # 통합탭(ti): 인기글 섹션 화면순위
    ti, ti_status = measure_integrated_popular(keyword, blog_id, log_no)
    time.sleep(REQUEST_DELAY)

    return ti, bl, ti_status, bl_status


# ── 디버그: 키워드 하나로 실제 순위 검증 ────────────────
def debug_keyword(keyword, blog_id, post_url="", website_host=""):
    log_no = extract_log_no(post_url)
    print(f"[디버그] 키워드: {keyword} / 블로그ID: {blog_id} / logNo: {log_no or '(없음)'}")
    bl, bl_status = measure_blogtab_real(keyword, blog_id, log_no)
    ti, ti_status = measure_integrated_popular(keyword, blog_id, log_no)
    ti_disp = ti if ti_status == "ok" else ti_status
    bl_disp = bl if bl_status == "ok" else bl_status
    print(f"\n결과 → 통합탭(인기글): {ti_disp} / 블로그탭: {bl_disp}")
    if website_host:
        we, status = measure_web_rank(keyword, website_host)
        print(f"웹사이트({norm_host(website_host)}): {we if status == 'ok' else status}")


# ── 진단 덤프 (셀렉터/구조 가정 검증용) ─────────────────
# 목적: 파서를 짜기 전에 "봇 GET HTML에 entry.bootstrap JSON이 있는가 / '인기글'·'웹사이트' 섹션
# 헤더와 앵커 구조 / 광고 도메인"을 사용자 PC(네이버 접속 가능)에서 한 번 떠서 확인한다.
# Claude 개발환경은 네이버 접속이 막혀 라이브로 확인 불가 → 이 덤프 출력/파일이 셀렉터 확정의 근거.
SECTION_HINTS = ["인기글", "웹사이트", "웹문서", "플레이스", "지도", "블로그", "카페", "파워링크", "비즈사이트", "광고", "VIEW", "인플루언서"]
DUMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dumps")


def extract_bootstrap_json(html_text):
    """script 안의 ...bootstrap({...}) 호출에서 JSON 인자를 brace-counting 으로 추출(문자열/이스케이프 인지)."""
    results = []
    marker = "bootstrap("
    idx = 0
    while True:
        p = html_text.find(marker, idx)
        if p == -1:
            break
        b = html_text.find("{", p)
        idx = p + len(marker)
        if b == -1:
            continue
        depth, i, in_str, esc = 0, b, False, False
        while i < len(html_text):
            c = html_text[i]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            elif c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    results.append(html_text[b:i + 1])
                    break
            i += 1
    return results


def _fetch_html(url):
    r = requests.get(url, headers={"User-Agent": UA}, timeout=20)
    return r.status_code, r.text


def _dump_one(label, keyword, url, html_text, blog_id, website_host):
    soup = BeautifulSoup(html_text, "html.parser")
    print(f"\n========== [{label}] {url}")
    print(f"  HTML 길이: {len(html_text):,}")

    boots = extract_bootstrap_json(html_text)
    if boots:
        print(f"  entry.bootstrap JSON: 발견 {len(boots)}개 (최대 길이 {max(len(b) for b in boots):,})")
    else:
        print("  entry.bootstrap JSON: ❌ 없음 (봇 GET 이 축약 HTML 일 수 있음 → 브라우저 저장 HTML 필요할 수도)")

    # meta.ssc: 어떤 탭인지(tab.m.all=통합검색, tab.m_blog.*=진짜 블로그탭). 블로그탭 URL 찾기용.
    ssc = ""
    for bb in (boots or []):
        try:
            s = (json.loads(bb).get("meta") or {}).get("ssc")
            if s:
                ssc = s
                break
        except Exception:
            pass
    flag = " ← 진짜 블로그탭!" if ("m_blog" in ssc or ssc.startswith("tab.blog")) else ""
    print(f"  meta.ssc(영역): {ssc or '(없음)'}{flag}")

    present = [h for h in SECTION_HINTS if h in html_text]
    print(f"  섹션 헤더 후보 텍스트 존재: {', '.join(present) if present else '(없음)'}")

    anchors = soup.select("a[href], a[data-cr-url], a[data-url], a[data-lnk]")
    rows, seen = [], set()
    for a in anchors:
        raw = a.get("data-cr-url") or a.get("data-url") or a.get("data-lnk") or a.get("href") or ""
        real = unwrap_url(raw)
        host = norm_host(real)
        if not host or host in ("m.search.naver.com", "search.naver.com"):
            continue
        key = (host, real[:60])
        if key in seen:
            continue
        seen.add(key)
        kind = "AD" if host == "ad.search.naver.com" else (
            "BLOG" if "blog.naver.com" in real else (
                "CAFE" if "cafe.naver.com" in real else "WEB"))
        mark = ""
        if blog_id and f"blog.naver.com/{blog_id}" in real:
            mark = "  <== 우리 블로그"
        if website_host and host == norm_host(website_host):
            mark = "  <== 우리 웹사이트"
        title = re.sub(r"\s+", " ", a.get_text(" ", strip=True))[:40]
        rows.append((len(rows) + 1, kind, host, title, mark))

    print(f"  앵커(중복 제거, 등장 순서) {len(rows)}개 — 상위 50:")
    for n, kind, host, title, mark in rows[:50]:
        print(f"   {n:>2}. [{kind:4}] {host:30} {title}{mark}")

    os.makedirs(DUMP_DIR, exist_ok=True)
    safe = re.sub(r"[^0-9A-Za-z가-힣]+", "_", f"{label}_{keyword}_{TODAY}")
    path = os.path.join(DUMP_DIR, f"{safe}.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html_text)
    print(f"  원문 저장: {path}")


def dump_keyword(keyword, blog_id="", website_host=""):
    print(f"[덤프] 키워드: {keyword} / 블로그ID: {blog_id or '(없음)'} / 웹사이트: {website_host or '(없음)'}")
    q = quote(keyword)
    targets = [
        ("통합탭", f"https://m.search.naver.com/search.naver?query={q}"),
        # 진짜 블로그탭 URL 후보 — meta.ssc 로 어느 게 tab.m_blog 를 주는지 확인.
        ("블로그탭A", f"https://m.search.naver.com/search.naver?where=m_blog&query={q}"),
        ("블로그탭B", f"https://m.search.naver.com/search.naver?ssc=tab.m_blog.all&query={q}"),
    ]
    for label, url in targets:
        try:
            status, html_text = _fetch_html(url)
            if status != 200:
                print(f"\n[{label}] HTTP {status} — 실패")
                continue
            _dump_one(label, keyword, url, html_text, blog_id, website_host)
        except Exception as exc:
            print(f"\n[{label}] 실패: {exc}")
        time.sleep(REQUEST_DELAY)

    # 블로그탭: 공식 API 순서 vs 화면 순서 대조용(검증 후 API 1차 유지 가능)
    if USE_API and blog_id:
        print("\n========== [블로그탭 공식 API(blog.json) 상위 — 화면과 순서 대조용]")
        try:
            items = naver_blog_search(keyword, display=max(30, MAX_RANK_SCAN))
            for i, it in enumerate(items[:MAX_RANK_SCAN], start=1):
                lid, _ = parse_blog_url(it.get("link", ""))
                bid, _ = parse_blog_url(it.get("bloggerlink", ""))
                title = re.sub(r"<[^>]+>", "", it.get("title", ""))[:40]
                mark = "  <== 우리 블로그" if (lid == blog_id or bid == blog_id) else ""
                print(f"   {i:>2}. {(lid or bid):20} {title}{mark}")
        except Exception as exc:
            print(f"   [API 실패] {exc}")
    print("\n[안내] 위 출력 + dumps/*.html 을 공유해 주시고, 화면에서 본 실제 순위(통합탭 인기글/블로그탭, 광고 개수 포함)를 알려주시면 셀렉터를 확정합니다.")


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
                "keyword": derive_keyword(p["title"], p.get("tags") or []), "published_date": p["published_date"],
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
        ti, bl, ti_status, bl_status = measure_rank(keyword, blog_id, post.get("post_url", ""))
        records = [r for r in (post.get("measurements") or []) if r.get("date") != TODAY]
        # *_status 는 추가 필드(프론트는 무시해도 무방). fail=구조 파싱 실패, out=권외.
        records.append({"date": TODAY, "ti": ti, "bl": bl, "ti_status": ti_status, "bl_status": bl_status})
        sb_patch("blog_posts", {"id": f"eq.{post['id']}"}, {"measurements": records})
        measured += 1
        print(f"    측정 [{acc['name']}] {keyword}: 통합 {ti}({ti_status}) / 블로그 {bl}({bl_status})")

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

    # ── 대표키워드(사용자 지정) 순위 측정 ──
    # 글 단위(자동키워드)와 별개로, blog_keywords 의 (블로그×키워드)마다 measure_rank 로 ti/bl 측정.
    # log_no 없이(post_url='') 호출 → blog_id 매칭 = "그 블로그가 이 키워드로 몇 위".
    kw_measured = 0
    kw_rows = sb_get("blog_keywords", {"select": "*"})
    kw_by_acc = {}
    for row in kw_rows:
        kw_by_acc.setdefault(row["blog_account_id"], []).append(row)
    for acc in accounts:
        blog_id = acc.get("blog_id") or parse_blog_url(acc.get("blog_url", ""))[0] or ""
        if not blog_id:
            continue
        for row in kw_by_acc.get(acc["id"], [])[:MAX_KEYWORDS_PER_ACCOUNT]:
            kw = (row.get("keyword") or "").strip()
            if not kw:
                continue
            ti, bl, ti_status, bl_status = measure_rank(kw, blog_id, "")
            recs = [r for r in (row.get("measurements") or []) if r.get("date") != TODAY]
            recs.append({"date": TODAY, "ti": ti, "bl": bl, "ti_status": ti_status, "bl_status": bl_status})
            sb_patch("blog_keywords", {"id": f"eq.{row['id']}"}, {"measurements": recs})
            kw_measured += 1
            print(f"    키워드 [{acc['name']}] {kw}: 통합 {ti}({ti_status}) / 블로그 {bl}({bl_status})")

    print(f"=== 완료: 글 {measured}건 / 웹사이트 {web_measured}건 / 대표키워드 {kw_measured}건 측정 ===")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] in ("--debug", "--dump"):
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
            print('사용법: python blog_rank_crawler.py --dump "키워드" [--blog-id 아이디] [--website-host 도메인]')
            print('       python blog_rank_crawler.py --debug "키워드" --blog-id 아이디 [--post-url 글URL] [--website-host 도메인]')
            sys.exit(1)
        if args[0] == "--dump":
            dump_keyword(kw, blog_id, website_host)
        else:
            debug_keyword(kw, blog_id, post_url, website_host)
    else:
        run()
