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
import datetime
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
REQUEST_DELAY = float(os.environ.get("CRAWL_DELAY", "3.5"))  # 검색 요청 사이 간격(초). 차단 회피. 2026-06-25 2→3.5(403 다발).
BLOCK_REST_EVERY = int(os.environ.get("CRAWL_REST_EVERY", "6"))   # N개 블로그마다 긴 휴식(누적 레이트리밋 예방). 8→6.
BLOCK_REST_SEC = float(os.environ.get("CRAWL_REST_SEC", "40"))    # 그 휴식 길이(초, 지터 포함). 25→40.
MAX_POSTS_PER_BLOG = 5    # 블로그당 RSS 최신 글 수(최신 위주 — 이 글들만 측정, 옛 글 제외). 2026-06-25 10→5(속도)
ETA_HINT = ""             # 시간분산 크롤 예상 완료 힌트("완료 ~HH:MM"). run_spread 가 갱신, current_blog 에 실어 보냄


def _pause(base=None):
    """요청 간격 + 무작위 지터. 일정한 주기는 봇으로 탐지되기 쉬우므로 매번 살짝 흔든다(차단 예방)."""
    b = REQUEST_DELAY if base is None else base
    time.sleep(b + random.uniform(0, b * 0.6))
OLDEST_DATE = "2025-01-01"  # 이 날짜 이전(너무 옛날) 글은 추적 제외 — 최신 1~2년만 추적
# 최근성 컷오프 — 발행일이 이 일수보다 오래된 글은 측정 제외(휴면 블로그 자동 스킵).
#   2026-06-26 사용자 요청: 최신글이 한참 전(1~2월 등)인 블로그는 크롤 안 함. 120일≈4개월(6월이면 ~2월 말 이후만).
RECENT_DAYS = 120
def recent_cutoff():
    return (datetime.date.today() - datetime.timedelta(days=RECENT_DAYS)).isoformat()
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

    def _post(rs):
        return requests.post(
            f"{SUPABASE_URL}/rest/v1/{path}",
            headers=sb_headers({"Prefer": ",".join(prefer)}),
            params=params, data=json.dumps(rs), timeout=30,
        )

    r = _post(rows)
    # DB에 아직 없는 컬럼(예: published_at — alter table 전)으로 400 나면 그 컬럼 빼고 1회 재시도(크롤 안 깨지게).
    if r.status_code == 400 and rows and any("published_at" in (row or {}) for row in rows):
        try:
            msg = r.json()
        except Exception:
            msg = {}
        if "published_at" in json.dumps(msg) or "column" in json.dumps(msg).lower():
            rows2 = [{k: v for k, v in (row or {}).items() if k != "published_at"} for row in rows]
            r = _post(rows2)
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


def set_crawl_status(**fields):
    """크롤 진행 상황을 crawl_status(단일행 id=1)에 기록 — '크롤링 현황' 페이지 실시간 표시용.
    실패해도 크롤은 계속(현황 기록은 부가기능)."""
    try:
        fields["id"] = 1
        fields["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        sb_insert("crawl_status", [fields], on_conflict="id")
    except Exception:
        pass


def log_crawl_run(kind, measured, fail):
    """크롤 1회 완료를 crawl_status.recent_runs(최근 20개)에 기록 — 웹 '최근 크롤 기록'(집에서 새벽·퇴근후 크롤 확인용).
    컬럼(recent_runs) 없으면 조용히 패스."""
    rec = {"at": datetime.datetime.now().isoformat(timespec="minutes"), "kind": kind,
           "measured": int(measured or 0), "fail": int(fail or 0)}
    try:
        cur = sb_get("crawl_status", {"id": "eq.1", "select": "recent_runs"})[0].get("recent_runs") or []
    except Exception:
        cur = []
    cur = ([rec] + cur)[:100]  # 최근 100개까지 시간순으로 누적(약 2~3일치)
    try:
        sb_patch("crawl_status", {"id": "eq.1"}, {"recent_runs": cur})
    except Exception:
        pass


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
        pub = pub_at = None
        if entry.get("published_parsed"):
            # 네이버 RSS published_parsed 는 UTC → KST(+9h)로 보정. 날짜 + 시각 둘 다 저장(누락 18~24시 판정용).
            _kst = datetime.datetime(*entry.published_parsed[:6]) + datetime.timedelta(hours=9)
            pub = _kst.date().isoformat()
            pub_at = _kst.isoformat()
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
                      "published_date": pub, "published_at": pub_at, "tags": tags})
    return posts


