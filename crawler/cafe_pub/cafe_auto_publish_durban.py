# -*- coding: utf-8 -*-
"""카페 자동발행 오케스트레이터 (로컬) — 더반클린 입주청소 전용.
   업종+지역리스트 → 인기글 뜨는 지역만 필터(PC lb_api, 브라우저X) → 통과 지역만
   원고(gpt-5-mini, 2000자+ 보장) + 배너(고정 브랜드 배너 지역 글자 교체) 생성 → 미세변형(varyImage) →
   cafe-images 업로드 + cafe_publish_queue 적재. 발행은 publish_listener 가 처리.

실행:  python cafe_auto_publish_durban.py            # 기본 지역리스트에서 통과분 2개 발행 등록
       python cafe_auto_publish_durban.py --limit 2 --regions 안양,과천,구로,잠실
전제:  ../.env(OPENAI_API_KEY) + ../../.env(SUPABASE) + api:dev(:8787) 실행 중 + SQL 완료.
"""
import argparse
import base64
import html as htmlmod
import io
import json
import os
import random
import re
import sys
import time
import uuid
from urllib.parse import quote

import requests
import truststore
truststore.inject_into_ssl()
from PIL import Image, ImageEnhance, ImageOps

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
requests.packages.urllib3.disable_warnings()

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
FIXED_DIR = "C:/Users/rlawh/sub2/public/images/theban/theban_real"
CAFE_BUCKET = "cafe-images"
UA_PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"

# 업체 고정정보 — 전화는 본문엔 안 넣고(_strip_phone) 글 맨 끝 '푸터'로만 붙인다.
BUSINESS, BRAND, PHONE = "입주청소", "더반클린", "070-7977-2739"

# ── env ──
def _load_env():
    for p in [os.path.join(HERE, "..", ".env"), os.path.join(HERE, ".env"), os.path.join(ROOT, ".env")]:
        try:
            for line in open(p, encoding="utf-8", errors="ignore"):
                m = re.match(r'^([A-Z_]+)\s*=\s*"?([^"\n\r]+)"?', line)
                if m and m.group(1) not in os.environ:
                    os.environ[m.group(1)] = m.group(2).strip()
        except Exception:
            pass
# 공용 cafe_pub/.env 는 누수 값(CAFE_FIXED_DIR=nusu-real, CAFE_BOARD=누수)을 갖는다.
#   더반 기본값을 _load_env 前에 못박아 .env 가 덮지 못하게 한다(shell 에서 명시 지정 시 그게 우선).
for _k, _v in {"CAFE_FIXED_DIR": FIXED_DIR, "CAFE_BOARD": "더반클린 입주청소",
               "CAFE_COMPANY": "durban", "CAFE_SPLIT_COMPOSITE": "0", "CAFE_LINK_RATE": "0",
               "CAFE_PHOTO_WIDTH": "1254"}.items():  # 실사진 폭 = 배너(1254)와 동일(본문 폭 꽉 참, 좌측 치우침 방지)
    os.environ.setdefault(_k, _v)
_load_env()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")
# 배너 생성 API — 기본은 로컬 dev(:8787). 다른 PC(집)에서는 .env 의 CAFE_BANNER_API 에
# 운영 주소(https://<배포도메인>/api/generate-cafe-card)를 넣으면 로컬 서버 없이 생성 가능.
# ※ _load_env() 뒤에 있어야 .env 값이 반영된다.
BANNER_API = os.environ.get("CAFE_BANNER_API", "http://127.0.0.1:8787/api/generate-cafe-card")

def sb_headers():
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

def _log(m): print(m, flush=True)


# ── 1) PC 인기글 필터 (lb_api 봇 호출, 브라우저 불필요) ──
def analyze_popular_pc(keyword):
    """인기글 노출 여부와 검색 응답의 카페 문서 수를 함께 돌려준다.

    cafe_count는 '경쟁 강도'의 확정값이 아니라 같은 응답에서 관측된 카페 URL 수다.
    기존처럼 인기글 존재 여부만 보는 것보다 후보 키워드 비교와 사후 기록에 유용하다.
    """
    su = f"https://search.naver.com/search.naver?query={quote(keyword)}"
    result = {"has_popular": False, "cafe_count": 0, "review_calls": 0}
    cafe_urls = set()
    try:
        r = requests.get(su, headers={"User-Agent": UA_PC, "Accept-Language": "ko-KR,ko;q=0.9"}, timeout=15, verify=False)
        html = r.text
    except Exception:
        return result
    for u in re.findall(r"https://s\.search\.naver\.com/p/review/\d+/search\.naver\?[^\s\"'<>\\]+", html):
        result["review_calls"] += 1
        u2 = htmlmod.unescape(u)
        try:
            b = requests.get(u2, headers={"User-Agent": UA_PC, "Referer": su, "Accept": "*/*"}, timeout=15, verify=False).text
        except Exception:
            continue
        # review 응답은 JSON 안에서 https:\/\/... 형태로 이스케이프될 수 있다.
        normalized = htmlmod.unescape(b).replace("\\/", "/")
        cafe_urls.update(re.findall(r"cafe\.naver\.com/[A-Za-z0-9_-]+/\d+", normalized))
        if len(b) > 1000 and "인기글" in b and re.search(r"cafe\.naver\.com/[A-Za-z0-9_-]+/\d+", normalized):
            result["has_popular"] = True
        time.sleep(random.uniform(0.4, 0.9))   # review 서브요청 사이 지연 — 크롤러와 IP 공유 시 버스트/차단 회피
    result["cafe_count"] = len(cafe_urls)
    return result


def has_popular_pc(keyword):
    """기존 호출부 호환용 bool 래퍼."""
    return analyze_popular_pc(keyword)["has_popular"]


# 서울 자치구 — "{구} 누수탐지" 형태로만 인기글이 뜨는 경우가 많아 '구' 폴백 확인(인수인계 요구).
SEOUL_GU = {"종로", "용산", "성동", "광진", "동대문", "중랑", "성북", "강북", "도봉", "노원",
            "은평", "서대문", "마포", "양천", "강서", "구로", "금천", "영등포", "동작", "관악",
            "서초", "강남", "송파", "강동"}


