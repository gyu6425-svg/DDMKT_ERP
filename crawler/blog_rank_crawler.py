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
import random
import re
import sys
import time
import html
import json
import datetime
from urllib.parse import quote, unquote, urlparse

import requests

# Windows 백신/방화벽이 TLS를 가로채(자체 루트 CA 주입) certifi 검증이 실패하는 환경 대응.
# OS(윈도) 신뢰 저장소를 그대로 쓰게 해 SSL CERTIFICATE_VERIFY_FAILED 를 막는다. 없으면 무시.
try:
    import truststore
    truststore.inject_into_ssl()
except Exception:
    pass

# 작업 스케줄러로 stdout 이 파일/파이프로 갈 때 인코딩이 cp949 가 되어, 이모지·일부 한글(자모 등)에서
# UnicodeEncodeError 가 나면 '측정 도중 전체 크래시'(→ 뒤쪽 블로그 미측정)로 이어진다. UTF-8 로 강제.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

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
REQUEST_DELAY = float(os.environ.get("CRAWL_DELAY", "2.0"))  # 검색 요청 사이 간격(초). 차단 회피 위해 2초 기본. env CRAWL_DELAY 로 조절.
BLOCK_REST_EVERY = int(os.environ.get("CRAWL_REST_EVERY", "8"))   # N개 블로그마다 긴 휴식(누적 레이트리밋 예방)
BLOCK_REST_SEC = float(os.environ.get("CRAWL_REST_SEC", "25"))    # 그 휴식 길이(초, 지터 포함)
MAX_POSTS_PER_BLOG = 10    # 블로그당 RSS 최신 글 수(최신 위주 — 이 글들만 측정, 옛 글 제외)


def _pause(base=None):
    """요청 간격 + 무작위 지터. 일정한 주기는 봇으로 탐지되기 쉬우므로 매번 살짝 흔든다(차단 예방)."""
    b = REQUEST_DELAY if base is None else base
    time.sleep(b + random.uniform(0, b * 0.6))
OLDEST_DATE = "2025-01-01"  # 이 날짜 이전(너무 옛날) 글은 추적 제외 — 최신 1~2년만 추적
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
MODIFIER_WORDS = ["아파트", "주택", "빌라", "상가", "사무실", "사무용", "사무", "오피스텔", "오피스", "빌딩", "신축", "구축", "단독주택", "다세대", "원룸", "투룸", "욕실", "화장실", "주방", "베란다", "발코니", "지하", "외벽", "내벽", "공장", "매장", "학원"]
MODIFIER_PREFIXES = ["스탠드형", "벽걸이형", "스탠드", "벽걸이", "천장형", "시스템", "가정용", "업소용", "이동식"]
SERVICE_SUFFIXES = ["청소", "교체", "탐지", "시공", "수리", "설치", "점검", "코팅", "철거", "방수", "줄눈", "인테리어", "제거", "도배", "장판", "보수", "복원", "리모델링", "세척", "폐기물", "폐기", "처리", "이전", "공사", "막힘", "뚫기", "간판"]
GU_BLACKLIST = ["배수구", "입구", "출구", "환기구", "통풍구", "비상구", "가구", "도구", "연구", "욕구"]
DONG_BLACKLIST = ["운동", "이동", "활동", "자동", "공동", "행동", "변동", "진동", "노동", "충동"]
SI_BLACKLIST = ["사용시", "필요시", "이용시", "방문시", "구매시", "신청시", "설치시", "청소시", "발생시", "작동시", "외출시", "취침시", "가동시", "운전시", "주행시", "충전시", "교체시", "수리시", "점검시", "고장시", "정전시", "누수시", "결제시", "주문시", "배송시", "예약시", "상담시", "문의시", "계약시", "입주시", "이사시", "폐기시", "철거시", "건조시"]
LEAD_STOPWORDS = ["여름", "겨울", "봄", "가을", "초여름", "한여름", "늦여름", "초겨울", "한겨울", "장마", "장마철", "무더위", "무더운", "환절기", "요즘", "이번", "올해", "작년", "내년", "드디어", "오늘", "어제", "내일", "최근", "정말", "진짜", "바로", "드뎌", "이제", "벌써", "우리집", "인기", "업체", "전문", "비오는날"]
COLLOQUIAL_EXCLUDE = ["구리", "광명"]