def _rss_entries_light(blog_id: str):
    """RSS 최신 N글의 (url·제목·발행일·RSS태그)만 — 하단 해시태그 fetch 는 안 함(라운드로빈 1단계: 빠르게
    전체 글목록만 확보. 해시태그/자동키워드 확정은 측정 직전에)."""
    parsed = feedparser.parse(f"https://rss.blog.naver.com/{blog_id}.xml")
    out = []
    for entry in parsed.entries[:MAX_POSTS_PER_BLOG]:
        link = entry.get("link", "")
        pub = pub_at = None
        if entry.get("published_parsed"):
            # 네이버 RSS published_parsed 는 UTC → KST(+9h)로 보정. 날짜 + 시각 둘 다 저장(누락 18~24시 판정용).
            _kst = datetime.datetime(*entry.published_parsed[:6]) + datetime.timedelta(hours=9)
            pub = _kst.date().isoformat()
            pub_at = _kst.isoformat()
        tag_raw = entry.get("tag") or entry.get("tags") or ""
        if isinstance(tag_raw, list):
            tag_raw = ",".join(getattr(x, "term", None) or (x.get("term") if isinstance(x, dict) else str(x)) for x in tag_raw)
        rss_tags = [t.strip() for t in html.unescape(str(tag_raw)).split(",") if t.strip()]
        out.append({"url": link, "title": html.unescape(entry.get("title", "")),
                    "published_date": pub, "published_at": pub_at, "rss_tags": rss_tags})
    return out


def _keyword_from_hashtags(title, post_url, rss_tags):
    """자동키워드 확정 — RSS태그가 이미 '지역+서비스'면 그대로, 아니면 글 하단 #해시태그를 직접 가져와 도출."""
    rss_kw = pick_main_hashtag_keyword(rss_tags)
    if rss_kw and " " in rss_kw:
        return derive_keyword(title, rss_tags)
    tags = fetch_post_hashtags(post_url) or rss_tags
    _pause()
    return derive_keyword(title, tags)


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
# 블로그 '프로필(홈) 링크' — 글번호 없는 blog.naver.com/<id>. 통합탭 상단 대표 카드가 특정 글이 아니라
#   블로그 홈으로 링크되는 경우(예: 경기광주 인테리어필름 vision1803 = 화면 2위 프로필 카드)를 잡는다.
#   id 뒤가 /?# 또는 끝이라야 함(PostView.naver 같은 건 '.'에서 끊겨 매칭 안 됨).
_BLOG_HOME_RE = re.compile(r"(?:m\.)?blog\.naver\.com/([A-Za-z0-9_-]+)(?=[/?#]|$)")


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


def _block_blog_entries(node):
    """블록(카드) 1개에서 (posts, profiles) 를 뽑는다.
      posts    = {(blog_id, log_no)}  — 글 링크(글번호 있음, 카드 대표글)
      profiles = {blog_id}            — '블로그 프로필(홈) 링크'만 있고 그 블로그의 글 링크는 없는 카드
    profiles = 통합탭 상단의 '블로그 프로필 카드'(특정 글이 아니라 블로그 자체가 한 칸 차지).
      단, 같은 블록에 그 블로그의 글 링크가 있으면(=일반 글 카드의 작성자 프로필 링크) profiles 에서 뺀다
      → 칠곡처럼 '같은 블로그 다른 글'에 순위가 전염되는 버그 방지(글 카드는 글번호로만 매칭).
    관련글 묶음(afterArticles/clusters/...) 하위는 제외."""
    posts = set()
    home = set()

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in _PRIMARY_EXCLUDE_KEYS:
                    continue
                if isinstance(v, str):
                    if k in _PRIMARY_NAV_FIELDS:
                        m = _BLOG_POST_RE.search(v)
                        if m:
                            posts.add((m.group(1), m.group(2)))
                        else:
                            mh = _BLOG_HOME_RE.search(v)
                            if mh:
                                home.add(mh.group(1))
                else:
                    walk(v)
        elif isinstance(o, list):
            for x in o:
                walk(x)

    walk(node)
    profiles = home - {bid for bid, _ in posts}
    return posts, profiles


def _entry_match(blog_id, log_no, posts, profiles):
    """이 콘텐츠 카드가 우리 글이면 True. 통합탭은 '글(콘텐츠)' 기준 — 블로그 채널(프로필) 카드는
    애초에 카운트 대상에서 빠지므로(_is_content_card) profiles 는 매칭에 쓰지 않는다(strict).
    log_no 있으면 그 글만, 없으면 그 블로그의 아무 글이나."""
    if log_no:
        return any(lno == log_no for _, lno in posts)
    return any(bid == blog_id for bid, _ in posts)


def _is_content_card(j, raw):
    """통합탭에서 '카운트 대상'인 콘텐츠 카드인지 — 네이버 블로그 글 또는 카페 글이면 True.
    제외(통합탭 순위 아님): 외부 웹사이트(당근 daangn / forwarder.kr / 114.co.kr / work24 등 '관련문서'
      묶음 = 웹사이트탭), 블로그 '채널/프로필' 카드(글번호 없는 blog.naver.com/<id> 홈), 이미지/연관검색어.
    2026-06-25 사용자 확정(경기광주·용산 인테리어필름): 통합탭 = 위 웹사이트 묶음을 뺀, 블로그·카페 글이
      나열되는 영역에서의 위치. (예: 용산 = 아카데미디자인필름이 1위인 영역.)"""
    posts, _ = _block_blog_entries(j)
    if posts:                      # 네이버 블로그 '글'(글번호 있음) = 콘텐츠
        return True
    if "cafe.naver.com" in raw:    # 네이버 카페 글 = 콘텐츠(순위 칸 차지)
        return True
    return False


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