def _region_popular_signal(reg):
    """지역의 인기글 신호 — '{reg} 누수탐지' 기본, 서울 자치구는 '{reg}구' 폴백으로도 확인.
    반환: (matched_region, cafe_count) 또는 None(인기글 없음). cafe_count는 '거친' 경쟁 프록시."""
    cands = [reg]
    if reg in SEOUL_GU and not reg.endswith("구"):
        cands.append(reg + "구")
    for i, cand in enumerate(cands):
        if i:
            time.sleep(2)                       # 후보 간 지연(네이버 레이트리밋 완화)
        sig = analyze_popular_pc(f"{cand} {BUSINESS}")
        if sig["has_popular"]:
            return cand, sig["cafe_count"]
    return None


# ── 2) 원고 생성 (gpt-5-mini, 2000자+ 보장) ──
def _review_prompt(region, count, ending="후기"):
    return "\n".join([
        f'너는 네이버 카페 지역글 전문 카피라이터다. 아래 업체의 "{region} {BUSINESS}" 홍보 카페 본문을 [후기형]으로 쓴다.',
        f'업체명 "{BRAND}", 지역 "{region}", 업종 "{BUSINESS}".',
        '시작 예: "안녕하세요 :) 얼마 전 이사하면서 더반클린 입주청소 불러봤는데, 정리해서 공유해야겠다 싶어 글 남깁니다."',
        f'- 제목(가장 중요): 반드시 "{region} {BUSINESS}"로 **시작**(맨 앞 한 덩어리 대표키워드, 절대 쪼개거나 앞에 다른 말 붙이지 마라). '
        f'그 뒤에 구체적 상황·서비스 키워드(청소 범위 확인, 주방·화장실, 아파트·빌라, 새집증후군, 준공청소 등)를 붙이고 **마무리는 "{ending}" 느낌**으로. 제목 22~40자. '
        f'좋은 예: "과천 입주청소, 청소 범위 확인부터 마무리까지 직접 불러본 후기" / "부평 입주청소 아파트 빌라 새집증후군까지 챙긴 가이드". '
        f'제목 금지: 업체명("{BRAND}") 넣기, "~때문에/~골치였다면" 같은 가정·하소연형, 물결(~)·대괄호·따옴표. 매번 서술을 다르게 써라.',
        f'- 인사말 문단 먼저, 그 다음 「사진 1」~「사진 {count}」 각 한 줄 단독(정확히 {count}개).',
        '- 각 「사진」 뒤 본문 문단(3~5문장) 필수. 부제목만 있는 사진 없게. 문단과 문단 사이는 빈 줄 하나로 띄워라(가독성).',
        # 실제 이미지는 참고용 고정 이미지/배너라, 사진에 찍힌 장면인 것처럼 쓰면 글과 사진이 따로 논다.
        '- [매우 중요] 사진에 무엇이 찍혀 있는지 묘사하지 마라. 사진은 참고 이미지일 뿐이고 실제 현장 사진이 아니다. '
        '"진행 모습", "작업 사진", "시공 장면", "위 사진처럼", "사진에서 보이듯", "~하는 모습이 보이네요" 같은 '
        '사진 장면 서술·지시 표현을 본문과 부제목 어디에도 절대 쓰지 마라. '
        '대신 겪은 상황, 알아본 정보, 판단 기준, 느낀 점 위주로 서술하라.',
        f'- 부제목: 절반가량만 "부제목 : <내용>"(한 줄). "부제목" 두 번 쓰지 마라. 1~2개 지역({region})+키워드.',
        '- 분량 공백포함 2,000~2,300자, 반드시 2,000자 이상.',
        '- 본문에 해시태그(#…)나 URL/링크는 절대 넣지 마라(발행 시 자동으로 붙는다).',
        '반드시 JSON 하나만(코드펜스 금지): {"title":"제목","body":"본문(「사진 N」 마커 포함)","topics":["'+str(count)+'개"]}',
    ])

# 템플릿 탈피(유사문서 회피) — 소주제 풀에서 매 글 랜덤 선택·순서. 고정 흐름을 없애 글마다 구조가 달라진다.
_SECTION_POOL = [
    "입주 전 반드시 확인할 오염·하자 포인트",
    "새집증후군·마감재 유해물질과 환기·베이크아웃",
    "주방(후드·싱크대·타일 기름때) 청소 범위",
    "화장실(물때·곰팡이·줄눈) 청소 범위",
    "베란다·창틀·새시 레일 찌든때 제거",
    "바닥(장판·마루) 상태별 청소·왁스 여부",
    "붙박이장·수납장 내부 먼지·본드자국 처리",
    "준공/공사 후 분진 청소의 특수성",
    "청소 범위·평수별 소요시간과 인원 기준",
    "비용에 영향을 주는 요소(평수·오염도·옵션)",
    "셀프청소로 가능한 것과 한계",
    "청소 전 준비사항·입주일정 조율",
    "아파트·빌라·오피스텔·상가별 차이",
    "청소 후 체크리스트와 하자 재요청 기준",
]
# 도입 스타일도 매 글 랜덤 — 같은 리프레임 문구 반복 방지. {region}/{business} 치환.
_INTRO_STYLES = [
    '첫 문단 = "{region} {business}"로 시작해 입주 전 흔히 마주치는 오염 장면을 짧게 언급. 둘째 문단 = 왜 전문청소가 필요한지 + 무엇을 다룰지.',
    '첫 문단 = "{region} {business}"로 시작한 뒤 "청소 범위를 어디까지 봐야 할지" 질문형으로. 둘째 문단 = 성급히 맡길 때의 위험 + 흐름 안내.',
    '첫 문단 = "{region} {business}"로 시작하되 "무엇을 알면 재청소·추가비용을 줄이는지" 각도로. 둘째 문단 = 이 글에서 확인할 포인트.',
    '첫 문단 = "{region} {business}"로 시작해 평수·오염도에 따라 결과가 달라진다는 점 환기. 둘째 문단 = 그래서 무엇부터 따져야 하는지.',
    '첫 문단 = "{region} {business}"로 시작해 입주 일정과 청소 타이밍의 관계를 짚는다. 둘째 문단 = 준비사항 예고.',
]
# 제목 뒷부분에 넣을 '장면/상황' 키워드 — 매 글 랜덤. "{지역} 입주청소" 뒤에 붙어 제목·검색어를 다양화한다.
_TITLE_SCENES = [
    "새집 입주청소", "이사청소", "준공청소", "빈집청소", "아파트 입주청소",
    "화장실 물때 곰팡이", "주방 기름때", "베란다 창틀 청소", "새집증후군 청소", "상가 준공청소",
]