# 전국 지역 사전. 동기화 주의: functions/lib/crawlLib.mjs 의 동일 데이터와 1:1 유지.
REGION_METRO = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종"]
REGION_NEWTOWNS = ["위례", "판교", "광교", "동탄", "별내", "다산", "미사", "운정", "청라", "영종", "송도", "마곡", "배곧", "옥정", "고덕", "호매실", "삼송", "원흥", "지축", "향동", "덕은", "갈매", "평촌", "산본", "중동", "일산", "분당", "정자", "서현", "신항", "한강신도시", "위례신도시", "다산신도시", "미사강변"]
REGION_SI = ["수원시", "성남시", "고양시", "용인시", "부천시", "안산시", "안양시", "남양주시", "화성시", "평택시", "의정부시", "시흥시", "파주시", "김포시", "광명시", "광주시", "군포시", "오산시", "이천시", "양주시", "안성시", "구리시", "포천시", "의왕시", "하남시", "여주시", "동두천시", "과천시", "춘천시", "원주시", "강릉시", "동해시", "태백시", "속초시", "삼척시", "청주시", "충주시", "제천시", "천안시", "공주시", "보령시", "아산시", "서산시", "논산시", "계룡시", "당진시", "전주시", "군산시", "익산시", "정읍시", "남원시", "김제시", "목포시", "여수시", "순천시", "나주시", "광양시", "포항시", "경주시", "김천시", "안동시", "구미시", "영주시", "영천시", "상주시", "문경시", "경산시", "창원시", "진주시", "통영시", "사천시", "김해시", "밀양시", "거제시", "양산시", "제주시", "서귀포시"]
REGION_GUN = ["양평군", "가평군", "연천군", "홍천군", "횡성군", "영월군", "평창군", "정선군", "철원군", "화천군", "양구군", "인제군", "고성군", "양양군", "보은군", "옥천군", "영동군", "증평군", "진천군", "괴산군", "음성군", "단양군", "금산군", "부여군", "서천군", "청양군", "홍성군", "예산군", "태안군", "완주군", "진안군", "무주군", "장수군", "임실군", "순창군", "고창군", "부안군", "담양군", "곡성군", "구례군", "고흥군", "보성군", "화순군", "장흥군", "강진군", "해남군", "영암군", "무안군", "함평군", "영광군", "장성군", "완도군", "진도군", "신안군", "의성군", "청송군", "영양군", "영덕군", "청도군", "고령군", "성주군", "칠곡군", "예천군", "봉화군", "울진군", "울릉군", "의령군", "함안군", "창녕군", "남해군", "하동군", "산청군", "함양군", "거창군", "합천군", "기장군", "달성군", "군위군", "강화군", "옹진군", "울주군"]
REGION_GU = ["종로구", "용산구", "성동구", "광진구", "동대문구", "중랑구", "성북구", "강북구", "도봉구", "노원구", "은평구", "서대문구", "마포구", "양천구", "강서구", "구로구", "금천구", "영등포구", "동작구", "관악구", "서초구", "강남구", "송파구", "강동구", "영도구", "부산진구", "동래구", "해운대구", "사하구", "금정구", "연제구", "수영구", "사상구", "수성구", "달서구", "미추홀구", "연수구", "남동구", "부평구", "계양구", "광산구", "유성구", "대덕구", "장안구", "권선구", "팔달구", "영통구", "수정구", "중원구", "분당구", "만안구", "동안구", "원미구", "소사구", "오정구", "덕양구", "일산동구", "일산서구", "처인구", "기흥구", "수지구", "상록구", "단원구", "상당구", "서원구", "흥덕구", "청원구", "동남구", "서북구", "완산구", "덕진구", "의창구", "성산구", "마산합포구", "마산회원구", "진해구"]


def _build_region_set():
    s = set(REGION_METRO + REGION_NEWTOWNS)
    for arr, suf in [(REGION_SI, "시"), (REGION_GUN, "군"), (REGION_GU, "구")]:
        for full in arr:
            if full.endswith(suf) and len(full) - 1 >= 2 and full[:-1] not in COLLOQUIAL_EXCLUDE:
                s.add(full[:-1])
    return s