# ── 통합탭(ti): '블로그/카페 인기글을 위에서부터 연속으로 센 순위'(섹션 안 나눔) ──
# 2026-06-29: 사용자 결정 — 통합검색을 이미지로 나뉜 위/아래 섹션별로 따로 세지 않고, 전체를 위에서부터
#   '블로그/카페 인기글'만 광고 빼고 연속 순위로 센다. 예) 아산 미유외과: 위(urB_coR) miumiu8232·
#   miyustory·…(4개) → 아래(urB_boR) ram2222 → 섹션 합산이라 ram2222=5위(섹션별이면 1위였음).
#   web*(웹사이트/문서) 섹션·광고(ader)·이미지·지식iN·비결과(r 없음) 블록은 순위에서 제외(블로그/카페만).
#   매칭은 카드 '대표글'로만.  (이전 2026-06-24 섹션별 방식에서 변경.)
def _rank_in_popular(html_text, blog_id, log_no=""):
    """통합검색 HTML → (rank, status). 블로그/카페 인기글을 위에서부터 연속으로 센 순위(섹션 합산)."""
    blocks = extract_bootstrap_json(html_text)
    if not blocks:
        return OUT_OF_RANK, "fail"      # JSON 없음 = 차단/구조변경 → 권외와 구분

    # 2026-07-09 사용자 재정의: 통합탭 = 맨 위 파워링크 광고·이미지/동영상·플레이스만 빼고, 그 아래
    #   모든 결과 카드(블로그·카페·웹사이트/문서)를 화면 위에서부터 순차 카운트. blockId 템플릿으로 제외 판정.
    #   (이전 '외부 웹사이트 제외' 규칙 폐기 — 웹사이트도 순위 칸으로 센다.)
    rank = 0
    for b in blocks:
        try:
            j = json.loads(b)
        except Exception:
            continue
        area = _block_area(j)
        blk = (j.get("refs") or {}).get("blockId", "")
        if _ti_excluded(area, blk, _block_min_r(j)):
            continue
        cards = _ugb_cards(j)
        if cards:
            # 웹사이트 카드는 blog prims 가 비지만 화면 한 칸을 차지 → 함께 카운트(빈 카드도 rank+1).
            for r, prims in cards:
                rank += 1
                for bid, lno in prims:
                    if (log_no and lno == log_no) or (not log_no and bid == blog_id):
                        return rank, "ok"
        else:
            rank += 1                        # r 카드가 없는 단일 결과 블록도 한 칸
            posts, profiles = _block_blog_entries(j)
            if _entry_match(blog_id, log_no, posts, profiles):
                return rank, "ok"
    return OUT_OF_RANK, "out"


# 통합탭에서 제외할 블록(파워링크 광고·이미지/동영상·플레이스·연관검색어) 판정 — blockId 템플릿 기반.
#   포함(카운트): review(블로그)·web(웹사이트/문서)·ugc/cafe 등 '결과 카드' 블록.
_TI_EXCLUDE_KEYS = (
    "qra",                                   # 연관검색어/AI
    "clip", "video", "vclip", "vod",         # 동영상
    "image", "imgsr", "imagesearch", "imggrp",  # 이미지
    "place", "loc_", "plc", "map_", "localbusiness",  # 플레이스/지도
    "nad", "power", "plink", "brandsearch", "bizsite", "shopping",  # 광고/파워링크/쇼핑
    "kin", "news",                           # 지식iN·뉴스
)


def _ti_excluded(area, blk, min_r):
    """이 블록이 통합탭 순위 카운트 대상이 아니면(광고·이미지·플레이스·연관) True."""
    if min_r >= 999:                         # 연관검색어/AI 등 비-결과
        return True
    a = (area or "").lower()
    if a.startswith(("vdb", "imb")):         # 동영상(vdB)/이미지(imB) 섹션
        return True
    k = (blk or "").lower()
    return any(x in k for x in _TI_EXCLUDE_KEYS)


