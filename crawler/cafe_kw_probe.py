# -*- coding: utf-8 -*-
"""키워드형 인기탭 스캐너 (발굴 전용·읽기).

  씨앗 키워드 → 네이버 자동완성으로 세부키워드 확장 → 각 세부키워드의 통합검색 SERP에서
  '인기글 테마 섹션'을 스캔해 (테마·광고/유기 슬롯·점유 카페/블로그·빈자리 판정)를 표로 낸다.

  배경: 인기탭 순위 경쟁은 '카테고리 섹션'이 아니라 '정확한 검색어' 단위로 벌어진다.
        브로드(향수)는 대형 카페가 독점하지만, 세부키워드(고체향수)는 경쟁이 옅어 진입 여지.
        → 지역형(지역+업종)의 '제품/주제版'. 측정은 blog_rank_crawler.measure_cafe_rank 그대로.

  실행:
    python cafe_kw_probe.py 향수                 # 씨앗 확장(자동완성) 후 세부키워드 일괄 스캔
    python cafe_kw_probe.py 향수 맛집 --depth 2   # 2단계 확장(세부의 세부까지)
    python cafe_kw_probe.py 고체향수 --no-expand  # 확장 없이 그 키워드만
    python cafe_kw_probe.py --self-test          # QA 자기검증(알려진 키워드로)

  이 PC(사무실 IP)에서만 돌린다(읽기 스캔). 대량 발행 아님.  [[cafe-scan-here]]
"""
import sys
import os
import re
import json
from urllib.parse import quote

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore

truststore.inject_into_ssl()
import blog_rank_crawler as c  # 측정/차단회피/파싱 로직 재사용
import datetime as _dt

# ── 스캔 결과 캐시(재스크랩 방지 = 차단 위험↓) ────────────────────────────────
# 한 번 인기탭 판정한 키워드는 로컬 파일에 저장하고, TTL 이내면 재스캔(스크랩) 안 한다.
#   → 겹치는/반복 키워드의 m.search 요청을 제거해 우리 IP 차단 위험을 실질적으로 낮춘다.
_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cafe_kw_cache.json")
_CACHE_TTL_DAYS = 7
_USE_CACHE = True  # --fresh 로 끌 수 있음
try:
    _cache = json.load(open(_CACHE_FILE, encoding="utf-8")) if os.path.exists(_CACHE_FILE) else {}
except Exception:
    _cache = {}
_cache_dirty = 0


def _cache_fresh(rec):
    try:
        return (_dt.date.fromisoformat(c.TODAY) - _dt.date.fromisoformat(rec.get("_d", ""))).days <= _CACHE_TTL_DAYS
    except Exception:
        return False


def _cache_flush():
    try:
        json.dump(_cache, open(_CACHE_FILE, "w", encoding="utf-8"), ensure_ascii=False)
    except Exception:
        pass


# ── 자동완성(씨앗 → 세부키워드) ───────────────────────────────────────────────
def autocomplete(seed):
    """네이버 자동완성 → 세부키워드 리스트(씨앗 자신 제외)."""
    u = (
        f"https://ac.search.naver.com/nx/ac?q={quote(seed)}"
        "&con=1&frm=nx&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&st=100&run=2&rev=4&q_enc=UTF-8"
    )
    try:
        code, body = c._fetch_html(u)
        if code != 200:
            return []
        d = json.loads(body)
    except Exception:
        return []
    out = []
    for grp in d.get("items") or []:
        for row in grp:
            if isinstance(row, list) and row and isinstance(row[0], str):
                kw = row[0].strip()
                if kw and kw != seed:
                    out.append(kw)
    # 순서 유지 dedup
    seen = set()
    return [k for k in out if not (k in seen or seen.add(k))]


# ── 지역형 배제 + 니치 소싱(제목 마이닝 · 연관검색어) ─────────────────────────
# 지역 신호: 행정구역 접미(시/군/구/동/읍/면/리/도) 토큰 + 주요 도시·상권명.
_REGION_SUFFIX = re.compile(r"[가-힣]{1,4}(시|군|구|동|읍|면|리|도)\b")
_REGION_WORDS = set(
    "서울 부산 대구 인천 광주 대전 울산 세종 수원 성남 용인 고양 부천 안산 안양 남양주 화성 평택 "
    "의정부 파주 김포 광명 군포 하남 오산 이천 안성 포천 여주 양평 시흥 김해 창원 진주 양산 거제 "
    "천안 아산 청주 충주 전주 군산 익산 목포 여수 순천 포항 경주 구미 안동 강릉 원주 춘천 속초 제주 "
    "홍대 강남 이태원 성수 명동 신촌 건대 잠실 압구정 가로수길 연남 망원 을지로 종로 여의도 판교 "
    # 해변·관광·먹거리 지역(자동완성 지역형 누수 방지)
    "해운대 광안리 을왕리 오이도 영종도 대천 무창포 소래 소래포구 정동진 경포 협재 함덕 월정 서귀포 "
    "애월 강화 대부도 남해 통영 사천 삼천포 완도 보성 담양 곡성 남원 정읍 부안 고창 서산 태안 당진 "
    "예산 홍성 보령 단양 제천 영월 정선 태백 삼척 동해 양양 고성 인제 홍천 횡성 평창 가평 양주 동두천 "
    "구리 시흥 안양 의왕 과천 광양 나주 무안 영광 장흥 강진 해남 순창 임실 진안 함양 거창 합천 의령 "
    "함안 창녕 밀양 청도 영천 상주 문경 예천 영주 봉화 울진 영덕 청송 성주 칠곡 엑스포".split()
)
# 니치가 아닌 잡토큰(제목/연관에서 걸러낼 것) — 형용사·일반명사·메타.
_STOP = set(
    "추천 후기 모음 사랑 종류 서열 가격 순위 브랜드 명품 관련 개요 역사 취미 효과 용도 더보기 방법 "
    "좋은 좋아하는 고르는 최고 인기 요즘 올해 신상 문서 정보 검색 blog zip best top".split()
)