REGION_SET = _build_region_set()


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
        # 접미어 없는 지역명 사전 매칭(위례·송파·진해·춘천 등). '여름'은 사전에 없어 안 잡힘.
        region_idx = next((i for i, w in enumerate(words) if w in REGION_SET), None)
    if region_idx is None:
        # 알려진 지역명이 없으면 '서비스 단어 바로 앞' 단어를 지역으로(설명어로 시작하는 제목 대응:
        # '에어컨 관리…용원 에어컨청소'→용원, '냄새…장유 에어컨청소'→장유). 수식어(스탠드/천장형…) 건너뜀.
        svc_idx = next(
            (i for i, w in enumerate(words)
             if _strip_modifier_prefix(w) and _strip_modifier_prefix(w) not in MODIFIER_WORDS
             and _ends_with_service(_strip_modifier_prefix(w))),
            None,
        )
        if svc_idx is not None and svc_idx > 0:
            for i in range(svc_idx - 1, -1, -1):
                sw = _strip_modifier_prefix(words[i])
                if (not sw or words[i] in MODIFIER_WORDS or words[i] in MODIFIER_PREFIXES
                        or words[i] in LEAD_STOPWORDS or _ends_with_service(sw)):
                    continue
                region_idx = i
                break
    if region_idx is None:
        # 그래도 없으면 첫 '비설명·비수식' 단어를 지역으로(계절·설명어 '여름' 등 건너뜀).
        region_idx = next((i for i, w in enumerate(words) if w not in LEAD_STOPWORDS and w not in MODIFIER_WORDS), None)
    if region_idx is None:
        region_idx = 0
    region = words[region_idx]

    # 상위 지역(광역시)이 지역 앞에 별도 토큰으로 있으면 함께 표기(사용자 확정: '인천 논현동 간판').
    metro_prefix = ""
    for i in range(region_idx):
        if words[i] in REGION_METRO and words[i] != region:
            metro_prefix = words[i]
            break

    def with_metro(kw):
        return f"{metro_prefix} {kw}" if metro_prefix and not kw.startswith(metro_prefix) else kw

    # 지역 토큰 자체가 서비스로 끝나면(지역+서비스 한 단어) 그대로.
    if _ends_with_service(region):
        return with_metro(region)

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
        sw = stripped[svc_end]
        matched = next((s for s in SERVICE_SUFFIXES if sw.endswith(s)), "")
        if sw != matched:
            # 이미 완전한 서비스 복합어(책장철거/집기폐기/이사폐기물/유리교체) → 그대로.
            service = sw
        else:
            # 단어가 접미어 자체(청소/교체) → 바로 앞 목적어 1개만 결합(에어컨 청소→에어컨청소).
            prev = svc_end - 1
            pw = stripped[prev] if prev >= 0 else ""
            if (
                pw
                and prev != region_idx
                and pw not in MODIFIER_WORDS
                and not _is_region_candidate(pw)
                and pw not in LEAD_STOPWORDS
                and not _ends_with_service(pw)
            ):
                service = pw + sw
            else:
                service = sw
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
        return with_metro(region)
    return with_metro(f"{region} {service}")


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


def _strip_trailing_modifier(s):
    """지역부 끝에 붙은 수식어(스탠드/천장형/사무실 등)를 반복 제거 — '진해스탠드'→'진해'."""
    r = s
    changed = True
    while changed and r:
        changed = False
        for m in MODIFIER_PREFIXES + MODIFIER_WORDS:
            # >= : 잔여 전체가 수식어면(지역 없음) 끝까지 떼어 ''로 만들고 제목 폴백 유도.
            if len(r) >= len(m) and r.endswith(m):
                r = r[: len(r) - len(m)]
                changed = True
                break
    return r


_HASHTAG_RE = re.compile(r'class="__se-hash-tag">#([^<]+)</span>')
_GSTAG_RE = re.compile(r'gsTagName\s*=\s*"([^"]*)"')


def extract_hashtags_from_html(html_text):
    """본문 하단 해시태그 추출. gsTagName(쉼표, 구·신 공통) + __se-hash-tag(신 에디터) 병합."""
    s = html_text or ""
    out = []

    def push(t):
        v = re.sub(r"\s+", "", str(t)).lstrip("#").strip()
        if v and v not in out:
            out.append(v)

    g = _GSTAG_RE.search(s)
    if g and g.group(1):
        for t in g.group(1).split(","):
            push(t)
    for t in _HASHTAG_RE.findall(s):
        push(t)
    return out


_REGION_BOUND_RE = re.compile(r"^(.{2,4}?[동구])(.+)$")