def _info_prompt(region, count, ending="총정리"):
    """정보형 — 겪은 사람의 경험담이 아니라, 처음 겪는 사람이 판단할 수 있게 정리해 주는 글.
    후기형과 공유하는 규칙(제목 대표키워드·사진 마커·사진묘사 금지·분량)은 그대로 두고 어조와 구성만 바꾼다.
    ⚠️ 유사문서 회피: 소주제·순서·도입·제목장면을 매 호출 랜덤화해 글마다 달라진다."""
    n_sec = random.randint(5, 6)
    sections = random.sample(_SECTION_POOL, min(n_sec, len(_SECTION_POOL)))   # 랜덤 선택 + 랜덤 순서
    sec_lines = "\n".join(f"     {i + 1}) {s}" for i, s in enumerate(sections))
    intro = random.choice(_INTRO_STYLES).format(region=region, business=BUSINESS)
    scene = random.choice(_TITLE_SCENES)                                      # 제목 뒷부분 장면 키워드
    return "\n".join([
        f'너는 네이버 카페 지역글 전문 카피라이터다. 아래 업체의 "{region} {BUSINESS}" 홍보 카페 본문을 [정보형]으로 쓴다.',
        f'업체명 "{BRAND}", 지역 "{region}", 업종 "{BUSINESS}".',
        '[정보형 정의] 글쓴이의 개인 경험담이 아니라, 이 주제를 처음 겪는 사람이 판단할 수 있게 '
        '청소 범위·오염 유형·작업 순서·절차·비용 기준·주의점을 정리해 주는 글이다. '
        '"제가 불러봤는데", "직접 겪어보니", "후기 남깁니다" 같은 1인칭 체험 서술을 쓰지 마라. '
        '대신 "~인 경우가 많습니다", "~부터 확인하는 것이 좋습니다", "~라면 ~를 살펴볼 수 있습니다" 처럼 안내하는 어조로 쓴다.',
        # 시안에서 실제로 나온 문제 — 글이 자기 자신을 설명하거나 보고서처럼 끝맺었다.
        '- [어조] 딱딱한 보고서체는 금지. 카페 글답게 편하게 읽히도록 써라. '
        '글이 스스로를 설명하는 문장("~을 정리한 정보형 안내입니다", "아래 내용은 ~입니다")을 쓰지 마라. '
        '"마무리 안내:", "요약:", "결론:" 같은 라벨을 문단 앞에 붙이지 마라. 마지막 문단도 그냥 자연스러운 문장으로 끝내라.',
        f'- 제목(가장 중요): 반드시 "{region} {BUSINESS}"로 **시작**(맨 앞 한 덩어리 대표키워드, 절대 쪼개거나 앞에 다른 말 붙이지 마라). '
        f'그 뒤에 **"{scene}"** 을 자연스럽게 녹이고 상황·서비스 표현을 덧붙여 **마무리는 "{ending}" 느낌**으로. 제목 22~42자. '
        f'좋은 예: "{region} {BUSINESS} {scene} 청소 범위 구분부터 마무리까지 총정리" / "{region} {BUSINESS} {scene} 확인 체크리스트". '
        f'제목 금지: 업체명("{BRAND}") 넣기, "후기·경험담·직접 불러본" 같은 체험형 표현, '
        '"~때문에/~골치였다면" 같은 가정·하소연형, 물결(~)·대괄호·따옴표. 매번 서술을 다르게 써라.',
        # 도입부 2문단 + FAQ — 더맨시스템에서 효과 확인된 구성을 입주청소에도 적용.
        '- 도입부는 **정확히 두 문단**으로 쓰고 사이에 빈 줄을 하나 넣어라. 한 덩어리로 붙이면 글이 벽처럼 읽힌다. '
        f'  이번 글의 도입 방식: {intro} '
        '  매 글 같은 문구·같은 구조를 반복하지 말고 도입 문장을 새로 지어라(특히 "~만으로는 충분하지 않습니다" 같은 상투구 반복 금지).',
        f'- 도입 두 문단 다음부터는 여러 개의 "섹션"으로 구성한다. **각 섹션은 반드시 "부제목 : <소제목>" 한 줄로 시작**하고, '
        f'  그 바로 아래에 「사진 N」과 본문 문단을 넣는다(한 섹션에 사진 1~2개). 본문 섹션에는 「사진 1」~「사진 {count - 1}」 을 고루 나눠 담아라(마지막 「사진 {count}」 은 아래 Q&A 규칙대로 맨 끝에 배치).',
        '- 각 「사진」 뒤 본문 문단(5문장 이상) 필수. 부제목만 있는 사진 없게. 문단과 문단 사이는 빈 줄 하나로 띄워라(가독성).',
        f'- **글의 맨 마지막 순서**: 본문 섹션을 다 쓴 뒤, 「사진 {count}」 한 줄을 단독으로 놓고 바로 다음 줄에 "부제목 : 자주 묻는 질문" 을 둔 뒤 그 아래 Q&A를 1~3쌍 넣어라(반드시 1쌍 이상). '
        '  Q&A 뒤에는 아무 것도 쓰지 마라 — 마무리 문단·결론·추가 사진 금지(번호·홈페이지·태그는 발행 시 자동으로 붙는다). '
        '  형식: "Q. 질문" 한 줄(17~33자, 의뢰인 말투, "~나요?"로 끝) / "A. 답변" 한 줄(106~240자). '
        '  답변은 구체적이고 실제로 도움이 되게. 매 글 같은 틀(부정→조건→결정)로 찍어내지 말고 질문마다 자연스럽게 답하라. '
        '  Q 와 A 의 개수를 반드시 맞춰라.',
        '- 이번 글에서 다룰 소주제(섹션)는 아래로 **한정**한다. 이 순서 그대로 각 소주제를 한 섹션(부제목+사진+본문)으로 자연스럽게 이어서 써라. '
        '아래에 없는 섹션을 새로 만들거나 다른 주제로 새지 마라(매 글 소주제·순서가 달라 글이 서로 달라야 한다):\n' + sec_lines,
        '- [매우 중요] 사진에 무엇이 찍혀 있는지 묘사하지 마라. 사진은 참고 이미지일 뿐이고 실제 현장 사진이 아니다. '
        '"진행 모습", "작업 사진", "시공 장면", "위 사진처럼", "사진에서 보이듯", "~하는 모습이 보이네요" 같은 '
        '사진 장면 서술·지시 표현을 본문과 부제목 어디에도 절대 쓰지 마라.',
        # 정보형은 단정적으로 읽히기 쉬워, 지어낸 금액이 그대로 신뢰를 깎는다.
        '- [중요] 확정적인 금액·수치를 지어내지 마라. 비용은 "무엇에 따라 달라지는지" 기준만 설명하고, '
        '정확한 견적은 현장 확인이 필요하다고 안내하라.',
        # 부제목이 1개만 나와 인용구 구획이 사라지는 일이 잦았다 → 개수를 명시.
        f'- 부제목: "부제목 : <내용>" 형식으로 **글 전체에 5~7개**, 각각 한 줄 단독. '
        f'  (본문 섹션 4~6개 + "부제목 : 자주 묻는 질문" 1개). 이보다 적으면 규칙 위반이다. '
        f'  ⚠️ [매우 중요] 각 부제목은 반드시 자기 섹션의 「사진」 **바로 앞 줄**에 놓아라. '
        f'  부제목들을 본문 다 쓴 뒤 글 끝에 모아서 나열하는 것은 절대 금지(가장 흔한 실수다). '
        f'  각 부제목은 13~29자, 서로 모두 달라야 하고 본문 문단의 어느 줄과도 글자가 같으면 안 된다. '
        f'  단순 명사 금지 — 위험이나 이득의 각도를 담아라. 1~2개에는 지역({region})+키워드를 넣어라. '
        f'  "부제목"이라는 단어를 한 줄에 두 번 쓰지 마라.',
        # 전화번호는 본문 어디에도 노출하지 않는다. 연락 안내가 필요하면 번호 없이.
        '- [중요] 전화번호를 본문 어디에도 쓰지 마라. "문의는 000-0000-0000으로" 같은 안내 문장도 넣지 마라. '
        '연락 안내가 필요하면 번호 없이 "상담을 받아보는 것이 좋습니다" 정도로만 쓰고, 글 맨 아래 업체 링크로 대신한다.',
        '- 분량 공백포함 2,200~2,500자, 반드시 2,000자 이상. 짧게 끝내지 마라.',
        '- 맞춤법·띄어쓰기를 검토하고, 어색하거나 존재하지 않는 표현("행동계" 등)을 쓰지 마라. '
        '문장 종결은 존댓말(-습니다/-입니다)로 통일하고, 마지막 문장까지 반말(-다)로 끝내지 마라.',
        '- 본문에 해시태그(#…)나 URL/링크는 절대 넣지 마라(발행 시 자동으로 붙는다).',
        '반드시 JSON 하나만(코드펜스 금지): {"title":"제목","body":"본문(「사진 N」 마커 포함)","topics":["'+str(count)+'개"]}',
    ])