def _website_present(html_text, blog_id, log_no=""):
    """(참고 저장용) 통합검색 web* 섹션에 우리 글/블로그가 있으면 '있음'. 트래커 웹사이트탭 컬럼은
    제거됐지만 하위호환 위해 계산은 유지."""
    blocks = extract_bootstrap_json(html_text)
    if not blocks:
        return "fail"
    for b in blocks:
        try:
            j = json.loads(b)
        except Exception:
            continue
        if not _is_web_area(_block_area(j)):
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

    # 블로그탭은 단일 랭킹 리스트라 '그 글의 clickLog r'이 곧 화면 순위다. 수집 글들의 '몇 번째'(position)가
    #   아니다 — contentHref 글만 모으면 중간 글(r=1,3,4..)을 놓쳐 순위가 작게 나오는 버그(미유외과 r=12를
    #   4위로 오인). 2026-06-25 사용자 확인: r 값이 실제 순위. log_no 있으면 그 글 r, 없으면 최소 r(대표글).
    posts.sort(key=lambda x: x[0])  # 블로그 단위(log_no 없음)일 때 최소 r(가장 좋은 순위) 먼저
    for r, pid, plog in posts:
        if (log_no and plog == log_no) or (not log_no and pid == blog_id):
            return r, "ok"
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


def measure_blogtab_api(keyword, blog_id, log_no=""):
    """블로그탭을 네이버 공식 검색 API(blog.json)로 측정 — m.search SERP 스크래핑이 아니라 openapi 호출이라
    IP 차단(403)을 거의 안 받고 즉시. (rank, status) 반환. MAX_RANK_SCAN(30) 초과면 권외.
    ※ 공식 API 정렬은 화면 블로그탭과 다소 다를 수 있음(정확도 일부 양보 — 2026-06-25 사용자 선택: 차단·속도 우선)."""
    try:
        rank = measure_blog_rank_api(keyword, blog_id, log_no)
    except Exception as exc:
        print(f"    [블로그탭 API 실패] {keyword}: {exc}")
        return OUT_OF_RANK, "fail"
    return (rank, "ok") if rank < OUT_OF_RANK else (OUT_OF_RANK, "out")


def measure_rank(keyword, blog_id, post_url):
    log_no = extract_log_no(post_url)

    # 블로그탭(bl): 진짜 블로그탭 HTML 파싱(실제 화면 순위). 공식 API 는 정렬이 화면과 달라(부정확) 안 씀.
    #   2026-06-25 사용자 확인: API 가 화면과 다른 순위(더맨시스템 공공기관청소경비 API 3위≠실제) → 스크래핑 복귀.
    #   차단은 시간분산(--spread 청크+갭)·5글로 완화. fail 이면 잠깐 쉬고 1회 재시도.
    bl, bl_status = measure_blogtab_real(keyword, blog_id, log_no)
    if bl_status == "fail":
        _pause(REQUEST_DELAY * 2)
        bl, bl_status = measure_blogtab_real(keyword, blog_id, log_no)
    _pause()

    # 통합탭(ti)+웹사이트탭 존재(ws): 한 번 조회로 둘 다(공식 API 없음 → SERP 스크래핑). fail 이면 1회 재시도.
    ti, ti_status, ws = measure_integrated_popular(keyword, blog_id, log_no)
    if ti_status == "fail":
        _pause(REQUEST_DELAY * 2)
        ti, ti_status, ws = measure_integrated_popular(keyword, blog_id, log_no)
    _pause()

    return ti, bl, ti_status, bl_status, ws