def _region_prefix(t):
    """글루 해시태그 앞부분이 알려진 지역명이면 그 prefix(최장), 없으면 ''. 천안식당창업→천안, 삼송동집기폐기→삼송동."""
    best = ""
    for r in REGION_SET:
        if len(t) > len(r) and t.startswith(r) and len(r) > len(best):
            best = r
    m = _REGION_BOUND_RE.match(t)  # 동/구로 끝나는 앞부분(사전에 없어도)
    if m and len(m.group(1)) >= 3 and len(m.group(1)) > len(best) \
            and m.group(1) not in GU_BLACKLIST and m.group(1) not in DONG_BLACKLIST:
        best = m.group(1)
    return best


def _has_region_or_service(t):
    return bool(_region_prefix(t)) or any(s in t for s in SERVICE_SUFFIXES)


def derive_keyword(title, tags):
    # '무조건 하단 해시태그' 우선(crawlLib.mjs deriveKeyword 와 1:1). 해시태그 그대로, 이상한 건 수동수정.
    clean = [re.sub(r"\s+", "", str(t or "").lstrip("#")).strip() for t in (tags or [])]
    clean = [t for t in clean if t]
    # 1) 복수 해시태그 공통 suffix → 지역+서비스
    multi = pick_main_hashtag_keyword(clean)
    if multi and " " in multi:
        sp = multi.index(" ")
        region = _strip_trailing_modifier(multi[:sp])
        if region:
            return f"{region}{multi[sp:]}"
    # 2) 글루 단일 + 제목 서비스로 지역 분리
    title_kw = extract_keyword(title)
    parts = title_kw.split(" ")
    title_service = parts[-1]
    if title_service and len(title_service) >= 2:
        for t in clean:
            if t.endswith(title_service) and len(t) > len(title_service):
                region = _strip_trailing_modifier(t[: len(t) - len(title_service)])
                if region:
                    return f"{region} {title_service}"
    # 3) 지역/서비스를 담은 해시태그면 그 해시태그를 메인키워드로(가장 짧은=핵심). 지역 있으면 분리.
    usable = [t for t in clean if _has_region_or_service(t)]
    if usable:
        main = min(usable, key=len)
        rp = _region_prefix(main)
        if rp:
            rest = _strip_modifier_prefix(main[len(rp):])
            return f"{rp} {rest}" if rest else rp
        return _strip_modifier_prefix(main)  # 지역 없는 서비스 키워드 그대로
    # 4) 제목 폴백
    return title_kw


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


# 글 본문 하단 해시태그(#…)를 모바일 글 HTML에서 가져온다. RSS <tag>는 주제태그 1개뿐인 경우가 많아
# '무조건 하단 해시태그' 요구를 충족하려면 본문을 봐야 함. 실패 시 빈 리스트(→ RSS태그/제목 폴백).
def fetch_post_hashtags(post_url):
    bid, lno = parse_blog_url(post_url)
    if not bid or not lno:
        return []
    try:
        code, h = _fetch_html(f"https://m.blog.naver.com/{bid}/{lno}")
        return extract_hashtags_from_html(h) if code == 200 else []
    except Exception:
        return []


# ── RSS 수집 ─────────────────────────────────────────────
def fetch_rss_posts(blog_id: str):
    parsed = feedparser.parse(f"https://rss.blog.naver.com/{blog_id}.xml")
    posts = []
    for entry in parsed.entries[:MAX_POSTS_PER_BLOG]:
        link = entry.get("link", "")
        pub = None
        if entry.get("published_parsed"):
            pub = datetime.date(*entry.published_parsed[:3]).isoformat()
        # 네이버 RSS <tag> = 주제태그(쉼표). feedparser 가 노출 안 하면 빈 리스트.
        tag_raw = entry.get("tag") or entry.get("tags") or ""
        if isinstance(tag_raw, list):
            tag_raw = ",".join(getattr(x, "term", None) or (x.get("term") if isinstance(x, dict) else str(x)) for x in tag_raw)
        rss_tags = [t.strip() for t in html.unescape(str(tag_raw)).split(",") if t.strip()]
        # RSS <tag>가 이미 '지역+서비스'면(band14371류) 그대로 — 불필요한 본문 fetch 생략(일일 부하↓).
        # 아니면(puleenbe 주제태그 1개 등) 본문 하단 해시태그를 직접 가져온다(무조건 해시태그).
        rss_kw = pick_main_hashtag_keyword(rss_tags)
        if rss_kw and " " in rss_kw:
            tags = rss_tags
        else:
            tags = fetch_post_hashtags(link) or rss_tags
            _pause()
        posts.append({"url": link, "title": html.unescape(entry.get("title", "")),
                      "published_date": pub, "tags": tags})
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
_BLOG_POST_RE = re.compile(r"blog\.naver\.com/([^/?#\"\\]+)/(\d{6,})")  # 글 단위 매칭용(blogId+logNo)