# 자주 붙는 상권·신도시·역세권(플레이스 키워드 지역 벗기기용)
_REGION_WORDS |= set(
    "송도 청라 영종 분당 판교 정자 정자역 수지 죽전 광교 동탄 위례 미사 다산 별내 향동 삼송 운정 "
    "김포한강 검단 배곧 영통 기흥 동백 세종시 송파 강동 서초 마포 용산 성동 광진 노원 도봉 강북 은평".split()
)


_REGION_TOK = re.compile(r"[가-힣]{2,4}(시|군|구|동|읍|면|리)$")

# 요리/레시피/판매 의도 — 식당 타겟 아님(항상 제외).
_OFFTOPIC = (
    "레시피", "만들기", "만드는법", "끓이는법", "끓이는", "육수", "소스", "양념", "재료", "손질",
    "밀키트", "택배", "배달", "세트", "보관", "냉동", "도구", "다이어트", "칼로리", "효능",
)


def is_offtopic(kw):
    """요리/레시피/판매 의도 키워드면 True(식당 타겟 제외)."""
    return any(s in kw for s in _OFFTOPIC)


def is_regional(kw):
    # 접미 행정구역은 '공백으로 분리된 place 토큰'에만 적용(역삼동 맛집). 붙은 복합어(배낚시·물회)는
    #   '시/구/동'으로 끝나도 지역이 아니므로 오판 금지 → 지역은 _REGION_WORDS(명시 목록)로만 판정.
    toks = kw.split()
    if len(toks) > 1 and any(_REGION_TOK.fullmatch(t) for t in toks):
        return True
    return any(w in kw for w in _REGION_WORDS)


def strip_region(kw):
    """'인천내성발톱'→'내성발톱', '분당수학학원'→'수학학원' 처럼 앞의 지역/상권 토큰을 벗겨 핵심 업종만."""
    core = kw.strip()
    for w in sorted(_REGION_WORDS, key=len, reverse=True):  # 긴 지역명 우선(정자역 > 정자)
        if core.startswith(w) and len(core) - len(w) >= 2:
            core = core[len(w):].strip()
            break
    core = re.sub(r"^[가-힣]{1,3}(시|군|구|동|읍|면|리)(?=[가-힣]{2,})", "", core)  # 접미 행정구역 접두
    return core.strip()


# 브랜드/고유명 니치 배제 — 사용자 요청: '니치향수·남자향수'(유형·속성) OK / '향수조말론·구어망드향수'
#   (브랜드·고유명) 배제. 일반 유형어만 남긴다. cafe_brand_block.txt(한 줄 1개, # 주석)로 무한 확장.
_BRAND = set(
    "샤넬 디올 조말론 딥디크 딥티크 톰포드 바이레도 크리드 입생로랑 랑방 불가리 에르메스 베르사체 "
    "안나수이 메종마르지엘라 마르지엘라 구찌 프라다 버버리 겔랑 펜할리곤스 아쿠아디파르마 르라보 "
    "산타마리아노벨라 루이비통 아르마니 조르지오아르마니 몽블랑 나르시소 마크제이콥스 로에베 끌로에 "
    "클로에 지방시 겐조 카르띠에 킬리안 프레데릭말 아닉구딸 세르주루텐 구어망드 올리브영 다이소".split()
)
_BRAND_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cafe_brand_block.txt")
try:
    if os.path.exists(_BRAND_FILE):
        with open(_BRAND_FILE, encoding="utf-8") as _f:
            _BRAND |= {ln.strip() for ln in _f if ln.strip() and not ln.lstrip().startswith("#")}
except Exception:
    pass


def is_brandish(kw):
    """키워드에 브랜드/고유명 토큰이 들어가면 True(=제외 대상)."""
    return any(b in kw for b in _BRAND)


# ── 네이버 플레이스(placeId) → 업체 키워드 ────────────────────────────────────
# 입력한 플레이스 주소/ID의 업종·플레이스키워드를 뽑아 인기탭 스캔 시드로 쓴다.
#   (place_rank_crawler 와 동일한 모바일 UA. m.place 홈 HTML의 keywordList/category 파싱.)
import requests  # noqa: E402

_PLACE_UA = (
    "Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36"
)


def parse_place_id(s):
    """map.naver.com/p/entry/place/1066951825…·숫자 ID·naver.me 단축링크 → placeId."""
    m = re.search(r"/place/(\d{6,})", s) or re.search(r"^\s*(\d{6,})\s*$", s)
    if m:
        return m.group(1)
    if "naver.me" in s or "://" in s:  # 단축/일반 링크 → 리다이렉트 최종 URL에서 추출
        try:
            r = requests.get(s.strip(), headers={"User-Agent": _PLACE_UA, "Accept-Language": "ko"}, allow_redirects=True, timeout=20)
            m = re.search(r"/place/(\d{6,})", r.url) or re.search(r"(\d{7,})", r.url)
            if m:
                return m.group(1)
        except Exception:
            return None
    m = re.search(r"\b(\d{6,})\b", s)
    return m.group(1) if m else None


def place_info(pid):
    """placeId → {name, cats, keywords}. m.place 홈 HTML 파싱."""
    u = f"https://m.place.naver.com/place/{pid}/home"
    try:
        r = requests.get(
            u,
            headers={"User-Agent": _PLACE_UA, "Accept-Language": "ko", "Referer": "https://m.place.naver.com/"},
            timeout=20,
        )
        r.encoding = "utf-8"
        body = r.text
    except Exception:
        return None
    if r.status_code != 200:
        return None
    name = (re.findall(r'"name"\s*:\s*"([^"]{1,40})"', body) or ["?"])[0]
    cats = list(dict.fromkeys(re.findall(r'"category"\s*:\s*"([^"]{1,20})"', body)))
    kws = []
    for blk in re.findall(r'"keywordList"\s*:\s*\[([^\]]{2,400})\]', body):
        kws += re.findall(r'"([^"]{2,20})"', blk)
    if not kws:
        for blk in re.findall(r'"keyword[s]?"\s*:\s*\[([^\]]{2,400})\]', body):
            kws += re.findall(r'"([^"]{2,20})"', blk)
    return {"pid": pid, "name": name, "cats": cats, "keywords": list(dict.fromkeys(kws))}