def _openai_review(prompt):
    r = requests.post("https://api.openai.com/v1/responses",
        headers={"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"},
        # json_object: 본문에 큰따옴표를 그대로 써서 JSON 이 깨지는 사고를 막는다(배너 쪽과 동일 방식).
        data=json.dumps({"input": prompt, "model": "gpt-5-mini", "reasoning": {"effort": "low"},
                         "text": {"format": {"type": "json_object"}}}), timeout=150, verify=False)
    j = r.json()
    # 비용 확인용 — 원고(텍스트) 토큰 사용량을 찍는다.
    u = j.get("usage") or {}
    if u:
        _log(f"    [사용량] 입력 {u.get('input_tokens', '?')} · 출력 {u.get('output_tokens', '?')} 토큰")
    txt = j.get("output_text") or ""
    if not txt:
        for it in j.get("output", []):
            for ct in it.get("content", []):
                if ct.get("type") == "output_text": txt += ct.get("text", "")
    # strict=False: 모델이 본문에 이스케이프 안 된 줄바꿈(제어문자)을 넣어도 허용.
    p = json.loads(txt[txt.index("{"):txt.rindex("}") + 1], strict=False)
    return p

def _blen(b): return len(re.sub(r'「사진\s*\d+」', '', b or '').replace("\n", ""))


# publish_cafe 의 마커 인식은 "줄 전체가 마커"일 때만 매칭된다(IMG_MARK/SUB_MARK 둘 다 ^…$).
#   모델이 문장 끝에 「사진 1」을 붙이거나 부제목을 맨 제목줄로 쓰면 사진이 통째로 빠지고
#   마커 글자가 본문에 그대로 노출된다 → 큐에 넣기 전에 형태를 강제로 맞춘다.
_MARK_INLINE = re.compile(r'\s*[「\[]\s*사진\s*(\d+)\s*[」\]]\s*')
IMG_MARK_RE = re.compile(r'^\s*[「\[]?\s*사진\s*(\d+)\s*[」\]]?\s*$')   # publish_cafe.IMG_MARK 와 동일
_SENT_END = re.compile(r'[.!?…]$|[다요음임함됨]$')

def _norm_body(body):
    """① 「사진 N」을 항상 독립 줄로 분리. ② 사진 뒤 맨 제목줄을 "부제목 : …" 형태로 승격."""
    out = []
    for raw in (body or "").splitlines():
        line = raw.rstrip()
        if not line.strip():
            out.append("")
            continue
        # ① 줄 안에 섞인 마커를 앞뒤 텍스트와 떼어 각각 독립 줄로.
        parts, last = [], 0
        for m in _MARK_INLINE.finditer(line):
            head = line[last:m.start()].strip()
            if head:
                parts.append(head)
            parts.append(f"「사진 {int(m.group(1))}」")
            last = m.end()
        tail = line[last:].strip()
        if tail:
            parts.append(tail)
        out.extend(parts or [line])

    # ② 사진 마커 바로 다음의 짧은 맨 제목줄 → 부제목으로. (문장이면 건드리지 않는다)
    res = []
    for i, ln in enumerate(out):
        prev = next((x for x in reversed(res) if x.strip()), "")
        is_head = (
            IMG_MARK_RE.match(prev)                       # 직전이 사진 마커이고
            and ln.strip()
            and not IMG_MARK_RE.match(ln)
            and not ln.startswith("부제목")
            and len(ln.strip()) <= 30                      # 짧고
            and not _SENT_END.search(ln.strip())           # 문장 종결이 아니면 제목줄로 본다
        )
        res.append(f"부제목 : {ln.strip()}" if is_head else ln)
    return "\n".join(res).strip("\n")