def _block_min_r(node):
    """블록 안 clickLog(content/title/image).r 중 최솟값(=그 모듈의 화면 순위)."""
    rs = []

    def w(o):
        if isinstance(o, dict):
            cl = o.get("clickLog")
            if isinstance(cl, dict):
                for key in ("content", "title", "image"):
                    ct = cl.get(key)
                    # r 은 화면순위(정수/실수). bool 은 int 하위형이라 명시 제외(JS typeof number 와 1:1).
                    v = ct.get("r") if isinstance(ct, dict) else None
                    if isinstance(v, (int, float)) and not isinstance(v, bool):
                        rs.append(v)
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


# 카드 '대표글' 판별용 — 제목/본문 네비링크만 보고, 관련글 묶음 하위는 배제한다.
#   2026-06-24 실측(칠곡 업소용가구 pjyysh): 카드 본문글은 5/15글(contentHref·titleHref)인데
#   같은 카드의 afterArticles(='이 블로그 다른 글') 안에 6/11글 링크가 먼저 등장 → 옛 코드가
#   raw 첫 링크(6/11글)를 잡아 6월글에 5위를 잘못 부여. 발행일 다른 글끼리 순위 전염되던 버그.
_PRIMARY_NAV_FIELDS = ("href", "titleHref", "contentHref")  # 카드 본문 이동 링크
_PRIMARY_EXCLUDE_KEYS = (
    "afterArticles", "clusters", "series", "relatedContents", "subItems",
)  # 관련글/클러스터 묶음 — 대표글 아님


def _primary_blog_posts(node):
    """블록에서 카드 '대표글' (blog_id, log_no) 목록. 관련글 묶음 하위는 제외."""
    out = []

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in _PRIMARY_EXCLUDE_KEYS:
                    continue                 # 관련글 묶음 하위는 통째로 건너뜀
                if isinstance(v, str):
                    if k in _PRIMARY_NAV_FIELDS:
                        m = _BLOG_POST_RE.search(v)
                        if m:
                            out.append((m.group(1), m.group(2)))
                else:
                    walk(v)
        elif isinstance(o, list):
            for x in o:
                walk(x)

    walk(node)
    return out


def _block_area(j):
    """블록 섹션 코드(meta.area 우선, 없으면 refs.blockId)."""
    a = (j.get("meta") or {}).get("area", "")
    if not a:
        a = (j.get("refs") or {}).get("blockId", "")
    return a or ""


def _is_web_area(area):
    """web* 섹션 = '웹사이트/문서' 탭. 통합탭(인기글) 순위와 별개 → 통합탭 카운트에서 제외.
    2026-06-24 실측(김포 경호업체): web_gen 카드(sks303040 문서)가 인기글 위에 잡혀 더맨시스템을
    2위로 밀어냄. 사용자 확인: 그 위치는 '웹사이트탭'이라 통합탭에서 빼고 존재 여부만 표기."""
    return area.lower().startswith("web")


def _node_min_r(d):
    """이 dict 자체의 clickLog(content/title/image).r 최솟값(=이 카드의 화면순위). 없으면 None."""
    cl = d.get("clickLog")
    if not isinstance(cl, dict):
        return None
    rs = []
    for k in ("content", "title", "image"):
        ct = cl.get(k)
        if isinstance(ct, dict):
            v = ct.get("r")
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                rs.append(v)
    return min(rs) if rs else None


def _node_primary(d):
    """이 dict 직속 네비링크(href/titleHref/contentHref)의 (blog_id, log_no)."""
    out = []
    for k in _PRIMARY_NAV_FIELDS:
        v = d.get(k)
        if isinstance(v, str):
            m = _BLOG_POST_RE.search(v)
            if m:
                out.append((m.group(1), m.group(2)))
    return out


def _ugb_cards(j):
    """ugB 블록(한 블록=여러 카드) → r별 카드 [(r, set((blog_id, log_no)))], r 오름차순.
    r 이 화면 순위(1부터). afterArticles 등 관련글 묶음은 제외. r=0(헤더)은 스킵."""
    bucket = {}

    def w(o):
        if isinstance(o, dict):
            r = _node_min_r(o)
            if r is not None and r != 0:
                bucket.setdefault(r, set()).update(_node_primary(o))
            for k, v in o.items():
                if k in _PRIMARY_EXCLUDE_KEYS:
                    continue
                w(v)
        elif isinstance(o, list):
            for x in o:
                w(x)

    w(j)
    return [(r, bucket[r]) for r in sorted(bucket)]