def _skip_stable(measurements, today):
    """요청 절감(2026-06-25) — 직전 측정 2회가 동일(ti·bl 같고 실패 아님)하고 3일 이내면 오늘 측정 스킵.
    변동 가능성 낮은 안정 글은 매일 안 재고, 3일 넘으면 다시 점검. 이력 2건 미만이면 측정."""
    recs = sorted(
        [m for m in (measurements or []) if m.get("date") and m["date"] < today],
        key=lambda m: m.get("date", ""), reverse=True,
    )
    if len(recs) < 2:
        return False
    a, b = recs[0], recs[1]
    if a.get("ti_status") == "fail" or a.get("bl_status") == "fail":
        return False
    if not (a.get("ti") == b.get("ti") and a.get("bl") == b.get("bl")):
        return False
    try:
        age = (datetime.date.fromisoformat(today) - datetime.date.fromisoformat(a["date"])).days
        return age <= 3
    except Exception:
        return False


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
def _process_blog(acc, kw_by_acc, force=False):
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
    rss = [p for p in rss if not p.get("published_date") or p["published_date"] >= recent_cutoff()]
    rows = [
        {"blog_account_id": acc["id"], "post_url": p["url"], "title": p["title"],
         "keyword": derive_keyword(p["title"], p.get("tags") or []), "published_date": p["published_date"], "published_at": p.get("published_at")}
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
            #   force=True(전체 재측정/파서 변경 반영)면 skip 없이 다시 잰다.
            tr = next((r for r in (post.get("measurements") or []) if r.get("date") == TODAY), None)
            if not force and tr and tr.get("ti_status") != "fail" and tr.get("bl_status") != "fail":
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


def run(fast=False, workers=4, force=False, max_posts=None):
    global MAX_POSTS_PER_BLOG
    if max_posts:
        MAX_POSTS_PER_BLOG = max_posts   # 테스트/수동 크롤에서 최신 N글로 제한
    need_config()
    # 안전 우선: fast 여도 '요청 간격(REQUEST_DELAY)'은 그대로 유지하고 블로그만 병렬(소수 워커).
    # (8워커+0.2초처럼 간격까지 줄이면 네이버가 차단해 fail 폭증 → 절대 줄이지 않음.)
    print(f"=== 크롤링 시작 {TODAY} / 블로그탭:{'공식 API' if USE_API else 'HTML'} / "
          f"{'병렬x'+str(workers) if fast else '순차'} / 최신 {MAX_POSTS_PER_BLOG}글 ===")
    if not USE_API:
        print("※ NAVER_CLIENT_ID/SECRET 없음 → HTML 폴백. 공식 API 등록 권장.")

    accounts = sb_get("blog_accounts", {"is_active": "eq.true", "select": "*"})

    # 진행률 100%(계약 건수 모두 발행=remain 0)인 블로그는 후순위 — 아직 진행 중인 곳부터 측정.
    def _done(a):
        g, r = a.get("goal_count"), a.get("remain_count")
        return g is not None and r is not None and g > 0 and r == 0
    accounts.sort(key=lambda a: 1 if _done(a) else 0)  # 안정정렬: 완료 블로그만 뒤로
    n_done = sum(1 for a in accounts if _done(a))
    print(f"활성 블로그 {len(accounts)}개 (진행중 {len(accounts) - n_done} 먼저 · 완료 {n_done} 후순위)")
    kw_rows = sb_get("blog_keywords", {"select": "*"})
    kw_by_acc = {}
    for row in kw_rows:
        kw_by_acc.setdefault(row["blog_account_id"], []).append(row)

    if fast:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=workers) as ex:
            results = list(ex.map(lambda a: _process_blog(a, kw_by_acc, force=force), accounts))
    else:
        # 순차: N개 블로그마다 긴 휴식 — 요청이 누적되면 네이버가 막판에 레이트리밋(오늘 막판 fail 다발)
        #   하므로 주기적으로 쉬어 누적 부하를 끊는다. 휴식 길이도 지터로 흔든다.
        results = []
        total = len(accounts)
        set_crawl_status(running=True, phase="crawl", done=0, total=total, ok=0, fail=0, current_blog="")
        for i, a in enumerate(accounts):
            set_crawl_status(running=True, phase="crawl", done=i, total=total,
                             current_blog=a.get("name", ""))
            results.append(_process_blog(a, kw_by_acc, force=force))
            if BLOCK_REST_EVERY > 0 and (i + 1) % BLOCK_REST_EVERY == 0 and (i + 1) < total:
                rest = BLOCK_REST_SEC + random.uniform(0, BLOCK_REST_SEC * 0.5)
                print(f"  …{i + 1}/{total} 완료 · 차단 예방 휴식 {rest:.0f}초", flush=True)
                set_crawl_status(running=True, phase="rest", done=i + 1, total=total, current_blog="휴식 중")
                time.sleep(rest)

    pm = sum(r[0] for r in results)
    wm = sum(r[1] for r in results)
    km = sum(r[2] for r in results)
    set_crawl_status(running=False, phase="done", done=len(accounts), total=len(accounts), current_blog="")
    print(f"=== 완료: 글 {pm}건 / 웹사이트 {wm}건 / 대표키워드 {km}건 측정 ===")