def _redistribute_subtitles(body):
    """부제목(소제목)이 글 끝에 몰려 나온 경우(모델이 자주 실패하는 패턴) → 각 사진 섹션 앞으로 고루 재분배.
    이미 섹션 사이에 흩어져 있으면(연속 부제목 없음) 그대로 둔다. 순수 텍스트 재배치 — OpenAI 재호출 없음."""
    lines = body.split("\n")
    sub_pos = [i for i, l in enumerate(lines) if l.strip().startswith("부제목")]
    if len(sub_pos) < 2:
        return body
    # 클러스터 감지: 두 부제목 사이에 (빈 줄 제외) 실제 내용이 없으면 '몰린' 것.
    clustered = any(not [x for x in lines[a + 1:b] if x.strip()]
                    for a, b in zip(sub_pos, sub_pos[1:]))
    if not clustered:
        return body
    subs = [lines[i].strip() for i in sub_pos]
    rest = [l for i, l in enumerate(lines) if i not in set(sub_pos)]
    img_pos = [i for i, l in enumerate(rest) if IMG_MARK_RE.match(l.strip())]
    if not img_pos:
        return body                                   # 사진이 없으면 재배치 근거가 없다 → 원본 유지
    faq = next((s for s in subs if "자주 묻는 질문" in s), None)
    content = [s for s in subs if s != faq]           # FAQ 부제목은 Q&A 앞에 따로 둔다
    inserts = {}                                      # rest 인덱스 → 그 앞에 넣을 부제목 줄들
    n = len(img_pos)
    for j, s in enumerate(content):                   # 부제목을 사진 섹션들에 고루 분배(순서 유지)
        inserts.setdefault(img_pos[(j * n) // len(content)], []).append(s)
    if faq:
        q = next((i for i, l in enumerate(rest) if re.match(r'^\s*Q[\s.．:).]', l.strip())), len(rest))
        inserts.setdefault(q, []).append(faq)
    out = []
    for i, l in enumerate(rest):
        for s in inserts.get(i, []):
            out += ["", s, ""]
        out.append(l)
    for s in inserts.get(len(rest), []):              # FAQ 가 맨 끝일 때
        out += ["", s, ""]
    return "\n".join(out).strip("\n")


_PHONE_RE = re.compile(r'0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}')

def _strip_phone(body):
    """번호가 들어간 문장만 통째로 걷어낸다(번호만 지우면 "문의는 로 연락" 같은 문장이 남는다)."""
    out = []
    for line in (body or "").splitlines():
        if not _PHONE_RE.search(line):
            out.append(line)
            continue
        keep = [s for s in re.split(r'(?<=[.!?])\s+', line) if not _PHONE_RE.search(s)]
        out.append(" ".join(keep).strip())
    return "\n".join(out)

# 발행용 홈페이지 링크(맨 마지막 줄 고정)
BUSINESS_URL = "https://www.thebanclean.co.kr/"  # 더반클린 홈페이지 — 글 끝에 링크카드로 항상 부착.
# 제목 마무리 표현 풀 — 매번 다르게(사용자: 후기/가이드 등 다양하게)
TITLE_ENDINGS = ["후기", "솔직 후기", "직접 불러본 후기", "가이드", "총정리", "체크 가이드", "정리", "경험담", "꿀팁 정리"]
# 정보형 전용 — 체험형("후기·경험담") 표현은 빼고 정보 성격만 남긴다.
INFO_TITLE_ENDINGS = ["총정리", "가이드", "정리", "체크리스트", "체크 가이드", "기준 정리", "핵심 정리", "알아보기"]
# 원고 톤 — 정보형이 기본. CAFE_TONE=review 로 되돌릴 수 있다.
CAFE_TONE = os.environ.get("CAFE_TONE", "info")

def _fix_title(region, title):
    """대표키워드 "{region} {BUSINESS}"를 제목 '맨 앞'에 붙이되, 기존의 긴 제목은 그대로 살린다.
    (모델이 대부분 처리 — 이건 안전망. 절대 제목을 짧게 자르지 않음.)"""
    kw = f"{region} {BUSINESS}"
    t = (title or "").strip().strip('"').strip()
    if not t:
        return f"{kw} 직접 불러본 후기, 청소 범위 확인부터 마무리까지 정리했어요"
    if t.startswith(kw):
        return t                                  # 이미 대표키워드로 시작 → 그대로(길이 유지)
    # 대표키워드를 앞에 붙임. 선두 지역조각·업체명·가정형·대시 제거해 깔끔한 서술만 남김(길이 보존).
    tail = re.sub(rf'^\s*{re.escape(region)}\S*\s*', '', t)
    tail = re.sub(re.escape(BRAND), '', tail)                 # 업체명 제거(제목 중복 방지)
    tail = re.sub(r'[—–\-~"\'\[\]]', ' ', tail)               # 대시·물결·따옴표·대괄호 제거
    tail = re.sub(r'^[\s:,.]+', '', tail)
    tail = re.sub(r'\s{2,}', ' ', tail).strip()
    return f"{kw} {tail}" if tail else kw

def _tags(region, limit=6):
    """에디터 '태그 입력칸'(최대 10개)에 넣을 대표키워드 — 본문 #해시태그가 아니라 블로그식 하단 태그칩.
    지역은 공백 제거해 한 덩어리 키워드로."""
    rj = region.replace(" ", "")
    tags = [f"{rj}입주청소", f"{rj}이사청소", f"{rj}입주청소업체", f"{rj}새집청소",
            "입주청소", "이사청소", "새집청소", "입주청소업체", "더반클린"]
    return tags[:max(0, min(10, limit))]

def gen_review(region, count, tone=None):
    tone = tone or CAFE_TONE
    info = tone == "info"
    build = _info_prompt if info else _review_prompt
    ending = random.choice(INFO_TITLE_ENDINGS if info else TITLE_ENDINGS)   # 제목 마무리 매번 다르게
    best = _openai_review(build(region, count, ending))
    for _ in range(3):   # 2000자 이상 나올 때까지 최대 3회 재생성(더 긴 쪽 유지) — 사용자: 2000자 밑 금지
        if _blen(best.get("body", "")) >= 2000:
            break
        p = _openai_review(build(region, count, ending) +
            f'\n\n[매우 중요] 방금 본문이 {_blen(best.get("body",""))}자로 2,000자 미만이라 규칙 위반이다. 각 「사진」 뒤 본문을 5문장 이상으로 더 길고 구체적으로 늘려 반드시 공백 포함 2,300자 이상으로 다시 작성하라.')
        if _blen(p.get("body", "")) > _blen(best.get("body", "")):
            best = p
    title = _fix_title(region, best.get("title", ""))
    body = _norm_body(best.get("body", ""))        # 사진 마커·부제목을 독립 줄로 교정
    body = _redistribute_subtitles(body)           # 부제목이 끝에 몰렸으면 각 섹션 앞으로 재분배(안전망, 비용 0)
    if info:
        body = _strip_phone(body)                  # 프롬프트로 막아도 새는 경우가 있어 한 번 더 걷어낸다
    body = body.rstrip()                           # 태그/링크는 본문이 아니라 별도 블록으로 처리
    return title, body


# ── 3) 배너 — 고정 브랜드 배너의 '지역 텍스트'만 교체(로컬 edit 라우트) ──
# 처음부터 히어로 배너를 새로 생성하지 않고, 고정 브랜드 배너(theban_banner01.png)를 읽어
#   지역 글자만 바꿔치기한다. 로컬 카드서버의 generate-cafe-edit 라우트를 사용한다.
BANNER_BASE = os.environ.get("CAFE_BANNER_BASE", "C:/Users/rlawh/sub2/public/images/theban/theban_banner01.png")
BANNER_EDIT_API = os.environ.get("CAFE_BANNER_EDIT_API", "http://127.0.0.1:8787/api/generate-cafe-edit")
# 마감 배너 — Q&A 바로 앞(글의 마지막 이미지)에 넣는 고정 배너.
CLOSING_BANNER = os.environ.get("CAFE_CLOSING_BANNER", "C:/Users/rlawh/sub2/public/images/theban/banner08.png")

def gen_banner(region):
    # 배너 = 사장님 완성 배너(theban_banner01)를 GPT(generate-cafe-card, refs 첨부)에 넣어
    #   📍 지역줄("경기·인천·서울·충청")만 "{지역} 입주청소" 로 편집. 나머지 디자인 유지. OpenAI 라 rate limit 없음.
    try:
        raw = open(BANNER_BASE, "rb").read()
    except Exception as e:
        raise RuntimeError(f"배너 원본 열기 실패({BANNER_BASE}): {e}")
    data_url = "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
    q = os.environ.get("CAFE_BANNER_QUALITY", "low")   # 누수와 동일 원가(gpt-5-mini low). 충실도 부족하면 medium/high.
    m = os.environ.get("CAFE_BANNER_MODEL", "gpt-5-mini")
    r = requests.post(BANNER_API, headers={"Content-Type": "application/json"},
        data=json.dumps({"mode": "edit-region", "region": f"{region} {BUSINESS}", "refs": [data_url],
                         "skipServerLogoOverlay": True, "quality": q, "imageQuality": q, "model": m}), timeout=300)
    d = r.json()
    if not d.get("imageDataUrl"):
        raise RuntimeError(f"배너 실패: {d.get('message', r.status_code)}")
    return base64.b64decode(d["imageDataUrl"].split(",", 1)[1])


# ── 4) 고정 이미지 로드 ──
def _split_composite(img):
    """좌우로 붙은 합성 프레임을 '검은 세로 구분선' 기준으로 개별 사진으로 분리. 구분선 없으면 [원본]."""
    w, h = img.size
    px = img.load()

    def col_dark(x):
        step = max(1, h // 30)
        for y in range(0, h, step):
            r, g, b = px[x, y]
            if r + g + b > 45:
                return False
        return True

    dark = [x for x in range(int(w * 0.15), int(w * 0.85)) if col_dark(x)]   # 내부에서만 구분선 탐색
    if not dark:
        return [img]
    groups, s, prev = [], dark[0], dark[0]
    for x in dark[1:]:
        if x - prev > 1:
            groups.append((s, prev)); s = x
        prev = x
    groups.append((s, prev))
    cuts = [(a + b) // 2 for a, b in groups if (b - a + 1) >= max(3, int(w * 0.008))]
    if not cuts:
        return [img]
    parts, bounds = [], [0] + cuts + [w]
    for i in range(len(bounds) - 1):
        sub = img.crop((bounds[i], 0, bounds[i + 1], h))
        bbox = sub.convert("L").point(lambda p: 255 if p > 12 else 0).getbbox()   # 검정 여백 트림
        if bbox:
            sub = sub.crop(bbox)
        if sub.width >= w * 0.15 and sub.height >= h * 0.3:
            parts.append(sub)
    return parts or [img]


def load_fixed():
    """이미지 풀 로드. manifest.json 있으면 그 목록, 없으면 폴더의 모든 이미지.
    CAFE_FIXED_DIR 로 폴더 지정(기본 theban_real). CAFE_SPLIT_COMPOSITE=1 이면 좌우 합성 프레임을 개별 사진으로 분할."""
    fixed_dir = os.environ.get("CAFE_FIXED_DIR") or FIXED_DIR
    mani = os.path.join(fixed_dir, "manifest.json")
    if os.path.exists(mani):
        names = json.load(open(mani, encoding="utf-8"))
        files = [os.path.join(fixed_dir, os.path.basename(n)) for n in names]
    else:
        exts = (".jpg", ".jpeg", ".png", ".webp")
        files = sorted(os.path.join(fixed_dir, f) for f in os.listdir(fixed_dir) if f.lower().endswith(exts))
    do_split = os.environ.get("CAFE_SPLIT_COMPOSITE", "0") == "1"
    target_w = int(os.environ.get("CAFE_PHOTO_WIDTH", "0") or 0)   # 0=원본유지. 카페 글 너비에 맞춰 키우기(중앙 꽉 참).
    out = []
    for fp in files:
        if not os.path.exists(fp):
            continue
        raw = open(fp, "rb").read()
        try:
            # exif_transpose: 휴대폰(카톡) 사진의 EXIF 회전정보를 실제 픽셀에 적용 → 눕힘 방지.
            img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
        except Exception:
            out.append(raw); continue
        subs = _split_composite(img) if do_split else [img]
        for sub in subs:
            if target_w > 0 and sub.width != target_w:
                sub = sub.resize((target_w, max(1, round(sub.height * target_w / sub.width))), Image.LANCZOS)
            b = io.BytesIO(); sub.save(b, format="JPEG", quality=92); out.append(b.getvalue())
    return out


# ── 5) varyImage (JS canvas 로직 → PIL) ──
def vary_image(img_bytes, seed):
    rng = random.Random(seed)
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    sw, sh = img.size
    crop = rng.randint(0, 3)
    ow = max(16, sw - crop * 2 + round((rng.random() - 0.5) * 6))
    oh = max(16, sh - crop * 2 + round((rng.random() - 0.5) * 6))
    img = img.crop((crop, crop, sw - crop, sh - crop)).resize((ow, oh))
    img = ImageEnhance.Brightness(img).enhance(1 + (rng.random() - 0.5) * 0.02)
    img = ImageEnhance.Contrast(img).enhance(1 + (rng.random() - 0.5) * 0.02)
    img = ImageEnhance.Color(img).enhance(1 + (rng.random() - 0.5) * 0.02)
    px = img.load()
    for _ in range(60):
        x, y = rng.randint(0, ow - 1), rng.randint(0, oh - 1)
        vals = list(px[x, y]); ch = rng.randint(0, 2)
        vals[ch] = max(0, min(255, vals[ch] + (-1 if rng.random() < 0.5 else 1)))
        px[x, y] = tuple(vals)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=int((0.9 + rng.random() * 0.07) * 100))
    return out.getvalue()


# ── 6) 이미지 순서 ──
def build_order(banner, fixed):
    # 같은 배너를 앞뒤에 반복하면 글마다 동일한 광고 패턴이 강해진다. 기본은 첫 장 1회만.
    # 이전 북엔드 구성이 꼭 필요할 때만 CAFE_REPEAT_BANNER=1 로 되돌린다.
    repeat = os.environ.get("CAFE_REPEAT_BANNER", "0").lower() in ("1", "true", "yes")
    return [banner] + list(fixed) + ([banner] if repeat else [])


# ── 7) 업로드 + 큐 적재 ──
def upload_image(job_id, idx, jpg):
    path = f"{job_id}/{idx:02d}.jpg"
    r = requests.post(f"{SUPABASE_URL}/storage/v1/object/{CAFE_BUCKET}/{path}",
        headers={**sb_headers(), "Content-Type": "image/jpeg", "x-upsert": "true"}, data=jpg, timeout=120, verify=False)
    return path if r.ok else None

def queue_job(job_id, title, blocks, company=None, region=None, keyword=None, board=None):
    payload = {"id": job_id, "title": title, "manifest": blocks, "status": "pending"}
    # 멀티PC 라우팅(board)·중복차단(company/region/keyword) 키 — 값이 있을 때만 넣는다(구스키마 하위호환).
    for k, v in (("company", company), ("region", region), ("keyword", keyword), ("board", board)):
        if v:
            payload[k] = v
    r = requests.post(f"{SUPABASE_URL}/rest/v1/cafe_publish_queue",
        headers={**sb_headers(), "Content-Type": "application/json", "Prefer": "return=minimal"},
        data=json.dumps(payload), timeout=30, verify=False)
    return r.ok, (r.text[:200] if not r.ok else "")


def make_and_queue(region, pool, popular_verified=False, manual_ok=False):
    # 절대 안전장치: 네이버 통합검색에서 "지역+입주청소" 인기글 영역이 확인된
    # 지역만 큐에 넣는다. 검색 응답 오류·파서 실패·직접 함수 호출은 모두 발행 거부.
    if not (popular_verified or manual_ok):   # manual_ok=수동 도어(자율발행은 안 넘김)
        raise RuntimeError(
            f"인기글 미검증 키워드 발행 차단: {region} {BUSINESS} "
            "(main 선별 절차 또는 수동 도어를 통해서만 등록 가능)"
        )
    # 풀에서 글마다 랜덤 조합 + 순서 셔플 — 글끼리 이미지가 겹치지 않게(이미지 중복 회피).
    n = int(os.environ.get("CAFE_PHOTOS_PER_POST", "6"))
    k = min(len(pool), max(3, n))
    fixed = random.sample(pool, k) if len(pool) > k else list(pool)
    random.shuffle(fixed)
    # 이미지 = [상단 GPT배너] + [실사진들] + [마감 배너 banner08]. banner08 이 '마지막 이미지'(Q&A 앞).
    count = len(fixed) + 2   # GPT배너 1 + 실사진 + banner08 1
    # 광고 신호를 줄인 실험군을 기본으로 사용한다. 링크/태그 유무는 manifest의 meta에 남겨
    # 나중에 검색 순위와 대조할 수 있다. 강제하려면 CAFE_LINK_RATE/CAFE_TAG_COUNT 사용.
    link_rate = max(0.0, min(1.0, float(os.environ.get("CAFE_LINK_RATE", "0.34"))))
    include_link = bool(BUSINESS_URL)   # 더반: 홈페이지 있으면 항상 링크카드
    tag_count = int(os.environ.get("CAFE_TAG_COUNT", str(random.randint(4, 7))))
    variant = f"real{len(fixed)}-gptbanner1-closeb08-link{'1' if include_link else '0'}-tags{tag_count}"
    _log(f"  원고 생성(gpt-5-mini)… (이미지 풀 {len(pool)}장 중 {k}장 랜덤)")
    title, body = gen_review(region, count)
    _log(f"    제목: {title[:30]} · {_blen(body)}자")
    _log(f"  배너 생성(api:dev)…")
    banner = gen_banner(region)
    try:
        closing = open(CLOSING_BANNER, "rb").read()
    except Exception as e:
        raise RuntimeError(f"마감 배너 열기 실패({CLOSING_BANNER}): {e}")
    order = [banner] + list(fixed) + [closing]   # count 장, 마지막 = banner08(Q&A 앞)
    job_id = str(uuid.uuid4())
    base = random.randint(0, 10**9)
    blocks = []
    for i, img in enumerate(order):
        jpg = vary_image(img, base + i * 7919 + 1)   # 전 이미지 미세변형(1·마지막 배너 포함)
        path = upload_image(job_id, i, jpg)
        if not path: raise RuntimeError(f"이미지 업로드 실패 idx={i}")
        blocks.append({"type": "image", "path": path})
    blocks.append({"type": "text", "text": body})
    # 더반: 본문 끝에 전화번호(텍스트) + 홈페이지(링크카드)를 '항상' 부착.
    if PHONE:
        blocks.append({"type": "text", "text": f"문의 : {PHONE}"})
    if BUSINESS_URL:
        blocks.append({"type": "link", "url": BUSINESS_URL})
    blocks.append({"type": "tags", "tags": _tags(region, tag_count)})
    blocks.append({"type": "meta", "experiment": variant, "keyword": f"{region} {BUSINESS}"})
    # 게시판 파티션/중복차단 메타 — 입주청소 자동발행 기본값. board 블록을 넣어 발행기가 정확한 게시판을 고르게 한다.
    company = os.environ.get("CAFE_COMPANY", "durban")
    board = os.environ.get("CAFE_BOARD", "더반클린 입주청소")
    blocks.append({"type": "board", "name": board})
    ok, err = queue_job(job_id, title, blocks, company=company, region=region, board=board)
    if not ok: raise RuntimeError(f"큐 적재 실패: {err}")
    _log(f"  ✅ 큐 등록 완료: {job_id[:8]} (이미지 {count} + 본문 · 실험군 {variant})")
    return job_id


# 후보 지역 = 서울 25개구 + 인천 10개구·군 + 경기 31개시·군 + 주요 생활권(사용자 지정 2026-07-20).
#   "서울 중구"/"인천 중구", "경기 광주"처럼 동명이지는 앞에 광역명을 붙여야 엉뚱한 지역이 검색된다.
DEFAULT_REGIONS = [
    "종로", "서울 중구", "용산", "성동", "광진", "동대문", "중랑", "성북",
    "강북", "도봉", "노원", "은평", "서대문", "마포", "양천", "강서",
    "구로", "금천", "영등포", "동작", "관악", "서초", "강남", "송파",
    "강동", "인천 중구", "인천 동구", "인천 미추홀구", "인천 연수구", "인천 남동구", "인천 부평", "인천 계양구",
    "인천 서구", "강화", "옹진", "수원", "성남", "고양", "용인", "부천",
    "안산", "안양", "남양주", "화성", "평택", "의정부", "파주", "시흥",
    "김포", "광명", "경기 광주", "군포", "오산", "이천", "양주", "안성",
    "구리", "포천", "의왕", "하남", "여주", "동두천", "과천", "양평",
    "가평", "연천", "일산", "잠실", "분당", "안산단원", "동탄",
    # 수도권 신도시·생활권 확장(2026-07-23 "최대한 찾기") — 부모 시/군이 발행돼도 별개 검색어라, 인기글 있으면 발행.
    "위례", "광교", "미사", "별내", "다산", "운정", "청라", "송도", "영종",
    "검단", "배곧", "옥정", "판교", "평촌", "산본", "중동", "수지", "기흥", "죽전",
]

# 기존 수동 발행분(중복 발행 금지) — 안전 하드코딩. 자동발행분은 아래 DB 조회로 자동 누적.
KNOWN_PUBLISHED = set()   # 더반 새 캠페인 — 누수 잔재 지역 제외 안 함(0에서 시작)


def published_regions():
    """이미 발행/등록된 지역 = 재발행 금지. cafe_rank_posts 키워드 + cafe_publish_queue 제목 + 하드코딩."""
    regs = set(KNOWN_PUBLISHED)
    try:
        rows = requests.get(f"{SUPABASE_URL}/rest/v1/cafe_rank_posts", headers=sb_headers(),
                            params={"select": "keyword"}, timeout=30, verify=False).json()
        for r in rows:
            m = re.match(r"\s*(.+?)\s+" + re.escape(BUSINESS), r.get("keyword") or "")
            if m:
                regs.add(m.group(1).strip())
    except Exception:
        pass
    # 큐(대기/처리/발행) 제목에 '지역 … 입주청소'가 있으면 제외(best-effort)
    try:
        rows = requests.get(f"{SUPABASE_URL}/rest/v1/cafe_publish_queue", headers=sb_headers(),
                            params={"select": "title"}, timeout=30, verify=False).json()
        titles = [r.get("title") or "" for r in rows]
        for reg in DEFAULT_REGIONS:
            if any((reg in t and BUSINESS in t) for t in titles):
                regs.add(reg)
    except Exception:
        pass
    # 서울 자치구 승격형("마포구")으로 발행된 것도 기본형("마포")으로 done 처리 → 재발행 방지.
    for r in list(regs):
        if r.endswith("구") and r[:-1] in SEOUL_GU:
            regs.add(r[:-1])
    return regs

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=2)
    ap.add_argument("--regions", default="")
    ap.add_argument("--dry", action="store_true", help="필터/제외만 확인(생성·발행 안 함)")
    args = ap.parse_args()
    regions = [r.strip() for r in args.regions.split(",") if r.strip()] or DEFAULT_REGIONS
    if not (SUPABASE_URL and SUPABASE_KEY and OPENAI_KEY):
        _log("env 부족(SUPABASE_*/OPENAI_API_KEY)"); return

    _log(f"=== 카페 자동발행: 업종 '{BUSINESS}' · 후보 {len(regions)}개 · 목표 {args.limit}건 ===")
    pool = load_fixed()
    banner_count = 2 if os.environ.get("CAFE_REPEAT_BANNER", "0").lower() in ("1", "true", "yes") else 1
    _log(f"이미지 풀 {len(pool)}장 (dir={os.environ.get('CAFE_FIXED_DIR') or 'theban_real'}) → 글마다 랜덤 {os.environ.get('CAFE_PHOTOS_PER_POST','6')}장 + 배너 {banner_count}장")

    # 이미 발행/등록된 지역 제외(중복 발행 금지)
    done = published_regions()
    _log(f"이미 발행된 지역(제외): {sorted(done)}")
    todo = [r for r in regions if r not in done]

    scored = []
    try:
        _factor = max(1, int(os.environ.get("CAFE_SCAN_FACTOR", "2")))
    except ValueError:
        _factor = 2
    scan_cap = max(args.limit, args.limit * _factor)
    for reg in todo:
        res = _region_popular_signal(reg)   # 구 폴백 포함. (matched, cafe_count) 또는 None
        if res:
            matched, cc = res
            _log(f"  [✅통과] {matched} {BUSINESS} · 경쟁(카페문서) {cc}")
            scored.append((cc, matched))
        else:
            _log(f"  [❌인기글없음] {reg} {BUSINESS}")
        # 지역 간 지연 — jitter로 시간 분산(크롤러와 같은 IP여도 몰아치지 않게). CAFE_SCAN_DELAY 로 조절.
        try:
            _base = max(0.0, float(os.environ.get("CAFE_SCAN_DELAY", "3")))
        except ValueError:
            _base = 3.0
        time.sleep(random.uniform(_base, _base + 2))
        if len(scored) >= scan_cap:            # limit×2 만큼 모으면 그중 경쟁 낮은 순으로 고른다
            break
    scored.sort(key=lambda x: x[0])            # 경쟁(관측 카페문서) 낮은 순 우선 — 미미하지만 무료 이점
    passed = [m for _, m in scored[:args.limit]]
    _log(f"→ 발행 대상 {len(passed)}개(경쟁 낮은 순): {passed}")
    if not passed:
        _log("발행할 신규 인기글 지역이 없습니다."); return
    if args.dry:
        _log("(dry-run: 생성·발행 안 함)"); return

    for reg in passed:
        _log(f"\n[{reg} {BUSINESS}] 생성·등록")
        try:
            make_and_queue(reg, pool, popular_verified=True)
        except Exception as e:
            _log(f"  ❌ 실패: {str(e)[:150]}")
    _log(f"\n=== 완료. publish_listener 가 순서대로 발행합니다. ===")


if __name__ == "__main__":
    main()