# ── 통합탭(ti): '그 블로그가 속한 섹션 안에서의 순위'(섹션마다 1부터 재시작) ──
# 2026-06-24: 사용자 확인 — 통합검색은 섹션(블록 area)이 여러 개고, 블로그 순위는 '자기 섹션 안'
#   기준이다. 예) 안산 푸르지오9차인테리어: 오늘의집/부동산으로 시작하는 urB_coR(=웹사이트/문서)
#   섹션이 위에 있고, design_do_ 는 그 아래 urB_boR(블로그) 섹션의 첫 카드 → 통합탭 1위.
#   (누적 카운트면 6위로 잘못 나옴.) 칠곡 pjyysh=5·석남동=4·김포 더맨=1 등 사용자 확인값과 일치.
#   섹션 = area 가 같은 연속 블록. area 가 바뀌면 순위 1부터 다시 센다.
#   web*(웹사이트/문서) 섹션·광고(ader)·비결과(r 없음) 블록은 제외. 매칭은 카드 '대표글'로만.
def _rank_in_popular(html_text, blog_id, log_no=""):
    """통합검색 HTML → (rank, status). 블로그가 속한 섹션 안에서의 순위(섹션마다 1부터)."""
    blocks = extract_bootstrap_json(html_text)
    if not blocks:
        return OUT_OF_RANK, "fail"      # JSON 없음 = 차단/구조변경 → 권외와 구분

    prev_area = None
    rank = 0
    for b in blocks:
        try:
            j = json.loads(b)
        except Exception:
            continue
        if "ader.naver.com" in b:            # 광고(ader) 제외
            continue
        area = _block_area(j)
        if _is_web_area(area):               # 웹사이트(문서)탭 섹션 제외 — 통합탭 순위 아님
            continue
        if _block_min_r(j) >= 999:           # 비-결과 블록(AI/이미지/연관검색어) 제외
            continue
        if area != prev_area:                # 새 섹션 → 순위 1부터 재시작
            rank = 0
            prev_area = area
        # ugB_*(한 블록=여러 카드, 예 ugB_bsR) 은 블록 안 카드를 r 순서로 한 칸씩 — 같은 블록의
        #   다른 카드(예 서천: sd44422 1위 … limebuffet 5위)에 순위가 1로 뭉개지지 않게.
        # urB_*(블록=카드 1개) 은 블록 등장 순서로 한 칸씩(블록 내부 r 무시 — 화면 위치와 1:1).
        # log_no 있으면 '그 글'만 매칭(통합탭도 글 단위). 없으면 블로그 단위 매칭.
        if area.startswith("ugB"):
            for r, prims in _ugb_cards(j):
                rank += 1
                for bid, lno in prims:
                    if (log_no and lno == log_no) or (not log_no and bid == blog_id):
                        return rank, "ok"
        else:
            rank += 1                        # 같은 섹션 안에서 보이는 카드 한 칸
            for bid, lno in _primary_blog_posts(j):
                if (log_no and lno == log_no) or (not log_no and bid == blog_id):
                    return rank, "ok"
    return OUT_OF_RANK, "out"


def _website_present(html_text, blog_id, log_no=""):
    """통합검색 HTML 의 '웹사이트(문서)탭'(web* 섹션)에 우리 글/블로그가 있으면 '있음', 없으면 '없음'.
    같은 통합탭 HTML 에서 추출(추가 요청 X). 차단/빈응답이면 'fail'."""
    blocks = extract_bootstrap_json(html_text)
    if not blocks:
        return "fail"
    for b in blocks:
        try:
            j = json.loads(b)
        except Exception:
            continue
        if "ader.naver.com" in b:
            continue
        if not _is_web_area(_block_area(j)):     # 웹사이트(문서) 섹션만 본다
            continue
        for bid, lno in _primary_blog_posts(j):
            if (log_no and lno == log_no) or (not log_no and bid == blog_id):
                return "있음"
    return "없음"