_SIDO = {"경기", "서울", "부산", "인천", "대구", "광주", "대전", "울산", "세종",
         "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"}


def place_address(pid):
    """placeId → (도로명, 지번) 주소. map summary API."""
    u = f"https://map.naver.com/p/api/place/summary/{pid}?lang=ko"
    try:
        r = requests.get(u, headers={"User-Agent": _PLACE_UA, "Accept-Language": "ko", "Referer": "https://map.naver.com/"}, timeout=15)
        r.encoding = "utf-8"
        b = r.text
    except Exception:
        return "", ""
    road = (re.findall(r'"roadAddress"\s*:\s*"([^"]{6,60})"', b) or [""])[0]
    jibun = (re.findall(r'"address"\s*:\s*"([^"]{6,60})"', b) or [""])[0]
    return road, jibun


def region_tokens(road, jibun):
    """주소 → [시, 구, 동, 상권] 지역 토큰(광역시/도 제외). 예: 안산·상록구·이동·광덕."""
    text = (road or "") + " " + (jibun or "")
    out = []

    def push(t):
        if t and t not in out and t not in _SIDO:
            out.append(t)

    for m in re.finditer(r"([가-힣]{2,4})(?:시|군)(?=\s)", text):  # 안산시→안산, 양양군→양양
        push(m.group(1))
    for m in re.finditer(r"([가-힣]{1,3}구)(?=\s)", text):  # 상록구
        push(m.group(1))
    for m in re.finditer(r"([가-힣]{1,3}동)(?=\s)", text):  # 지번의 법정동: 이동
        push(m.group(1))
    for m in re.finditer(r"([가-힣]{2,3})\d*(?:로|길)(?=\s)", text):  # 광덕1로→광덕
        t = m.group(1)
        if not t.endswith(("대", "소", "중", "번", "센", "타")):  # 대로/번길/센터·타워 도로명 파편 배제
            push(t)
    return out


# ── 넓은→좁은 계층(도·시·구·동 × 맛집·업종맛집·횟집·업종) ────────────────────
_PROVINCES = {"경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"}
_FOOD_HINT = set(
    "회 횟집 생선 조개 해물 음식 요리 고기 식당 한식 일식 중식 양식 분식 카페 디저트 치킨 피자 찜 탕 "
    "구이 국밥 국수 냉면 초밥 스시 파스타 스테이크 술집 포차 뷔페 삼겹 곱창 막창 쭈꾸미 낙지 족발 보쌈 "
    "김밥 떡볶이 만두 베이커리 브런치 전골 매운탕 물회 삼합 게장 곰탕 설렁탕 감자탕 부대찌개".split()
)


def _sido(road, jibun):
    toks = (road or jibun or "").split()
    return toks[0] if toks and toks[0] in _SIDO else ""


def region_hierarchy(road, jibun):
    """넓은→좁은 지역 계층 [도(경기도/경기), 시, 구, 동/상권]."""
    sido = _sido(road, jibun)
    out = []
    if sido:
        out.append(sido + "도" if sido in _PROVINCES else sido)  # 경기→경기도, 서울→서울
        if sido in _PROVINCES:
            out.append(sido)  # 경기 형태도(경기 회 맛집)
    out += region_tokens(road, jibun)  # 시·구·동·상권
    return out


def business_hierarchy(cats, keywords=()):
    """넓은→좁은 업종 계층. 음식점=맛집→업종맛집→(회맛집·횟집)→업종→요리맛집(광어맛집)→요리(광어).
    비음식=업종→세부(플레이스키워드)."""
    food = any(any(h in c for h in _FOOD_HINT) for c in cats)
    levels = []
    if food:
        levels.append("맛집")
        for c in cats:
            levels.append(c + " 맛집")  # 생선회 맛집
        if any("회" in c for c in cats):
            levels += ["회 맛집", "횟집"]
    for c in cats:
        levels.append(c)  # 생선회
    for c in cats:  # 업종 축약 코어(인테리어디자인→인테리어, 수학교육→수학, 조개요리→조개)
        core = c
        for suf in ("디자인", "교육", "요리", "전문점", "전문", "공사", "서비스", "센터"):
            if core.endswith(suf) and len(core) - len(suf) >= 2:
                core = core[: -len(suf)]
                break
        if core != c:
            levels.append(core)
            if food:
                levels.append(core + " 맛집")
    for k in keywords:  # 세부 요리 × 맛집(광어맛집·매운탕맛집) + 요리 단독(광어)
        if is_brandish(k):
            continue
        if food:
            levels.append(k + "맛집")
        levels.append(k)
    seen = set()
    return [x for x in levels if x and not (x in seen or seen.add(x))]


# ── 검색광고 keywordstool 소싱(검색량 기반) ──────────────────────────────────
# 배포 CF 함수(ddmkt-erp.pages.dev/api/naver-keywords) 프록시 호출 → 연관키워드+월검색량.
#   ※ 공식 검색광고 API(HMAC 인증)라 IP 차단 위험 없음. 호출도 CF서버에서 나가 우리 IP 미노출.
#   ※ 연관성이 느슨(배낚시→가볼만한곳)해서 '업종 코어 포함' + 검색량 임계로 걸러 온-토픽만.
_AD_ENDPOINT = "https://ddmkt-erp.pages.dev/api/naver-keywords"
_ad_cache = {}


def searchad_keywords(seed):
    """검색광고 연관키워드 [{keyword,total,pc,mobile,comp}] (검색량순). 캐시."""
    if seed in _ad_cache:
        return _ad_cache[seed]
    try:
        r = requests.get(f"{_AD_ENDPOINT}?q={quote(seed)}", timeout=25)
        rows = r.json().get("keywords", []) if r.status_code == 200 else []
    except Exception:
        rows = []
    _ad_cache[seed] = rows
    return rows