def run_breadth(force=False, max_posts=None, only_ids=None):
    """라운드로빈 크롤(기본) — 전체 블로그의 '최신글 1개씩' 먼저 돌고, 다음 라운드에서 2번째 글… 식.
    한 업체를 끝까지 하지 않아 중간에 차단돼도 모든 업체의 최신글이 먼저 확보된다.
    only_ids 주면 그 블로그들만(시간분산 청크용). 1) RSS → 2) 라운드로빈 측정 → 3) 웹사이트/대표키워드."""
    global MAX_POSTS_PER_BLOG
    if max_posts:
        MAX_POSTS_PER_BLOG = max_posts
    need_config()
    print(f"=== 크롤링 시작(라운드로빈·최신글 우선) {TODAY} / 최신 {MAX_POSTS_PER_BLOG}글 ===", flush=True)
    accounts = sb_get("blog_accounts", {"is_active": "eq.true", "select": "*"})

    def _done(a):
        g, r = a.get("goal_count"), a.get("remain_count")
        return g is not None and r is not None and g > 0 and r == 0
    accounts.sort(key=lambda a: 1 if _done(a) else 0)   # 진행중 먼저
    if only_ids is not None:                            # 시간분산 청크: 이 블로그들만
        accounts = [a for a in accounts if a["id"] in only_ids]
    kw_rows = sb_get("blog_keywords", {"select": "*"})
    kw_by_acc = {}
    for row in kw_rows:
        kw_by_acc.setdefault(row["blog_account_id"], []).append(row)

    # ── 1) RSS 수집(전체 글목록만 — 빠르게. 해시태그 fetch 는 측정 직전으로 미룸) ──
    set_crawl_status(running=True, phase="rss", done=0, total=len(accounts), ok=0, fail=0, current_blog="글목록 수집")
    blogs = []
    for idx, acc in enumerate(accounts):
        blog_id = acc.get("blog_id") or parse_blog_url(acc.get("blog_url", ""))[0] or ""
        if not blog_id:
            continue
        try:
            entries = _rss_entries_light(blog_id)
        except Exception as exc:
            print(f"  RSS 실패 {acc.get('name')}: {exc}", flush=True)
            entries = []
        entries = [e for e in entries if not e.get("published_date") or e["published_date"] >= recent_cutoff()]
        rows = [{"blog_account_id": acc["id"], "post_url": e["url"], "title": e["title"],
                 "keyword": derive_keyword(e["title"], e["rss_tags"]), "published_date": e["published_date"], "published_at": e.get("published_at")}
                for e in entries if e["url"]]
        upserted = sb_insert("blog_posts", rows, on_conflict="blog_account_id,post_url") if rows else []
        by_url = {p["post_url"]: p for p in upserted}
        plist = []
        for e in sorted(entries, key=lambda e: e.get("published_date") or "", reverse=True):  # 최신순
            row = by_url.get(e["url"])
            if row:
                plist.append({"row": row, "rss_tags": e["rss_tags"], "url": e["url"], "title": e["title"]})
        blogs.append({"acc": acc, "blog_id": blog_id, "posts": plist})
        set_crawl_status(running=True, phase="rss", done=idx + 1, total=len(accounts), current_blog=acc.get("name", ""))
        _pause(REQUEST_DELAY)

    # ── 1b) DB 추적글 전체(창 이내) 병합 — RSS 최신 N글에 없는 옛 추적글도 매일 재측정(우측 최신화). ──
    #   블로그당 최신글만이 아니라, 추적 중인 모든 글(발행일 최근 RECENT_DAYS일 이내, 최신순)을 측정 대상에 포함.
    cutoff = recent_cutoff()
    try:
        all_posts = sb_get("blog_posts", {
            "select": "id,blog_account_id,post_url,title,keyword,keyword_manual,published_date,measurements",
            "or": f"(published_date.gte.{cutoff},published_date.is.null)",
        })
    except Exception as exc:
        print(f"  DB 추적글 조회 실패(RSS만 측정): {exc}", flush=True)
        all_posts = []
    posts_by_acc = {}
    for p in all_posts:
        posts_by_acc.setdefault(p.get("blog_account_id"), []).append(p)
    for b in blogs:
        have = {it["url"] for it in b["posts"]}
        for p in posts_by_acc.get(b["acc"]["id"], []):
            u = p.get("post_url")
            if u and u not in have:
                b["posts"].append({"row": p, "rss_tags": [], "url": u, "title": p.get("title") or ""})
                have.add(u)
        # 최신순(발행일 내림차순) — 최신 글부터 측정.
        b["posts"].sort(key=lambda it: (it["row"].get("published_date") or ""), reverse=True)

    # ── 2) 라운드로빈 측정(라운드 i = 각 블로그 i번째 최신글) — 창 이내 추적글 전부. ──
    total = sum(len(b["posts"]) for b in blogs)
    print(f"=== 측정 시작(라운드로빈, 총 {total}글 / {len(blogs)}블로그) ===", flush=True)
    set_crawl_status(running=True, phase="crawl", done=0, total=total, ok=0, fail=0, current_blog="")
    done = ok = fail = 0
    # 블로그당 5글 제한 없이, 가장 많은 글 수만큼 라운드 진행(라운드 i = 각 블로그의 i번째 최신글).
    max_rounds = max((len(b["posts"]) for b in blogs), default=0)
    for i in range(max_rounds):
        for b in blogs:
            if i >= len(b["posts"]):
                continue
            item, acc, blog_id = b["posts"][i], b["acc"], b["blog_id"]
            row = item["row"]
            tr = next((r for r in (row.get("measurements") or []) if r.get("date") == TODAY), None)
            if not force and tr and tr.get("ti_status") != "fail" and tr.get("bl_status") != "fail":
                done += 1
                continue
            if not force and _skip_stable(row.get("measurements"), TODAY):  # 변동 없는 안정 글 → 스킵(요청 절감)
                done += 1
                continue
            kw = (row.get("keyword_manual") or "").strip()
            if not kw:                                  # 수동 없으면 글 하단 해시태그로 자동키워드 확정
                kw = _keyword_from_hashtags(item["title"], item["url"], item["rss_tags"])
                if kw and kw != row.get("keyword"):
                    try:
                        sb_patch("blog_posts", {"id": f"eq.{row['id']}"}, {"keyword": kw})
                    except Exception:
                        pass
            if not kw:
                done += 1
                continue
            ti, bl, ti_s, bl_s, ws = measure_rank(kw, blog_id, item["url"])
            recs = [r for r in (row.get("measurements") or []) if r.get("date") != TODAY]
            recs.append({"date": TODAY, "ti": ti, "bl": bl, "ti_status": ti_s, "bl_status": bl_s, "ws": ws})
            sb_patch("blog_posts", {"id": f"eq.{row['id']}"}, {"measurements": recs})
            row["measurements"] = recs                  # 메모리 갱신(다음 라운드 스킵 판단용)
            done += 1
            ok += 0 if (ti_s == "fail" or bl_s == "fail") else 1
            fail += 1 if (ti_s == "fail" or bl_s == "fail") else 0
            set_crawl_status(running=True, phase="crawl", done=done, total=total, ok=ok, fail=fail,
                             current_blog=f"{acc.get('name','')} · 라운드 {i + 1}" + (f" · {ETA_HINT}" if ETA_HINT else ""))
            if BLOCK_REST_EVERY > 0 and done % BLOCK_REST_EVERY == 0 and done < total:
                rest = BLOCK_REST_SEC + random.uniform(0, BLOCK_REST_SEC * 0.5)
                print(f"  …{done}/{total} · 차단 예방 휴식 {rest:.0f}초", flush=True)
                set_crawl_status(running=True, phase="rest", done=done, total=total, ok=ok, fail=fail, current_blog="휴식 중")
                time.sleep(rest)

    # ── 3) 웹사이트 + 대표키워드(업체 단위, 후순위) ──
    set_crawl_status(running=True, phase="extra", done=total, total=total, ok=ok, fail=fail, current_blog="웹사이트/대표키워드")
    for b in blogs:
        acc, blog_id = b["acc"], b["blog_id"]
        host = (acc.get("website_url") or "").strip()
        rep = (acc.get("rep_keyword") or "").strip()
        if host and rep:
            we, st = measure_web_rank(rep, host)
            recs = [r for r in (acc.get("website_measurements") or []) if r.get("date") != TODAY]
            recs.append({"date": TODAY, "we": we, "status": st})
            sb_patch("blog_accounts", {"id": f"eq.{acc['id']}"}, {"website_measurements": recs})
        for kwrow in kw_by_acc.get(acc["id"], [])[:MAX_KEYWORDS_PER_ACCOUNT]:
            kw = (kwrow.get("keyword") or "").strip()
            if not kw:
                continue
            ti, bl, ti_s, bl_s, ws = measure_rank(kw, blog_id, "")
            recs = [r for r in (kwrow.get("measurements") or []) if r.get("date") != TODAY]
            recs.append({"date": TODAY, "ti": ti, "bl": bl, "ti_status": ti_s, "bl_status": bl_s, "ws": ws})
            sb_patch("blog_keywords", {"id": f"eq.{kwrow['id']}"}, {"measurements": recs})

    set_crawl_status(running=False, phase="done", done=total, total=total, ok=ok, fail=fail, current_blog="")
    print(f"=== 완료: {done}글 측정(ok {ok} / fail {fail}) ===", flush=True)