def measure_integrated_popular(keyword, blog_id, log_no=""):
    """통합탭 1회 조회 → (ti, ti_status, ws). ws = 웹사이트(문서)탭 존재 여부('있음'/'없음'/'fail')."""
    url = f"https://m.search.naver.com/search.naver?query={quote(keyword)}"
    try:
        code, html_text = _fetch_html(url)
        if code != 200:
            return OUT_OF_RANK, "fail", "fail"
    except Exception as exc:
        print(f"    [통합탭 실패] {keyword}: {exc}")
        return OUT_OF_RANK, "fail", "fail"
    ti, ti_status = _rank_in_popular(html_text, blog_id, log_no)
    ws = _website_present(html_text, blog_id, log_no)
    return ti, ti_status, ws


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

    # 블로그탭(bl): 진짜 블로그탭 HTML 파싱. fail(차단/빈응답)이면 잠깐 쉬고 1회 재시도(권외와 구분 위해).
    bl, bl_status = measure_blogtab_real(keyword, blog_id, log_no)
    if bl_status == "fail":
        _pause(REQUEST_DELAY * 2)
        bl, bl_status = measure_blogtab_real(keyword, blog_id, log_no)
    _pause()

    # 통합탭(ti)+웹사이트탭 존재(ws): 한 번 조회로 둘 다. 마찬가지로 fail 이면 1회 재시도.
    ti, ti_status, ws = measure_integrated_popular(keyword, blog_id, log_no)
    if ti_status == "fail":
        _pause(REQUEST_DELAY * 2)
        ti, ti_status, ws = measure_integrated_popular(keyword, blog_id, log_no)
    _pause()

    return ti, bl, ti_status, bl_status, ws


# ── 디버그: 키워드 하나로 실제 순위 검증 ────────────────
def debug_keyword(keyword, blog_id, post_url="", website_host=""):
    log_no = extract_log_no(post_url)
    print(f"[디버그] 키워드: {keyword} / 블로그ID: {blog_id} / logNo: {log_no or '(없음)'}")
    bl, bl_status = measure_blogtab_real(keyword, blog_id, log_no)
    ti, ti_status, ws = measure_integrated_popular(keyword, blog_id, log_no)
    ti_disp = ti if ti_status == "ok" else ti_status
    bl_disp = bl if bl_status == "ok" else bl_status
    print(f"\n결과 → 통합탭(인기글): {ti_disp} / 블로그탭: {bl_disp} / 웹사이트탭: {ws}")
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
        _pause()

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
def _process_blog(acc, kw_by_acc):
    """블로그 1개 전체 처리: 최신글 동기화 → '그 글들만' 측정(옛 글 제외) + 웹사이트 + 대표키워드.
    스레드 1개가 블로그 1개를 담당(병렬 모드) — 블로그 내부는 순차라 네이버 부하가 과하지 않음.
    반환 (글측정수, 웹측정수, 키워드측정수)."""
    name = acc.get("name", "?")
    blog_id = acc.get("blog_id") or parse_blog_url(acc.get("blog_url", ""))[0] or ""
    if not blog_id:
        return (0, 0, 0)
    pm = wm = km = 0

    # (A) RSS 최신 N글 동기화 → 그 글들만 측정. (sb_insert가 id/keyword_manual 포함 행을 돌려줌)
    try:
        rss = fetch_rss_posts(blog_id)
    except Exception as exc:
        print(f"  RSS 실패 {name}: {exc}")
        rss = []
    # 너무 옛날 글 제외(최신 1~2년만). published_date 없으면(판단 불가) 유지.
    rss = [p for p in rss if not p.get("published_date") or p["published_date"] >= OLDEST_DATE]
    rows = [
        {"blog_account_id": acc["id"], "post_url": p["url"], "title": p["title"],
         "keyword": derive_keyword(p["title"], p.get("tags") or []), "published_date": p["published_date"]}
        for p in rss if p["url"]
    ]
    if rows:
        upserted = sb_insert("blog_posts", rows, on_conflict="blog_account_id,post_url")
        upserted.sort(key=lambda p: p.get("published_date") or "", reverse=True)  # 최신글 먼저 측정
        for post in upserted:
            keyword = post.get("keyword_manual") or post.get("keyword") or ""
            if not keyword:
                continue
            # 오늘 이미 성공 측정(ti·bl 둘 다 fail 아님)했으면 skip — 재실행 부하↓·차단 예방.
            tr = next((r for r in (post.get("measurements") or []) if r.get("date") == TODAY), None)
            if tr and tr.get("ti_status") != "fail" and tr.get("bl_status") != "fail":
                continue
            ti, bl, ti_s, bl_s, ws = measure_rank(keyword, blog_id, post.get("post_url", ""))
            recs = [r for r in (post.get("measurements") or []) if r.get("date") != TODAY]
            recs.append({"date": TODAY, "ti": ti, "bl": bl, "ti_status": ti_s, "bl_status": bl_s, "ws": ws})
            sb_patch("blog_posts", {"id": f"eq.{post['id']}"}, {"measurements": recs})
            pm += 1

    # (B) 웹사이트(업체 단위) — url/대표키워드 있을 때만.
    host = (acc.get("website_url") or "").strip()
    rep = (acc.get("rep_keyword") or "").strip()
    if host and rep:
        we, st = measure_web_rank(rep, host)
        recs = [r for r in (acc.get("website_measurements") or []) if r.get("date") != TODAY]
        recs.append({"date": TODAY, "we": we, "status": st})
        sb_patch("blog_accounts", {"id": f"eq.{acc['id']}"}, {"website_measurements": recs})
        wm += 1

    # (C) 대표키워드(blog_keywords) — log_no 없이 = 블로그 단위 매칭.
    for row in kw_by_acc.get(acc["id"], [])[:MAX_KEYWORDS_PER_ACCOUNT]:
        kw = (row.get("keyword") or "").strip()
        if not kw:
            continue
        ti, bl, ti_s, bl_s, ws = measure_rank(kw, blog_id, "")
        recs = [r for r in (row.get("measurements") or []) if r.get("date") != TODAY]
        recs.append({"date": TODAY, "ti": ti, "bl": bl, "ti_status": ti_s, "bl_status": bl_s, "ws": ws})
        sb_patch("blog_keywords", {"id": f"eq.{row['id']}"}, {"measurements": recs})
        km += 1

    print(f"  ✓ {name}: 글 {pm} / 웹 {wm} / 키워드 {km}")
    return (pm, wm, km)