def searchad_candidates(root, min_total=100, limit=25):
    """업종 코어(root)로 검색광고 연관키워드 → root 포함 + 검색량≥min_total + 브랜드/닉네임 제외.
    검색량 순으로 반환(=헛스캔 줄이고 진짜 쓸 키워드 우선). [(keyword, total)]."""
    out = []
    for r in searchad_keywords(root):
        kw = (r.get("keyword") or "").strip()
        tot = r.get("total", 0)
        if not kw or tot < min_total:
            continue
        if root not in kw:  # 온-토픽만(업종 코어 포함) — 배낚시→가볼만한곳 같은 이탈 차단
            continue
        if is_brandish(kw) or _nickish(root, kw) or is_offtopic(kw):  # 요리/레시피/판매 제외
            continue
        out.append((kw, tot))
    return out[:limit]


def related_keywords(seed):
    """SERP 연관검색어 → 씨앗과 결합할 수식어 후보(정제)."""
    url = f"https://m.search.naver.com/search.naver?query={quote(seed)}"
    try:
        _code, html = c._fetch_html(url)
    except Exception:
        return []
    # relateKeyword/relatedKeyword 전용(예전 'text' 필드는 카페명·닉네임까지 잡아 노이즈 → 제외).
    rel = re.findall(r'"relate[dD]?[kK]eyword[^"]*"\s*:\s*"([^"]{2,12})"', html)
    rel += re.findall(r'"relationKeywords?"\s*:\s*\[([^\]]{2,300})\]', html)
    rel = [w for chunk in rel for w in re.findall(r'[가-힣]{2,8}', chunk)]
    out = []
    for w in rel:
        w = w.strip()
        if not re.fullmatch(r"[가-힣]{2,8}", w):  # 한글 전용(영문 파편 min·channels 배제)
            continue
        if w == seed or w in _STOP or is_regional(w):
            continue
        out.append(w)
    seen = set()
    return [w for w in out if not (w in seen or seen.add(w))]


def mine_niches(seed):
    """씨앗의 '인기글' 제목에서 (수식어+씨앗) 형태의 니치를 캐낸다(예: 향수→고체향수·중동향수)."""
    url = f"https://m.search.naver.com/search.naver?query={quote(seed)}"
    try:
        _code, html = c._fetch_html(url)
    except Exception:
        return []
    titles = []
    for b in c.extract_bootstrap_json(html):
        try:
            j = json.loads(b)
        except Exception:
            continue
        if not c._is_popular_section(j):
            continue

        def w(o):
            if isinstance(o, dict):
                t = o.get("title") or o.get("subject")
                if isinstance(t, str) and t.strip():
                    titles.append(re.sub(r"</?mark>|&quot;", "", t).strip())
                for k, v in o.items():
                    if k in c._PRIMARY_EXCLUDE_KEYS:
                        continue
                    w(v)
            elif isinstance(o, list):
                for x in o:
                    w(x)

        w(j)
    cands = []
    for t in titles:
        for m in re.finditer(rf"([가-힣]{{2,6}})\s?{seed}", t):  # 수식어+씨앗(한글 전용)
            mod = m.group(1)
            if not mod or mod == seed or mod in _STOP or is_regional(mod):
                continue
            if mod.endswith(("맘", "님", "네", "씨", "러", "족", "일상")):  # 작성자 닉네임 파편 배제
                continue
            cands.append((mod + seed).replace(" ", ""))
    seen = set()
    return [k for k in cands if not (k in seen or seen.add(k))]


_NICK_SUFFIX = ("맘", "님", "네", "씨", "러", "족", "일상", "이네", "food", "tv")


def _nickish(seed, k):
    """씨앗을 뺀 수식어가 작성자/식당 닉네임 파편처럼 보이면 True(=제외)."""
    mod = k.replace(seed, "").strip()
    return bool(mod) and mod.endswith(_NICK_SUFFIX)


def niche_candidates(seed, limit=18, mine=False):
    """씨앗 → 지역형·브랜드·닉네임 배제한 유형 니치 후보.
    기본 소스 = 자동완성(접두 복합어) + 연관검색어(수식어 결합). 깨끗함.
    mine=True 면 인기글 제목 마이닝도 추가(향수→남자향수처럼 접미형까지 잡지만 식당명 노이즈 섞임)."""
    out = []
    seen = set()

    def add(k):
        # 지역형도 허용(인기탭만 잡히면 OK). 브랜드/고유명·닉네임 파편만 배제.
        if k and k not in seen and (k == seed or (not is_brandish(k) and not _nickish(seed, k))):
            seen.add(k)
            out.append(k)

    add(seed)
    for k in autocomplete(seed):  # 실검 복합어(차돌삼합·조개구이 무한리필 등) — 깨끗
        add(k)
    for w in related_keywords(seed):  # 연관 수식어 결합
        add(w + seed)
        add(seed + w)
    if mine:
        for k in mine_niches(seed):  # 제목 마이닝(노이즈 가능) — 옵션
            add(k)
    return out[:limit]


def expand(seeds, depth):
    """씨앗들을 depth 단계까지 자동완성으로 확장. depth=0 이면 씨앗 그대로."""
    result = []
    seen = set()

    def add(k):
        if k not in seen:
            seen.add(k)
            result.append(k)

    for s in seeds:
        add(s)
    if depth <= 0:
        return result
    frontier = list(seeds)
    for _ in range(depth):
        nxt = []
        for kw in frontier:
            for sub in autocomplete(kw):
                if sub not in seen:
                    add(sub)
                    nxt.append(sub)
            c._pause(0.6)
        frontier = nxt
    return result