def run_spread(force=False, max_posts=None, chunk_size=5, gap_min=6, deadline=None, margin_min=20):
    """시간 분산 크롤 — 블로그를 chunk_size 개씩 나눠 청크별로 측정하고, 청크 사이에 갭(IP 휴식)을 둔다.
    짧은 시간에 요청이 몰려 차단되던 문제를 근본 회피(요청을 시간축으로 펼침).
      deadline='HH:MM' 주면 그 시각(−margin_min)까지 끝나도록 청크 시작 간격을 자동 분배(예: 04시 시작·09시 마감).
      deadline 없으면 gap_min 고정 갭. blogtab=API(SERP 절반)·5글과 합쳐 무료로 사실상 무차단."""
    global MAX_POSTS_PER_BLOG, ETA_HINT
    if max_posts:
        MAX_POSTS_PER_BLOG = max_posts
    need_config()
    accounts = sb_get("blog_accounts", {"is_active": "eq.true", "select": "*"})

    def _done(a):
        g, r = a.get("goal_count"), a.get("remain_count")
        return g is not None and r is not None and g > 0 and r == 0
    accounts.sort(key=lambda a: 1 if _done(a) else 0)
    ids = [a["id"] for a in accounts]
    groups = [ids[i:i + chunk_size] for i in range(0, len(ids), chunk_size)]
    nch = len(groups) or 1

    start = datetime.datetime.now()
    interval = None
    end = None
    if deadline:
        hh, mm = (int(x) for x in deadline.split(":"))
        end = start.replace(hour=hh, minute=mm, second=0, microsecond=0) - datetime.timedelta(minutes=margin_min)
        if end <= start:
            end = start + datetime.timedelta(hours=4)      # 안전장치
        interval = (end - start).total_seconds() / nch     # 청크 '시작' 간격 균등

    def _eta_hint(done_chunks):
        """남은 청크로 예상 완료 시각 → '완료 ~HH:MM'. deadline 모드는 마감(end), 아니면 평균 속도 외삽."""
        if done_chunks >= nch:
            return ""
        if end is not None:                                # 마감 모드
            eta = end
        elif done_chunks <= 0:                             # 초기 러프 추정(갭 모드)
            per = gap_min * 60 + chunk_size * MAX_POSTS_PER_BLOG * (REQUEST_DELAY * 2.5)
            eta = start + datetime.timedelta(seconds=nch * per)
        else:                                              # 진행 평균으로 외삽
            elapsed = (datetime.datetime.now() - start).total_seconds()
            eta = datetime.datetime.now() + datetime.timedelta(seconds=(nch - done_chunks) * (elapsed / done_chunks))
        return f"완료 ~{eta:%H:%M}"

    ETA_HINT = _eta_hint(0)                                # 시작 추정
    print(f"=== 시간분산 크롤 {nch}청크(블로그 {chunk_size}개씩) · "
          f"{'마감 ' + deadline + f'(-{margin_min}분)' if deadline else f'갭 {gap_min}분'} ===", flush=True)

    for i, group in enumerate(groups):
        if not group:
            continue
        print(f"[청크 {i + 1}/{nch}] 블로그 {len(group)}개 측정", flush=True)
        run_breadth(force=force, only_ids=set(group))
        ETA_HINT = _eta_hint(i + 1)                        # 청크 완료마다 예상 완료시각 갱신
        if i < nch - 1:
            if interval is not None:
                target = start + datetime.timedelta(seconds=interval * (i + 1))
                wait = (target - datetime.datetime.now()).total_seconds()
            else:
                wait = gap_min * 60
            if wait > 0:
                print(f"  …IP 휴식 {wait / 60:.0f}분 (다음 청크 대기)", flush=True)
                rest_end = datetime.datetime.now() + datetime.timedelta(seconds=wait)
                while True:                                  # 휴식 중에도 45초마다 갱신 → 현황 배너 유지(카운트다운)
                    remain = (rest_end - datetime.datetime.now()).total_seconds()
                    if remain <= 0:
                        break
                    mins = int(remain // 60) + 1
                    set_crawl_status(running=True, phase="rest", done=i + 1, total=nch,
                                     current_blog=f"청크 {i + 1}/{nch} 완료 · 다음 청크까지 {mins}분 휴식"
                                     + (f" · {ETA_HINT}" if ETA_HINT else ""))
                    time.sleep(min(45, remain))
    ETA_HINT = ""
    set_crawl_status(running=False, phase="done", current_blog="")
    # 최근 크롤 기록용: 오늘 측정/실패 글 수 집계(전체크롤은 하루 1회라 DB 집계 부담 적음)
    try:
        _ps = sb_get("blog_posts", {"select": "measurements", "limit": "9000"})
        _meas = _fail = 0
        for _p in _ps:
            _m = next((x for x in (_p.get("measurements") or []) if x.get("date") == TODAY), None)
            if _m:
                _meas += 1
                if _m.get("ti_status") == "fail" or _m.get("bl_status") == "fail":
                    _fail += 1
        log_crawl_run("전체크롤", _meas, _fail)
    except Exception:
        pass
    print("=== 시간분산 크롤 전체 완료 ===", flush=True)


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
        # 기본 = 라운드로빈(run_breadth): 전체 블로그의 최신글 1개씩 → 다음 라운드 2번째 글… (최신글 우선,
        #   중간 차단돼도 모든 업체 최신글 먼저 확보). 06시 스케줄도 이 방식. --depth = 옛 깊이우선(한 업체 끝까지).
        #   --force = 오늘 성공분도 재측정. --max-posts N = 블로그당 최신 N글.
        force = "--force" in args
        depth = "--depth" in args
        spread = "--spread" in args
        max_posts = None

        def _arg(name, cast=int, default=None):
            if name in args:
                try:
                    return cast(args[args.index(name) + 1])
                except (ValueError, IndexError):
                    return default
            return default
        max_posts = _arg("--max-posts", int)
        if max_posts:
            max_posts = max(1, max_posts)
        if spread:
            # 시간분산: 블로그 N개씩 청크 + 갭. --deadline HH:MM(예: 09:00) 까지 끝나게 자동 분배.
            #   --chunk-size N(기본 5), --gap N분(deadline 없을 때), --deadline HH:MM.
            run_spread(
                force=force, max_posts=max_posts,
                chunk_size=_arg("--chunk-size", int, 5) or 5,
                gap_min=_arg("--gap", int, 6) or 6,
                deadline=_arg("--deadline", str, None),
            )
        elif depth:
            run(fast="--fast" in args, workers=_arg("--workers", int, 4) or 4, force=force, max_posts=max_posts)
        else:
            run_breadth(force=force, max_posts=max_posts)