def run(fast=False, workers=4):
    need_config()
    # 안전 우선: fast 여도 '요청 간격(REQUEST_DELAY)'은 그대로 유지하고 블로그만 병렬(소수 워커).
    # (8워커+0.2초처럼 간격까지 줄이면 네이버가 차단해 fail 폭증 → 절대 줄이지 않음.)
    print(f"=== 크롤링 시작 {TODAY} / 블로그탭:{'공식 API' if USE_API else 'HTML'} / "
          f"{'병렬x'+str(workers) if fast else '순차'} / 최신 {MAX_POSTS_PER_BLOG}글 ===")
    if not USE_API:
        print("※ NAVER_CLIENT_ID/SECRET 없음 → HTML 폴백. 공식 API 등록 권장.")

    accounts = sb_get("blog_accounts", {"is_active": "eq.true", "select": "*"})
    print(f"활성 블로그 {len(accounts)}개")
    kw_rows = sb_get("blog_keywords", {"select": "*"})
    kw_by_acc = {}
    for row in kw_rows:
        kw_by_acc.setdefault(row["blog_account_id"], []).append(row)

    if fast:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=workers) as ex:
            results = list(ex.map(lambda a: _process_blog(a, kw_by_acc), accounts))
    else:
        # 순차: N개 블로그마다 긴 휴식 — 요청이 누적되면 네이버가 막판에 레이트리밋(오늘 막판 fail 다발)
        #   하므로 주기적으로 쉬어 누적 부하를 끊는다. 휴식 길이도 지터로 흔든다.
        results = []
        for i, a in enumerate(accounts):
            results.append(_process_blog(a, kw_by_acc))
            if BLOCK_REST_EVERY > 0 and (i + 1) % BLOCK_REST_EVERY == 0 and (i + 1) < len(accounts):
                rest = BLOCK_REST_SEC + random.uniform(0, BLOCK_REST_SEC * 0.5)
                print(f"  …{i + 1}/{len(accounts)} 완료 · 차단 예방 휴식 {rest:.0f}초", flush=True)
                time.sleep(rest)

    pm = sum(r[0] for r in results)
    wm = sum(r[1] for r in results)
    km = sum(r[2] for r in results)
    print(f"=== 완료: 글 {pm}건 / 웹사이트 {wm}건 / 대표키워드 {km}건 측정 ===")


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
        # 전체 실행. 기본=순차(가장 안전). --fast = 블로그 병렬(소수 워커, 간격은 유지), --workers N(기본 4).
        fast = "--fast" in args
        workers = 4
        if "--workers" in args:
            try:
                workers = max(1, int(args[args.index("--workers") + 1]))
            except (ValueError, IndexError):
                pass
        run(fast=fast, workers=workers)