# ── 인기글 섹션 스캔(1 키워드) ────────────────────────────────────────────────
def _section_title(j):
    hit = []

    def w(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "subjectTitle" and isinstance(v, str) and "인기글" in v:
                    hit.append(v.strip())
                w(v)
        elif isinstance(o, list):
            for x in o:
                w(x)

    w(j)
    return hit[0] if hit else None


def _rank_rows(j):
    """섹션 블록 → {원본r: {url, title}} (카페/블로그 링크가 붙은 카드만)."""
    rows = {}

    def w(o):
        if isinstance(o, dict):
            r = c._node_min_r(o)
            if isinstance(r, (int, float)) and not isinstance(r, bool) and r:
                title = o.get("title") or o.get("subject") or ""
                for kk in c._PRIMARY_NAV_FIELDS:
                    v = o.get(kk)
                    if isinstance(v, str) and ("cafe.naver.com" in v or "blog.naver.com" in v):
                        cur = rows.setdefault(int(r), {"url": v, "title": title})
                        if title and not cur.get("title"):
                            cur["title"] = title
            for kk, v in o.items():
                if kk in c._PRIMARY_EXCLUDE_KEYS:
                    continue
                w(v)
        elif isinstance(o, list):
            for x in o:
                w(x)

    w(j)
    return rows


def classify(kw):
    """키워드 1개 → 인기탭 판정 dict. 캐시 히트면 스크랩 생략(차단 위험↓).
    {kw, has_section, theme, n_ad, n_organic, rows:[{rank,kind,who,article,title}], verdict, err}."""
    global _cache_dirty
    if _USE_CACHE:
        rec = _cache.get(kw)
        if rec and _cache_fresh(rec):
            return rec
    result = _classify_live(kw)
    if _USE_CACHE and not result.get("err"):  # 에러/일시실패는 캐시 안 함
        result["_d"] = c.TODAY
        _cache[kw] = result
        _cache_dirty += 1
        if _cache_dirty % 15 == 0:
            _cache_flush()
    return result


# ── 호스트 로테이션 SERP fetch (m.search ↔ PC search, 부하 분산·차단 완화) ──────
# 두 호스트 모두 인기글 섹션을 동일하게 주고 파서도 동일(검증됨). 키워드마다 번갈아 요청해
#   각 호스트 부하를 절반으로 → rate limit 도달을 늦춘다. 한쪽 차단 시 다른 호스트로 폴백.
_PC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
_CF_SERP = "https://ddmkt-erp.pages.dev/api/serp-probe"  # CF 경유 스크랩(분산 IP)
_SERP_TOKEN = os.getenv("SERP_TOKEN", "")  # CF env SERP_TOKEN 과 일치해야(설정 시)
_USE_CF = False  # --cf 로 켬. True=CF경유(즉시/온디맨드), False=사무실 직접(미리크롤·정공법)
_serp_rr = [0]


def _is_blocked(status, text):
    return status in (403, 429) or "제한되었습니다" in text or "과도한 접근" in text


def _fetch_direct(pc, kw):
    """사무실 IP 직접 스크랩(m.search 또는 PC search)."""
    base = "https://search.naver.com/search.naver?query=" if pc else "https://m.search.naver.com/search.naver?query="
    try:
        r = requests.get(base + quote(kw), headers={"User-Agent": _PC_UA if pc else _PLACE_UA}, timeout=20)
    except Exception:
        return 0, ""
    return (200, r.text) if r.status_code == 200 and not _is_blocked(r.status_code, r.text) else (r.status_code, "")


def _fetch_cf(pc, kw):
    """CF 경유 스크랩(CF 분산 IP). CF 함수가 HTML 반환. 콜드스타트/일시실패 1회 재시도."""
    u = f"{_CF_SERP}?q={quote(kw)}&host={'pc' if pc else 'm'}" + (f"&token={_SERP_TOKEN}" if _SERP_TOKEN else "")
    for attempt in range(2):
        try:
            r = requests.get(u, timeout=40)  # 1.5MB HTML 반환 → 여유 타임아웃
            if r.status_code == 200:
                d = r.json()
                if d.get("blocked"):
                    return 429, ""  # 차단은 재시도 무의미
                if d.get("status") == 200 and d.get("html"):
                    return 200, d["html"]
        except Exception:
            pass
        if attempt == 0:
            c._pause(1.5)  # 콜드스타트 대비 잠깐 쉬고 재시도
    return 0, ""


def _fetch_serp(kw):
    """인기글 SERP 가져오기. --cf면 CF경유(즉시용), 아니면 사무실 직접(미리크롤용).
    각 모드에서 m.search↔PC 호스트 로테이션 + 실패 시 다른 호스트 폴백."""
    pc = (_serp_rr[0] % 2 == 1)
    _serp_rr[0] += 1
    fetch = _fetch_cf if _USE_CF else _fetch_direct
    for p in (pc, not pc):  # 이번 차례 호스트, 실패 시 다른 호스트
        code, html = fetch(p, kw)
        if code == 200 and html:
            return 200, html
    return 0, ""


def _classify_live(kw):
    """실제 인기탭 스크랩 판정(캐시 미스 시만 호출). 호스트 로테이션 사용."""
    code, html = _fetch_serp(kw)
    if code != 200:
        return {"kw": kw, "err": f"code {code}(차단?)", "has_section": False}
    for b in c.extract_bootstrap_json(html):
        try:
            j = json.loads(b)
        except Exception:
            continue
        if not c._is_popular_section(j):
            continue
        theme = _section_title(j) or "?"
        ads = c._ad_ranks_cafe(j)
        cards = c._ugb_cards_cafe(j)  # {원본r: set((vanity,club,article))}
        raw = _rank_rows(j)
        organic = sorted(r for r in cards.keys() | raw.keys() if r not in ads)
        pos = {r: i + 1 for i, r in enumerate(organic)}
        rows = []
        for r in organic:
            u = raw.get(r, {}).get("url", "")
            title = re.sub(r"</?mark>|&quot;", "", raw.get(r, {}).get("title", "")).strip()
            kind = "카페" if "cafe.naver.com" in u else ("블로그" if "blog.naver.com" in u else "?")
            who, article = "", ""
            for (nm, _club, art) in cards.get(r, set()):
                who, article = nm or who, art or article
                kind = "카페"
            if not who:
                m = re.search(r"(?:cafe|blog)\.naver\.com/([^/?\"]+)(?:/(\d+))?", u)
                if m:
                    who, article = m.group(1), m.group(2) or ""
            rows.append({"rank": pos[r], "kind": kind, "who": who, "article": article, "title": title})
        # 판정
        cafe_rows = [x for x in rows if x["kind"] == "카페"]
        if not cafe_rows:
            verdict = "블로그섹션(카페없음)"
        else:
            from collections import Counter

            cnt = Counter(x["who"] for x in cafe_rows if x["who"])
            top, n = (cnt.most_common(1)[0] if cnt else ("", 0))
            verdict = f"카페독점({top})" if n >= 3 else "카페분산(기회)"
        return {
            "kw": kw, "has_section": True, "theme": theme,
            "n_ad": len(ads), "n_organic": len(organic), "rows": rows, "verdict": verdict,
        }
    return {"kw": kw, "has_section": False, "verdict": "섹션없음(광고·브랜드콘텐츠)"}


# ── 표 출력 ───────────────────────────────────────────────────────────────────
def scan(keywords, verbose=True):
    results = []
    for kw in keywords:
        cached = _USE_CACHE and kw in _cache and _cache_fresh(_cache[kw])
        r = classify(kw)
        results.append(r)
        if verbose:
            if r.get("err"):
                print(f"  [{kw}] ⚠ 오류 {r['err']}", flush=True)
            elif not r["has_section"]:
                print(f"  [{kw}] ❌ {r['verdict']}", flush=True)
            else:
                occ = ", ".join(
                    f"{x['rank']}위:{x['who']}" for x in r["rows"] if x["kind"] == "카페"
                ) or "(카페 없음)"
                print(
                    f"  [{kw}] ✅ 「{r['theme']}」 광고{r['n_ad']}·유기{r['n_organic']} | {r['verdict']} | {occ}",
                    flush=True,
                )
        if not cached:  # 캐시 히트면 스크랩 안 했으니 대기 불필요
            c._pause(1.2)
    _cache_flush()
    return results


# ── 목표 건수까지만 스캔(수요 기반 = 스크랩 최소화·차단 회피) ────────────────
def scan_until(candidates, target, cap=None, verbose=True):
    """검색량순 후보를 위에서부터 스캔하다가 '카페분산(진입기회)' target건을 찾으면 멈춘다.
    cap = 실제 스크랩(라이브) 상한(히트율 낮아도 폭주 방지). 캐시 히트는 상한/대기에서 제외."""
    cap = cap or max(target * 8, 30)  # 안전 상한: 목표의 8배(히트율 12%도 커버) 또는 최소 30
    found, live = [], 0
    seen_norm = set()  # 붙임/띄어쓰기 중복 제거(군산 맛집 == 군산맛집)
    for kw in candidates:
        if len(found) >= target or live >= cap:
            break
        norm = kw.replace(" ", "")
        if norm in seen_norm:  # 같은 컨셉의 띄어쓰기 변형은 건너뜀(스캔·카운트 중복 방지)
            continue
        seen_norm.add(norm)
        cached = _USE_CACHE and kw in _cache and _cache_fresh(_cache[kw])
        r = classify(kw)
        if not cached:
            live += 1
        # 요리·레시피 인기글은 식당 타겟 아님 → 발견에서 제외.
        if r.get("has_section") and str(r.get("verdict", "")).startswith("카페분산") and "레시피" not in (r.get("theme") or ""):
            found.append(r)
            if verbose:
                occ = ", ".join(f"{x['rank']}위:{x['who']}" for x in r["rows"] if x["kind"] == "카페") or "(카페없음)"
                print(f"    ✅[{len(found)}/{target}] [{kw}] 「{r['theme']}」 | {occ}", flush=True)
        elif verbose:
            print(f"    · [{kw}] {'(캐시)' if cached else ''}{r.get('verdict', '') or r.get('err', '')}", flush=True)
        if not cached:  # 캐시 히트는 대기 불필요
            c._pause(1.2)
    _cache_flush()
    if verbose:
        print(f"  → {len(found)}건 발견 (라이브 스크랩 {live}건, 상한 {cap})", flush=True)
    return found


# ── 심층 스캔(인기탭 있는 키워드만 재귀 확장 = 세부까지 loop-until-dry) ──────────
def deep_scan(seeds, max_kw=70, rounds=4, verbose=True):
    """인기탭이 잡힌 키워드만 자동완성으로 계속 확장해 세부 키워드를 더 캐낸다.
    (섹션없는 키워드는 확장 안 함 → 헛발질 최소화. 새 인기탭이 안 나올 때까지 반복.)"""
    seen = set()
    found = {}
    frontier = list(dict.fromkeys(seeds))
    rnd = 0
    while frontier and rnd < rounds and len(seen) < max_kw:
        rnd += 1
        if verbose:
            print(f"  ── 라운드 {rnd} · 후보 {len(frontier)}개 (누적 스캔 {len(seen)}) ──", flush=True)
        nxt = []
        for kw in frontier:
            if kw in seen or len(seen) >= max_kw:
                continue
            seen.add(kw)
            cached = _USE_CACHE and kw in _cache and _cache_fresh(_cache[kw])
            r = classify(kw)
            if r.get("has_section"):
                found[kw] = r
                if verbose:
                    occ = ", ".join(f"{x['rank']}위:{x['who']}" for x in r["rows"] if x["kind"] == "카페") or "(카페없음)"
                    print(f"    ✅ [{kw}] 「{r['theme']}」 {r['verdict']} | {occ}", flush=True)
                # 인기탭 있는 '승자'만 자동완성으로 더 파고든다(세부 키워드 발굴).
                for sub in autocomplete(kw):
                    if sub not in seen and not is_brandish(sub) and not _nickish(kw, sub):
                        nxt.append(sub)
            if not cached:  # 캐시 히트면 스크랩 안 했으니 대기 불필요(속도↑)
                c._pause(1.1)
        frontier = list(dict.fromkeys(nxt))
    _cache_flush()
    return list(found.values())


# ── QA 자기검증 ───────────────────────────────────────────────────────────────
def self_test():
    """알려진 키워드로 파이프라인 검증. SERP 변동 가능 → 실패 시 단정 말고 보고."""
    print("=== QA self-test ===", flush=True)
    ok = 0
    total = 0

    def check(name, cond):
        nonlocal ok, total
        total += 1
        ok += 1 if cond else 0
        print(f"  [{'PASS' if cond else 'FAIL'}] {name}", flush=True)

    ac = autocomplete("향수")
    check(f"자동완성('향수') 비어있지 않음 ({len(ac)}개)", len(ac) > 0)
    c._pause(1.0)

    cases = [
        ("맛집", True, "맛집"),        # 맛집 인기글
        ("향수", True, "패션"),        # 패션·미용 인기글
        ("고체향수", True, None),      # 같은 섹션, 세부키워드도 인기글 있음
        ("다이어트", False, None),     # 인기글 없음(브랜드콘텐츠)
        ("임플란트", False, None),     # 인기글 없음
    ]
    for kw, want_section, theme_kw in cases:
        r = classify(kw)
        cond = r.get("has_section") == want_section
        if cond and theme_kw:
            cond = theme_kw in (r.get("theme") or "")
        detail = r.get("theme") if r.get("has_section") else r.get("verdict")
        check(f"classify('{kw}') 인기글={want_section} → {detail}", cond)
        c._pause(1.2)

    print(f"\n=== 결과 {ok}/{total} 통과 ===", flush=True)
    return ok == total


def main():
    args = sys.argv[1:]
    if "--self-test" in args:
        self_test()
        return
    no_expand = "--no-expand" in args
    depth = 1
    if "--depth" in args:
        try:
            depth = int(args[args.index("--depth") + 1])
        except Exception:
            depth = 1
    mx = 40
    if "--max" in args:
        try:
            mx = int(args[args.index("--max") + 1])
        except Exception:
            mx = 40
    target = 0  # --target N: 카페분산 N건 찾으면 중단(수요 기반·스크랩 최소화)
    if "--target" in args:
        try:
            target = int(args[args.index("--target") + 1])
        except Exception:
            target = 0
    niche = "--niche" in args
    place = "--place" in args
    mine = "--mine" in args  # 제목 마이닝 추가(노이즈 감수·접미형 니치)
    deep = "--deep" in args  # 심층: 인기탭 승자만 재귀 확장(세부 발굴)
    ad = "--ad" in args  # 검색광고 keywordstool 소싱(검색량 기반·온토픽)
    global _USE_CACHE, _USE_CF
    if "--fresh" in args:  # 캐시 무시하고 강제 재스캔
        _USE_CACHE = False
    if "--cf" in args:  # CF 경유 스크랩(즉시/온디맨드). 기본은 사무실 직접(미리크롤)
        _USE_CF = True
    seeds = [a for i, a in enumerate(args) if not a.startswith("--") and args[i - 1] not in ("--depth", "--max", "--target")]
    if not seeds:
        print("사용법: python cafe_kw_probe.py <씨앗|플레이스URL> [--place] [--niche] [--depth N] [--max N] | --self-test")
        return
    if place:  # 플레이스 주소/ID → 업종·플레이스키워드로 인기탭 스캔
        pid = parse_place_id(seeds[0])
        info = place_info(pid) if pid else None
        if not info:
            print(f"플레이스 조회 실패: {seeds[0]} (placeId 추출/조회 불가)")
            return
        print(f"=== 플레이스 {pid} · {info['name']} ({', '.join(info['cats'][:3]) or '업종?'}) ===", flush=True)
        print(f"  플레이스 키워드: {', '.join(info['keywords'][:15]) or '(없음)'}", flush=True)
        # 플레이스 키워드는 통째로 시드(광교횟집 그대로 → 그 지역 그대로 검색·정확). 지역 벗기지 않음.
        #   업종(category)은 콤마/·로 분리. 브랜드만 제외, 지역형은 허용(인기탭만 있으면).
        cats = [c.strip() for cc in info["cats"][:2] for c in re.split(r"[,·/]", cc) if c.strip()]
        road, jibun = place_address(pid)
        regs = region_tokens(road, jibun)
        if road or jibun:
            print(f"  주소: {road or jibun} → 지역토큰: {', '.join(regs) or '(없음)'}", flush=True)
        # ① 넓은→좁은 계층 먼저: (도·시·구·동) × (맛집·업종맛집·회맛집·횟집·업종).
        #    업종(넓은→좁은) 바깥, 지역(넓은→좁은) 안쪽 → 경기도 맛집·수원 맛집…·경기 회 맛집…·수원 횟집.
        rh = region_hierarchy(road, jibun)
        bh = business_hierarchy(cats, info["keywords"])
        hier = []
        for bt in bh:  # 업종(넓은→좁은): 맛집→업종맛집→회맛집→횟집→업종→요리맛집(광어맛집)→요리
            if bt != "맛집":  # '맛집' 단독(전국)은 너무 넓어 제외, 나머지는 전국 단독도
                hier.append(bt)
            for rl in rh:  # 지역(넓은→좁은): 경기도→경기→시→구→동→상권
                hier.append(f"{rl} {bt}")
                if " " not in bt:  # 단어형 업종은 붙임형도(수원매운탕맛집·수원광어)
                    hier.append(f"{rl}{bt}")
        if hier:
            print(f"  계층 {len(hier)}개(넓은→좁은): {', '.join(hier[:8])}…", flush=True)
        base = []
        for k in hier + cats + info["keywords"]:  # 계층 먼저(넓은→좁은) → 플레이스 키워드
            if k and not is_brandish(k) and not is_offtopic(k) and k not in base:  # 요리/레시피/판매 제외
                base.append(k)
        # 검색광고 소싱 — 업종 코어(category+플레이스키워드)별 연관키워드(검색량순·온토픽)로 보강.
        ad_vol = {}
        if ad:
            # 검색광고 코어 = 업종(category) + 축약코어(인테리어디자인→인테리어) + 플레이스키워드.
            extra = []
            for c0 in cats:
                core = c0
                for suf in ("디자인", "교육", "요리", "전문점", "전문", "공사", "서비스", "센터"):
                    if core.endswith(suf) and len(core) - len(suf) >= 2:
                        core = core[: -len(suf)]
                        break
                if core != c0 and core not in extra:
                    extra.append(core)
            cores = [k for k in (cats + extra + info["keywords"]) if len(k) >= 2 and not is_brandish(k)][:8]
            for up in cores:
                for kw, tot in searchad_candidates(up):
                    ad_vol[kw] = tot
                    if kw not in base:
                        base.append(kw)
            if ad_vol:
                top = sorted(ad_vol.items(), key=lambda x: -x[1])[:10]
                print(f"  검색광고 연관(검색량순): {', '.join(f'{k}({v})' for k, v in top)}", flush=True)
        if target:  # 수요 기반: N건 찾으면 중단(스크랩 최소화)
            # 로컬 우선 정렬: ① 우리 지역토큰 포함(넓은→좁은) → ② 검색광고 검색량순 니치 → ③ 나머지.
            regset = set(regs) | set(region_hierarchy(road, jibun))
            local = [k for k in base if any(rt and rt in k for rt in regset)]
            adkw = [k for k, _ in sorted(ad_vol.items(), key=lambda x: -x[1]) if k in base and k not in local]
            ordered = local + adkw
            for k in base:  # 혹시 빠진 나머지
                if k not in ordered:
                    ordered.append(k)
            print(f"\n=== 목표 {target}건까지 스캔 (로컬 우선 → 검색량순 · 발견 시 중단) ===", flush=True)
            results = scan_until(ordered, target)
            print("\n=== 요약 ===", flush=True)
            print(f"  업체: {info['name']} · {', '.join(info['cats'][:3])}", flush=True)
            print(f"  🎯 발견 {len(results)}/{target}건: {', '.join(r['kw'] for r in results) or '없음'}", flush=True)
            return
        if deep:  # 심층: 인기탭 승자만 재귀 확장(세부까지 loop-until-dry)
            cap = mx if mx > 40 else 80
            print(f"\n=== 심층 인기탭 스캔 (재귀 확장 · 최대 {cap}키워드) ===", flush=True)
            results = deep_scan(base, max_kw=cap)
        else:
            if niche:  # 각 업체 키워드를 니치까지 확장
                kws = []
                for s in base:
                    for k in niche_candidates(s, 6, mine):
                        if k not in kws:
                            kws.append(k)
            else:
                kws = base
            kws = kws[:mx]
            print(f"\n=== 인기탭 스캔 · 시드 {len(kws)}{' (니치 확장)' if niche else ''} ===", flush=True)
            results = scan(kws)
        farm = [r for r in results if r.get("has_section") and r.get("verdict", "").startswith("카페분산")]
        blogonly = [r for r in results if r.get("verdict", "").startswith("블로그섹션")]
        print("\n=== 요약 ===", flush=True)
        print(f"  업체: {info['name']} · {', '.join(info['cats'][:3])}", flush=True)
        print(f"  인기탭 있음: {sum(1 for r in results if r.get('has_section'))}/{len(results)}", flush=True)
        print(f"  🎯 진입 기회(카페 분산): {', '.join(r['kw'] for r in farm) or '없음'}", flush=True)
        print(f"  🟡 블로그섹션(카페 무경쟁): {', '.join(r['kw'] for r in blogonly) or '없음'}", flush=True)
        return
    if niche:  # 지역형 배제 + 상품/유형 니치(향수→고체향수 방식)
        kws = []
        seen = set()
        for s in seeds:
            for k in niche_candidates(s, mx, mine):
                if k not in seen:
                    seen.add(k)
                    kws.append(k)
        mode = " (니치 · 지역형 배제)"
    elif no_expand:
        kws = seeds[:mx]
        mode = " (확장없음)"
    else:
        kws = expand(seeds, depth)[:mx]
        mode = f" (자동완성 depth {depth})"
    print(f"=== 인기탭 스캔 · 씨앗 {seeds} → 대상 {len(kws)}키워드{mode} ===", flush=True)
    results = scan(kws)
    # 씨앗과 같은 카테고리 테마만 진짜 니치 — 다른 테마로 새는 고유명(정지용향수=문학·책 등) 배제.
    seed_cat = ""
    if niche and results:
        seed_r = next((r for r in results if r["kw"] in seeds and r.get("has_section")), results[0])
        seed_cat = (seed_r.get("theme") or "").replace("인기글", "").strip()

    def same_cat(r):
        return not seed_cat or seed_cat in (r.get("theme") or "")

    farm = [
        r for r in results
        if r.get("has_section") and r.get("verdict", "").startswith("카페분산") and same_cat(r)
    ]
    offcat = [
        r for r in results
        if r.get("has_section") and r.get("verdict", "").startswith("카페분산") and not same_cat(r)
    ]
    blogonly = [r for r in results if r.get("verdict", "").startswith("블로그섹션") and same_cat(r)]
    print("\n=== 요약 ===", flush=True)
    print(f"  인기탭 있음: {sum(1 for r in results if r.get('has_section'))}/{len(results)}", flush=True)
    if seed_cat:
        print(f"  씨앗 카테고리: {seed_cat}", flush=True)
    print(f"  🎯 진입 기회(같은 카테고리·카페 분산): {', '.join(r['kw'] for r in farm) or '없음'}", flush=True)
    print(f"  🟡 블로그섹션(카페 무경쟁): {', '.join(r['kw'] for r in blogonly) or '없음'}", flush=True)
    if niche and offcat:
        print(f"  ⚪ 다른 카테고리로 샘(참고·제외): {', '.join(r['kw'] for r in offcat)}", flush=True)


if __name__ == "__main__":
    main()
