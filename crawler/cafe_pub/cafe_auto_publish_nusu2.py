# -*- coding: utf-8 -*-
"""카페 자동발행 오케스트레이터 (로컬) — 든든한 누수탐지 전용 "nusu2"(bimproum 양식).
   업종+지역리스트 → 인기글 뜨는 지역만 필터(PC lb_api, 브라우저X) → 통과 지역만
   원고(gpt-5-mini, 순수텍스트 6문단·1,000~1,200자) 생성 → 고정 HERO 캡처 + 지역별 CTA 배너 →
   미세변형(varyImage) → cafe-images 업로드 + cafe_publish_queue 적재. 발행은 publish_listener 가 처리.

   ※ 기존 cafe_auto_publish.py 는 건드리지 않는다. 스캔/큐 기계장치(인기글 필터·경쟁정렬·dedup·
     업로드·큐)는 그 파일에서 검증된 로직을 그대로 복사해 왔고, 생성부와 조립부만 새로 짰다.

실행:  python cafe_auto_publish_nusu2.py            # 기본 지역리스트에서 통과분 2개 발행 등록
       python cafe_auto_publish_nusu2.py --limit 2 --regions 안양,과천,구로,잠실
전제:  ../.env(OPENAI_API_KEY) + ../../.env(SUPABASE) + SQL 완료. (배너 API 불필요 — CTA는 고정파일)
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

import sb_auth   # Supabase 인증(서비스키 레거시 / publishable+내부JWT). 라이브 sub2 는 서비스키 그대로.

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
requests.packages.urllib3.disable_warnings()

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
# 자산 루트 — 기본은 repo public/images(레이아웃 유지 시). 패키징/고객 배포는 CAFE_ASSETS_DIR 로 덮어쓴다.
ASSETS_DIR = os.environ.get("CAFE_ASSETS_DIR") or os.path.join(ROOT, "public", "images")
CAFE_BUCKET = "cafe-images"
UA_PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"

# 업체 고정정보
BUSINESS, BRAND, PHONE = "누수탐지", "든든한 누수탐지", "010-4614-4424"
BUSINESS_URL = "https://ddnusu.imweb.me/"
# 발행 대상 카페/게시판 라우팅 — 새 카페(누수 전용)로 이전 시 env로 지정.
#   CAFE_COMPANY: 큐 company 태그(카페별 분리·dedup 리셋). CAFE_BOARD: 매니페스트 게시판명(카페 메뉴명과 글자 일치).
#   CAFE_FRESH_REGIONS=1: 새 카페는 초기화 상태 → 이 company 큐에 없는 지역이면 (구 카페 발행분 무시하고) 재사용 허용.
COMPANY = os.environ.get("CAFE_COMPANY", "leak2")
BOARD_NAME = os.environ.get("CAFE_BOARD", "누수")
FRESH_REGIONS = os.environ.get("CAFE_FRESH_REGIONS", "0") == "1"
ADD_LINK = os.environ.get("CAFE_ADD_LINK", "1") == "1"   # 0이면 링크카드 자동삽입 안 함(수기 삽입용)

# 실사 현장사진 풀(개별 사진, 글마다 2장씩 깔끔하게 좌우로 붙여 삽입 → 유사문서 회피).
#  ※고정 HERO(원고 캡처) 폐기. ※'누수탐지_real'은 검정 합성 없는 개별 사진 폴더(사용자 제공 2026-07-24).
REAL_DIR = os.path.join(ASSETS_DIR, "누수탐지_real")
REAL_PER_POST = (2, 3)          # 글당 삽입할 '2장 페어' 슬롯 수(랜덤). 슬롯당 사진 2장 사용.

def _real_photos():
    """실사 개별 사진 경로 리스트(png/jpg)."""
    import glob
    return sorted(glob.glob(os.path.join(REAL_DIR, "*.png")) + glob.glob(os.path.join(REAL_DIR, "*.jpg")))

def _pair_photos(p2):
    """개별 사진 2장을 같은 높이로 맞춰 좌우로 깔끔하게 붙인 JPEG bytes(검정 배경/여백 없음)."""
    H = 1080
    imgs = []
    for p in p2:
        im = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
        w = max(1, round(im.width * H / im.height))
        imgs.append(im.resize((w, H), Image.LANCZOS))
    gap = 8
    total_w = sum(i.width for i in imgs) + gap * (len(imgs) - 1)
    canvas = Image.new("RGB", (total_w, H), (255, 255, 255))   # 흰 배경(검정 아님)
    x = 0
    for i in imgs:
        canvas.paste(i, (x, 0)); x += i.width + gap
    b = io.BytesIO(); canvas.save(b, format="JPEG", quality=90)
    return b.getvalue()

CTA_DIR = os.path.join(ASSETS_DIR, "nusu2-cta")
CTA_FILES = {"서울": "서울.png", "경기": "경기.png", "인천": "인천.png"}

# 내장 배너 카드 세트(누수탐지 '기본 내장 2~8', 1254×1254) — 실사와 섞어 본문에 삽입.
CARDS_DIR = os.path.join(ASSETS_DIR, "cafe-fixed")
CARDS_PER_POST = 3              # 글당 삽입할 카드 배너 수(7장 중 랜덤)

def _fixed_cards():
    import glob
    return sorted(glob.glob(os.path.join(CARDS_DIR, "card-*.png")))

# 옛 누수 파이프라인 배너(:8787 API, 지역 속성만 바꿔 생성)를 하단/중간 배너로 재사용.
BANNER_API = os.environ.get("CAFE_BANNER_API", "http://127.0.0.1:8787/api/generate-cafe-card")

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
_load_env()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")
# 원고 생성 CF 엔드포인트 — 설정하면 CF 경유(로컬 OpenAI 키 불필요), 미설정이면 레거시 직접호출(OPENAI_KEY).
#   배포 에이전트는 배포된 /api/generate-cafe URL 로 지정한다. 라이브 sub2 는 미설정 → 직접호출 유지.
GENERATE_API = os.environ.get("CAFE_GENERATE_API", "").strip()
BUSINESS_KIND = "leak"   # CF 롱폼 프롬프트 선택(누수탐지). ddclean 은 'clean'.

def sb_headers():
    # 서비스키 또는 publishable+내부JWT — sb_auth 가 env 로 판정. 라이브(env 미설정)=서비스키 그대로.
    return sb_auth.headers()

def _log(m): print(m, flush=True)


# ── 1) PC 인기글 필터 (lb_api 봇 호출, 브라우저 불필요) ── [cafe_auto_publish.py 와 동일]
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

# 서울 자치구 → 실재 행정/법정동(위치스택 제목·본문용, 예: "서울 광진구 누수탐지 자양동").
#   ⚠️ 전부 실제 존재하는 동만. 지어낸 동명 금지(이 dict 밖 동은 쓰지 않는다).
DONG_DICT = {
    "종로": ["청운동", "사직동", "삼청동", "혜화동", "명륜동", "창신동", "부암동", "평창동"],
    "용산": ["이태원동", "한남동", "청파동", "원효로동", "이촌동", "후암동", "효창동", "용문동"],
    "성동": ["성수동", "금호동", "옥수동", "행당동", "왕십리동", "응봉동", "마장동", "사근동"],
    "광진": ["자양동", "구의동", "중곡동", "화양동", "능동", "광장동", "군자동"],
    "동대문": ["전농동", "답십리동", "장안동", "이문동", "휘경동", "청량리동", "제기동", "용신동"],
    "중랑": ["면목동", "상봉동", "중화동", "묵동", "망우동", "신내동"],
    "성북": ["정릉동", "길음동", "돈암동", "종암동", "석관동", "장위동", "삼선동", "안암동"],
    "강북": ["수유동", "미아동", "번동", "우이동"],
    "도봉": ["방학동", "창동", "쌍문동", "도봉동"],
    "노원": ["상계동", "중계동", "하계동", "공릉동", "월계동"],
    "은평": ["응암동", "역촌동", "불광동", "갈현동", "대조동", "구산동", "신사동", "증산동"],
    "서대문": ["홍제동", "홍은동", "남가좌동", "북가좌동", "연희동", "천연동", "냉천동"],
    "마포": ["성산동", "망원동", "연남동", "서교동", "합정동", "공덕동", "상암동", "도화동"],
    "양천": ["목동", "신정동", "신월동"],
    "강서": ["화곡동", "등촌동", "염창동", "가양동", "방화동", "마곡동", "공항동"],
    "구로": ["구로동", "개봉동", "고척동", "오류동", "신도림동", "항동"],
    "금천": ["시흥동", "독산동", "가산동"],
    "영등포": ["여의도동", "당산동", "문래동", "신길동", "대림동", "양평동", "도림동"],
    "동작": ["상도동", "사당동", "노량진동", "대방동", "신대방동", "흑석동"],
    "관악": ["봉천동", "신림동", "남현동"],
    "서초": ["반포동", "서초동", "잠원동", "방배동", "양재동", "내곡동"],
    "강남": ["개포동", "역삼동", "삼성동", "대치동", "논현동", "청담동", "압구정동", "수서동", "일원동", "도곡동"],
    "송파": ["잠실동", "방이동", "가락동", "문정동", "석촌동", "송파동", "마천동", "거여동", "오금동", "풍납동"],
    "강동": ["천호동", "성내동", "길동", "둔촌동", "암사동", "명일동", "상일동", "고덕동"],
}

# 수도권 시·인천 자치구 → 실재 동(위치스택 확장, 예: "용인 누수탐지 죽전동 …후기").
#   서울 밖 큰 시는 '시'까지만 나오면 덜 구체적이라 잘 안 잡힘 → 동까지 붙여 롱테일 확보.
#   ⚠️ 전부 실제 존재하는 동만. 신도시(동탄·분당·판교 등)는 이미 동네급이라 제외(구 dict 없음→폴백 유지).
METRO_DONG = {
    "과천": ["별양동", "부림동", "중앙동", "갈현동", "문원동", "원문동", "관문동", "주암동"],
    "용인": ["죽전동", "상현동", "동천동", "보정동", "신봉동", "풍덕천동", "마북동"],
    "안산": ["고잔동", "본오동", "사동", "성포동", "선부동", "원곡동", "와동"],
    "부천": ["중동", "상동", "심곡동", "원미동", "소사동", "역곡동", "송내동"],
    "고양": ["화정동", "행신동", "마두동", "주엽동", "대화동", "백석동", "정발산동"],
    "성남": ["정자동", "서현동", "수내동", "야탑동", "이매동", "판교동", "금광동"],
    "안양": ["안양동", "비산동", "관양동", "평촌동", "호계동", "박달동", "석수동"],
    "평택": ["비전동", "세교동", "동삭동", "용이동", "지산동", "서정동"],
    "시흥": ["정왕동", "은행동", "대야동", "신천동", "능곡동", "계수동"],
    "김포": ["사우동", "장기동", "운양동", "구래동", "풍무동", "걸포동"],
    "화성": ["병점동", "진안동", "반월동", "기산동", "반정동", "안녕동"],
    "남양주": ["다산동", "평내동", "호평동", "금곡동", "지금동", "도농동"],
    "의정부": ["신곡동", "민락동", "호원동", "가능동", "녹양동", "용현동"],
    "파주": ["금촌동", "교하동", "목동동", "야당동", "와동동", "문발동"],
    "광명": ["철산동", "하안동", "소하동", "광명동", "일직동", "노온사동"],
    "군포": ["산본동", "당동", "부곡동", "금정동", "대야동", "둔대동"],
    "의왕": ["내손동", "포일동", "오전동", "고천동", "청계동", "삼동"],
    "하남": ["신장동", "덕풍동", "망월동", "감일동", "학암동", "창우동"],
    "구리": ["인창동", "교문동", "수택동", "갈매동", "아천동"],
    "오산": ["원동", "궐동", "부산동", "세교동", "갈곶동", "대원동"],
    "이천": ["증포동", "창전동", "중리동", "관고동", "안흥동", "진리동"],
    "안성": ["봉산동", "아양동", "당왕동", "석정동", "옥천동", "서인동"],
    "수원": ["영통동", "인계동", "매탄동", "권선동", "정자동", "광교동", "우만동"],
    "인천 서구": ["청라동", "가정동", "석남동", "당하동", "원당동", "검암동", "신현동"],
    "인천 남동구": ["구월동", "논현동", "만수동", "간석동", "서창동", "도림동"],
    "인천 부평": ["부평동", "산곡동", "삼산동", "부개동", "십정동", "청천동"],
    "인천 계양구": ["작전동", "계산동", "효성동", "병방동", "임학동", "용종동"],
    "인천 연수구": ["연수동", "옥련동", "청학동", "동춘동", "선학동", "송도동"],
    "인천 미추홀구": ["주안동", "용현동", "학익동", "관교동", "도화동", "숭의동"],
}

def _gu_form(region):
    """'광진'/'광진구' → '광진구'. 서울 자치구가 아니면 원문 그대로."""
    r = (region or "").strip()
    if r.endswith("구") and r[:-1] in SEOUL_GU:
        return r
    if r in SEOUL_GU:
        return r + "구"
    return r

def _pick_dong(region):
    """서울 자치구면 실재 동 하나 랜덤 반환, 아니면 None(위치스택 미적용→구 단위 폴백)."""
    r = (region or "").strip()
    short = r[:-1] if (r.endswith("구") and r[:-1] in SEOUL_GU) else r
    lst = DONG_DICT.get(short) or METRO_DONG.get(short) or METRO_DONG.get(r)
    return random.choice(lst) if lst else None


def _region_popular_signal(reg):
    """지역의 인기글 신호 — 서울 자치구는 '{reg}구 누수탐지'(구 형태)를 **우선** 확인하고,
    구 형태에 인기글이 없을 때만 '{reg} 누수탐지'(짧은형)로 폴백한다(사용자 규칙 2026-07-24).
    반환: (matched_region, cafe_count) 또는 None(인기글 없음). cafe_count는 '거친' 경쟁 프록시."""
    cands = []
    if reg in SEOUL_GU and not reg.endswith("구"):
        cands.append(reg + "구")             # 구 우선(둘 다 있으면 구로)
    cands.append(reg)                         # 구에 없으면 짧은형 폴백
    for i, cand in enumerate(cands):
        if i:
            time.sleep(2)                       # 후보 간 지연(네이버 레이트리밋 완화)
        sig = analyze_popular_pc(f"{cand} {BUSINESS}")
        if sig["has_popular"]:
            return cand, sig["cafe_count"]
    return None


# ── 지역 → CTA 배너 그룹 매핑 (서울/경기/인천) ──
# 서울 = 서울 25개 자치구(+잠실 생활권). 인천 = "인천 …" 접두 + 인천 자치군/신도시.
# 그 외(경기 시군 + 수도권 신도시) = 경기.
_SEOUL_EXTRA = {"서울 중구", "잠실"}          # SEOUL_GU 에 없는 서울권 표기(종로는 SEOUL_GU 포함)
_INCHEON_EXTRA = {"강화", "옹진", "청라", "송도", "영종", "검단"}

def cta_group(region):
    """지역명을 CTA 배너 그룹('서울'/'경기'/'인천')으로 분류하고 해당 배너 파일 경로를 돌려준다.
    분당·일산은 경기 생활권이라 else 로 떨어져 '경기'가 된다."""
    r = (region or "").strip()
    base = r[:-1] if (r.endswith("구") and r[:-1] in SEOUL_GU) else r   # '마포구' → '마포' 정규화
    if base in SEOUL_GU or base in _SEOUL_EXTRA:
        grp = "서울"
    elif r.startswith("인천") or base in _INCHEON_EXTRA:
        grp = "인천"
    else:
        grp = "경기"
    return grp, os.path.join(CTA_DIR, CTA_FILES[grp])


# ── 2) 원고 생성 (gpt-5-mini, 후기형 롱폼 순수텍스트 · 2,000~3,000자) ──
# nusu2 양식(2026-07-23 테스트): 실제 노출 잘 되는 벤치마크와 동일한 [후기형 롱폼].
#   1인칭 경험 서술 허용, 「사진」 마커 없는 순수 텍스트. 조립부에서 사진/링크 마커를 앞에 붙인다.
# 글별 랜덤 시드 풀 — 유사문서(동일 골격/제목) 탈출용. 매 호출 랜덤 조합.
_BLDG = ["아파트", "빌라", "오피스텔", "단독주택", "상가 점포", "다세대주택", "원룸", "구축 아파트"]
_TRIGGER = ["천장에 번진 물 얼룩", "화장실 아래층 누수 항의", "갑자기 늘어난 수도요금", "벽지가 들뜨고 곰팡이",
            "베란다·발코니 물 고임", "보일러 압력이 자꾸 떨어짐", "주방 싱크대 하부 젖음", "현관·복도 바닥 축축함"]
_FOCUS = ["화장실 배관", "주방 급배수관", "벽 속 수도관", "보일러 난방배관", "옥상·발코니 방수층", "외벽 크랙 침투", "천장 슬래브"]
_HOOK = ["원인을 못 찾아 애먹다가 해결한 과정", "며칠 미루다 결국 전문 탐지 부른 이야기",
         "어디서 새는지부터 정확히 잡은 후기", "아래층 피해 커지기 전에 잡은 경험",
         "셀프로 헤매다 장비 탐지로 끝낸 후기", "증상만 보고 벽 안 뜯고 원인 특정한 과정",
         "물 자국 하나로 시작해 복구까지 간 기록", "수도요금 폭탄 원인을 배관에서 찾은 후기"]
# 글 전개 방식(골격) 프리셋 — 매 글 랜덤 선택해 서사 골격 자체를 흔든다(전지역 동일 골격=자기 유사문서 방지).
_STYLE = [
    "시간 흐름 순서대로(발견 → 악화 → 탐지 → 복구) 겪은 이야기처럼 차분하게 전개한다.",
    "'업체를 어떻게 골라야 하나'라는 고민을 중심축으로 전개한다(선택 기준을 글 앞쪽에서 깊게 다룬 뒤 작업 과정으로).",
    "비용·견적 궁금증을 축으로 전개한다(견적이 왜 달라지는지, 원인별로 처리와 비용이 어떻게 다른지를 설명하듯).",
    "셀프로 헤매다 전문 탐지로 해결되는 반전 구조로 전개한다(초반 삽질과 오판 → 장비 탐지의 차이를 부각).",
    "증상·부위별 Q&A(스스로 궁금해하고 답을 찾아가는) 흐름으로 전개한다.",
]
# 제목에 붙일 서비스변형·의도어 — 제목 다양화(경쟁 상위글은 지역+누수탐지+서비스변형+의도어 3~4요소 결합).
_TITLE_SVC = ["온수배관 누수", "빗물 누수", "보일러배관", "화장실 누수", "천장 물얼룩", "외벽 누수", "베란다 누수", "아래층 누수"]
_TITLE_INTENT = ["원인", "비용", "방법", "후기", "과정"]

def _body_prompt(region, dong=None):
    # ★핵심 키워드는 '인기글이 실제로 뜬 형태(scan matched)' 그대로 쓴다.
    #   예) 영등포 누수탐지(인기글 O)는 '영등포'로, 광진구 누수탐지(인기글 O)는 '광진구'로. 억지로 '구' 붙이지 않는다.
    kw = f"{region} {BUSINESS}"                   # 예) 영등포 누수탐지 / 광진구 누수탐지 (matched form)
    lead = f"{kw} {dong}" if dong else kw         # 제목 앞머리: 예) 영등포 누수탐지 여의도동 (※'서울' 접두 미사용)
    bldg = random.choice(_BLDG); trig = random.choice(_TRIGGER); foc = random.choice(_FOCUS); hook = random.choice(_HOOK)
    style = random.choice(_STYLE)
    svc = random.choice(_TITLE_SVC); intent = random.choice(_TITLE_INTENT)   # 제목 요소(글마다 다르게)
    loc_ctx = f"{region} {dong}" if dong else region   # 본문에서 언급할 지역(동 있으면 동까지)
    return "\n".join([
        f'너는 네이버 카페 지역글 전문 카피라이터다. 실제 의뢰인이 쓴 것 같은 "{kw}" [후기형 롱폼] 글을 쓴다.',
        f'업체명 "{BRAND}", 지역 "{loc_ctx}", 업종 "{BUSINESS}", 전화 "{PHONE}".',
        '',
        f'[이번 글 설정 — 반드시 이 설정으로 고유하게 써라(다른 글과 겹치지 않게)]',
        f'- 건물유형: {bldg} / 처음 발견한 증상: {trig} / 이번 누수의 핵심 부위: {foc}',
        f'- 글의 결(후킹 방향): {hook}',
        f'- 전개 방식(이 골격으로 써라): {style}',
        '',
        '[어조 — 매우 중요] 반드시 **존댓말 후기체**로 쓴다. 문장 종결은 "~했습니다 / ~였습니다 / ~했어요 / ~더라고요 / ~네요" 중에서 자연스럽게. '
        '실제로 누수를 겪고 업체를 불러본 사람이 카페 이웃에게 이야기하듯 1인칭으로. '
        '⚠️절대 금지1: "~했다/~였다/~이다/~된다/~같다" 평서체(반말·문어체) 종결. '
        '⚠️절대 금지2: "습니다"에 "요"를 붙인 "~했습니다요/~습니다요" 같은 어색한 이중 종결(존댓말+존댓말 겹침). "습니다"로 끝내거나 "어요"로 끝내되 둘을 섞지 마라. '
        '정보나열체를 피하고 겪은 이야기처럼 자연스럽게 흐르게 한다.',
        '',
        '[제목]',
        f'- 반드시 "{lead}"로 **시작**(이 위치 표기를 맨 앞에 그대로 두고, 쪼개거나 순서 바꾸지 마라). 그 뒤에 서비스변형 "{svc}" + 의도어 "{intent}" + 이번 설정에 맞는 새 후킹. 제목 24~46자.',
        f'  예) "{lead} {svc} {intent} …(구체 후킹)". 요소를 자연스럽게 녹여 한 문장처럼.',
        '- ⚠️절대 "물 얼룩 발견부터 원인 잡기까지 직접 불러본 후기" 같은 정형 문구를 쓰지 마라(이미 과다사용). 이번 설정에 맞는 구체 표현을 새로 지어라.',
        f'- 금지: 업체명("{BRAND}") 넣기, "추천/저렴/최고/문의주세요", 순위보장·최상급 표현, 물결(~)·대괄호·따옴표.',
        '',
        '[본문 — 아래 9개 요소를 모두 담되, 순서·비중은 위 [전개 방식]에 맞춰 재배열하라(정해진 순번 그대로 나열하지 말 것). '
        '위 [이번 글 설정]을 구체적으로 반영해 매번 다른 이야기로. 문단은 많이·각 문단은 짧게, 문단 사이는 빈 줄 하나]',
        f'  1) 누수 의심 상황 — 위 설정의 건물유형·증상으로 시작. **첫 문단(첫 100자) 안에 "{kw}"를 자연스러운 문장으로 정확히 1회** 넣어라.',
        '  2) 증상 상세 발견 — 천장·벽 물 얼룩, 곰팡이, 벽지 들뜸, 수도요금 증가, 아랫집 피해 등이 하나씩 드러나는 과정.',
        f'  3) 직접 못 잡아 전문 {kw} 업체를 알아보게 된 계기 — 셀프로는 원인 지점을 못 찾아 전문가가 필요했던 흐름.',
        '  4) 상담 과정 — 증상과 사진을 전달하고, 견적이 배관 구조·건물 형태·오염도에 따라 달라진다는 안내를 받은 대목.',
        '  5) 업체 선택 기준 고민 — 진입장벽이 낮은 업종이라 검증이 필요하다고 느껴 장비·경력·검수를 확인. '
        f'{BRAND} 이(가) 법인·장비·경력·최소 파손·사후 체계를 갖췄다는 점이 신뢰가 갔다(단, 허위 수치·건수·실적 없이 \'방식\'만).',
        '  6) 작업 당일 과정 — **극세부로**: 방문 → 전체 점검 → 열화상 카메라로 온도차 확인 → 청음으로 물소리 추적 → '
        '내시경으로 배관 내부 확인 → 수압 테스트로 교차검증 → 원인 지점 특정 → 최소 파손 접근 → 보수·복구. '
        '각 장비가 무엇을 잡아내는지 흐름 속에 자연스럽게 풀어라.',
        '  7) 부위별 상세 — 화장실·주방 배관, 벽 속 수도관, 보일러 난방배관, 옥상·발코니 방수층 등 부위마다 어떻게 다뤘는지.',
        '  8) 검수·마무리 — 원인과 범위를 재확인하고 사후 안내를 받은 대목.',
        '  9) 결론 — 업체 고를 때 가격만 보지 말고 장비·경력·검수·범위를 확인할 것. 초기 정확한 탐지가 결국 비용 절감이라는 마무리.',
        '',
        '[키워드 규칙]',
        f'- 핵심 키워드 "{kw}" 를 긴 글 전체에 **4~6회만 자연스럽게 분산**한다(과다 반복=스터핑 감점, 한 곳에 몰아넣기 금지).',
        '- 아래 연관 변형을 각각 자연스럽게 삽입(정확일치 반복 대신 이 변형들로 폭을 넓혀라): '
        f'"{region} 누수", 천장 누수, 배관 누수, 화장실 누수, 누수 원인, 온수배관 누수, 빗물 누수, 보일러배관 누수, 방수.',
        '- [검색의도 표현] 아래 의도를 각각 한 번씩 자연스러운 문맥(고민/질문/설명)으로 녹여라(나열 금지): '
        '누수탐지 비용·견적이 어떻게 정해지는지, 잘하는 업체 고르는 기준(추천 맥락), 실제 후기로서의 경험, 누수 원인을 어떻게 찾는지.',
        '- 작업범위 단어(천장·벽·화장실·주방·배관·수도관·보일러·옥상·발코니·방수층), '
        '문제상황 단어(물 얼룩·습기·곰팡이·벽지 들뜸·수도요금 증가·아랫집 피해), '
        '선택기준 단어(열화상·청음·내시경·수압·최소 파손·정확한 진단·사후)를 글 전체에 풍부하게 녹여라(콤마 나열 금지).',
        f'- [지역 엔티티] 본문에 지역명 "{loc_ctx}"를 2~3회 자연스럽게 언급하라(있는 그대로만 쓰고, 이 외의 다른 동·주소·번지는 절대 지어내지 마라). '
        f'상호 "{BRAND}"({PHONE})도 1~2곳 자연스럽게 넣어 지역-업체 결합 신호를 남겨라.',
        '',
        '[분량]',
        '- 공백 포함 **2,000~3,000자**(최소 1,800자). 짧으면 규칙 위반이다. 문단을 많이 나누되 서사를 충분히 길게 써라.',
        '',
        '[금지(절대)]',
        '- 지어낸 금액·시간·건수·성공률·년차 등 검증 불가 수치, 거짓 실적.',
        '- 순위보장·최상급 표현, 공감/조회/댓글 조작 언급.',
        '- (실제 현장사진이 함께 올라간다) 열화상·청음·수압장비로 점검하는 실제 작업을 자연스럽게 서술해도 좋다. '
        '단 "위 사진처럼/아래 사진" 같은 노골적 사진 지시어는 쓰지 말고, 겪은 일처럼 문장으로 풀어라.',
        '- 단어를 콤마로 나열만 하는 부자연 문장(반드시 문맥에 녹여 문장으로 풀어라).',
        '- 해시태그(#…)나 URL/링크를 본문에 넣지 마라(발행 시 자동으로 붙는다).',
        '- 매 호출 문장을 새로 지어라. 지역만 바꾼 복붙(유사문서)은 금지.',
        '',
        '반드시 JSON 하나만(코드펜스 금지): {"title":"제목","body":"본문(순수 텍스트, 사진 마커 없음)"}',
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

def _blen(b): return len((b or "").replace("\n", ""))   # 이 양식은 사진 마커가 없어 줄바꿈만 제거해 길이 측정


def _fix_title(region, title, dong=None):
    """위치 앞머리("서울 {지역} 누수탐지 {동}" 또는 "{지역} 누수탐지")를 제목 '맨 앞'에 보장(안전망).
    ※지역은 인기글이 뜬 형태(matched)를 그대로. 기존의 긴 제목은 살리고 절대 짧게 자르지 않는다."""
    kw = f"{region} {BUSINESS}"
    lead = f"{kw} {dong}" if dong else kw
    t = (title or "").strip().strip('"').strip()
    t = re.sub(r'\s*[—–]\s*', ', ', t).strip()   # 긴 대시(—/–) 금지 → 쉼표로(사용자 요구)
    t = re.sub(r',\s*,', ',', t).strip(' ,')
    if not t:
        return f"{lead} 원인 확인부터 복구까지 정리"
    if t.startswith(lead):
        return t                                  # 이미 위치스택으로 시작 → 그대로(길이 유지)
    # lead로 시작 안 하면: 앞쪽 위치/키워드 토큰을 걷어내고 lead를 붙인다.
    tail = t
    for tok in ["서울", _gu_form(region), region, (dong or "\x00"), BUSINESS, "누수", "탐지"]:
        tail = re.sub(rf'^\s*{re.escape(tok)}\s*', '', tail)
    tail = re.sub(re.escape(BRAND), '', tail)
    tail = re.sub(r'[—–\-~"\'\[\]]', ' ', tail)
    tail = re.sub(r'^[\s:,.]+', '', tail)
    tail = re.sub(r'\s{2,}', ' ', tail).strip()
    return f"{lead} {tail}" if tail else lead


def _plain_count(body):
    """평서체(~다/~했다/~였다 …, 존댓말 '니다' 제외) 종결 문장 수 — 어투 가드용."""
    sents = re.findall(r'([가-힣]{2,4})[.!?]', body or "")
    return sum(1 for s in sents if re.search(r'(다|였다|했다|된다|같다|이다)$', s) and not s.endswith("니다"))


def _clean_endings(body):
    """모델이 존댓말 강제 중 만드는 어색한 이중 종결('습니다요' 등)을 교정."""
    if not body:
        return body
    body = re.sub(r'습니다\s*요', '습니다', body)      # 했습니다요 → 했습니다
    body = re.sub(r'([가-힣])요\s*요(?=[\s.!?,]|$)', r'\1요', body)  # ~요요 → ~요
    body = re.sub(r'(더라고|네|어|아|에|워)요\s*요', r'\1요', body)
    body = re.sub(r'습니당(?=[\s.!?,]|$)', '습니다', body)
    return body


def _cf_generate(region, dong=None, note=""):
    """원고 1회 생성을 CF(/api/generate-cafe, variant=longform)로 위임 → {title, body}.
    프롬프트·시드풀은 서버(functions/lib/cafeLongform.mjs)가 만든다 → 로컬 OpenAI 키 불필요."""
    payload = {"variant": "longform", "businessKind": BUSINESS_KIND,
               "region": region, "dong": dong or "", "retryNote": note}
    r = requests.post(GENERATE_API, headers={"Content-Type": "application/json"},
                      data=json.dumps(payload), timeout=150)
    d = r.json()
    if not r.ok:
        raise RuntimeError(f"CF 원고 생성 실패({r.status_code}): {d.get('message', '')[:120]}")
    u = d.get("usage") or {}
    if u:
        _log(f"    [사용량] 입력 {u.get('input_tokens', '?')} · 출력 {u.get('output_tokens', '?')} 토큰")
    return {"title": d.get("title", ""), "body": d.get("body", "")}


def _generate_once(region, dong=None, note=""):
    """원고 1회 생성 → {title, body}. GENERATE_API 설정 시 CF 경유(로컬 키 0),
    미설정이면 레거시 직접 OpenAI 호출(OPENAI_KEY). note = 재생성 시 위반 지적 문구."""
    if GENERATE_API:
        return _cf_generate(region, dong, note)
    return _openai_review(_body_prompt(region, dong) + note)


def gen_nusu2(region, dong=None):
    """후기형 롱폼 순수텍스트 본문 생성. 1,800자 미만 또는 평서체 다수면 최대 3회 재생성."""
    best = _generate_once(region, dong)
    for _ in range(3):   # 길이(1,800+) & 존댓말 어투 둘 다 만족할 때까지(더 긴/깨끗한 쪽 유지)
        if _blen(best.get("body", "")) >= 1800 and _plain_count(best.get("body", "")) <= 1:
            break
        reason = []
        if _blen(best.get("body", "")) < 1800:
            reason.append(f'{_blen(best.get("body",""))}자로 1,800자 미만')
        if _plain_count(best.get("body", "")) > 1:
            reason.append('평서체(~다/~했다) 문장이 섞임 → 전부 존댓말(~했습니다/~어요)로')
        p = _generate_once(region, dong,
            note=f'\n\n[매우 중요] 방금 원고가 {" · ".join(reason)} 규칙 위반이다. '
            '모든 문장을 존댓말 후기체로 끝내고(평서체 절대 금지), 공백 포함 2,000~3,000자로 다시 작성하라.')
        # 존댓말이면서 충분히 긴 쪽을 우선. (기존은 길이만 봤음)
        if _plain_count(p.get("body", "")) <= _plain_count(best.get("body", "")) and \
           _blen(p.get("body", "")) >= min(1800, _blen(best.get("body", ""))):
            best = p
    title = _fix_title(region, best.get("title", ""), dong)
    body = _clean_endings((best.get("body", "") or "").strip())   # '습니다요' 등 어색 이중종결 교정
    return title, body


# ── 태그 ──
def _tags(region, dong=None):
    """태그 6개. 지역은 인기글 뜬 형태(matched) 그대로. 동이 있으면 지역+동 롱테일로."""
    rj = region.replace(" ", "")
    if dong:
        d = dong.replace(" ", "")
        return [f"{rj}누수탐지", f"{d}누수탐지", f"{d}누수", "누수원인", "배관누수", "누수탐지업체"]
    # 정확일치 2 + 서비스·주제 변형 3 + 의도 1(정확일치 편중 회피, 독립검증 2026-07-24).
    return [f"{rj}누수탐지", f"{rj}누수", "누수원인", "화장실누수", "배관누수", "누수탐지업체"]


# ── varyImage (JS canvas 로직 → PIL) ── [cafe_auto_publish.py 와 동일]
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


def _load_jpeg(path):
    """고정 자산(PNG)을 EXIF 정방향 보정 후 JPEG 바이트로 로드."""
    raw = open(path, "rb").read()
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
    b = io.BytesIO(); img.save(b, format="JPEG", quality=92)
    return b.getvalue()


# ── 업로드 + 큐 적재 ── [cafe_auto_publish.py 와 동일]
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


def _gen_bottom_banner(region):
    """옛 누수 파이프라인 배너(:8787, 지역 속성만 바꿔 생성)를 재사용. PNG bytes 반환, 실패 시 None."""
    try:
        q = os.environ.get("CAFE_BANNER_QUALITY", "low")
        m = os.environ.get("CAFE_BANNER_MODEL", "gpt-5-mini")
        r = requests.post(BANNER_API, headers={"Content-Type": "application/json"},
            data=json.dumps({"region": region, "topic": BUSINESS, "phone": PHONE, "mode": "hero",
                             "quality": q, "imageQuality": q, "model": m}), timeout=240)
        d = r.json()
        if d.get("imageDataUrl"):
            return base64.b64decode(d["imageDataUrl"].split(",", 1)[1])
        _log(f"    ⚠️ 배너 생성 실패(건너뜀): {d.get('message', r.status_code)}")
    except Exception as e:
        _log(f"    ⚠️ 배너 생성 예외(건너뜀): {str(e)[:80]}")
    return None


def _bytes_to_jpeg(raw):
    """임의 이미지 bytes(PNG 등) → EXIF 보정·RGB·JPEG bytes."""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
    b = io.BytesIO(); img.save(b, format="JPEG", quality=92)
    return b.getvalue()


def _paragraphize(body):
    """모델이 개행 없이 한 덩어리로 준 본문을 문장 단위로 2~3문장씩 묶어 문단(빈 줄 구분)으로 나눈다.
    이미 문단 구분(개행)이 충분하면 그대로 둔다. → 가독성 + 이미지 인터리브 둘 다 확보."""
    body = (body or "").strip()
    if body.count("\n") >= 4:
        return body
    sents = [s.strip() for s in re.split(r'(?<=[.!?])\s+', body) if s.strip()]
    if len(sents) < 4:
        return body
    paras, i = [], 0
    while i < len(sents):
        k = random.choice([2, 3])
        paras.append(" ".join(sents[i:i + k])); i += k
    return "\n\n".join(paras)


def _interleave_markers(body, n_mid):
    """상단 CTA(사진1) + 중간 이미지 n_mid장을 본문 문단 사이에 고르게 흩뿌려 마커를 삽입.
    이미지 순서 = [CTA, mid1, mid2, …] 로 마커 번호가 매겨진다(끝쪽 문단에도 배너가 오도록 균등 분포).
    반환: 마커가 삽입된 본문 텍스트(마커 개수 = n_mid + 1 을 정확히 보장)."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    if len(paras) < 3:                                   # 원고가 빈 줄 문단구분을 안 했으면 단일 개행으로 분리
        paras = [p.strip() for p in (body or "").split("\n") if p.strip()]
    gaps = []
    if n_mid and len(paras) >= 2:
        step = len(paras) / (n_mid + 1)                 # 전체에 균등 분포(마지막 gap이 끝부분에 옴)
        for i in range(n_mid):
            g = max(1, min(len(paras) - 1, int(round(step * (i + 1)))))
            while g in gaps and g < len(paras) - 1:
                g += 1
            gaps.append(g)
        gaps = sorted(set(gaps))
    out, marker, gi = ["「사진 1」", ""], 2, 0            # 사진1 = 상단 지역 CTA
    for idx, para in enumerate(paras):
        out.append(para)
        out.append("")                                  # 문단 뒤 빈 줄(문단 사이 띄우기 — 가독성)
        if gi < len(gaps) and gaps[gi] == idx + 1:
            out += [f"「사진 {marker}」", ""]; marker += 1; gi += 1
    while marker <= n_mid + 1:                           # 못 배치한 이미지는 끝에(정합 보장)
        out += [f"「사진 {marker}」", ""]; marker += 1
    return "\n".join(out).strip()


def make_and_queue(region, popular_verified=False):
    # 절대 안전장치: 네이버 통합검색에서 "지역+누수탐지" 인기글 영역이 확인된
    # 지역만 큐에 넣는다. 검색 응답 오류·파서 실패·직접 함수 호출은 모두 발행 거부.
    if not popular_verified:
        raise RuntimeError(
            f"인기글 미검증 키워드 발행 차단: {region} {BUSINESS} "
            "(main 선별 절차를 통해서만 등록 가능)"
        )
    grp, cta_path = cta_group(region)
    dong = _pick_dong(region)                          # 서울 자치구면 실재 동 하나(위치스택 "서울 {구} 누수탐지 {동}")
    _log(f"  원고 생성(gpt-5-mini)… (CTA 그룹: {grp}{' · 동: '+dong if dong else ''})")
    title, body = gen_nusu2(region, dong)
    body = _paragraphize(body)                         # 개행 없는 한 덩어리면 문장 단위 문단화(가독성+인터리브)
    _log(f"    제목: {title[:34]} · {_blen(body)}자")

    # 이미지 = [상단 지역 CTA] + [실사 N장 + 옛 누수배너 1장]을 본문 중간중간 인터리브(끝 텍스트에도 배너).
    #  ※ 고정 HERO(원고 캡처) 폐기 — 동일이미지 재사용이 유사문서/색인손실 원인(독립검증 2026-07-24).
    job_id = str(uuid.uuid4())
    base = random.randint(0, 10**9)
    pool = _real_photos()
    if not pool:
        raise RuntimeError(f"실사 사진 없음: {REAL_DIR}")
    n_slots = random.randint(*REAL_PER_POST)          # 2~3개 '페어(2장)' 슬롯
    photos = random.sample(pool, min(len(pool), n_slots * 2))   # 글마다 다른 실사 조합
    pairs = [photos[i:i + 2] for i in range(0, len(photos) - 1, 2)]   # 2장씩 묶음
    real_jpgs = [vary_image(_pair_photos(pr), base + 101 + i * 37) for i, pr in enumerate(pairs)]

    # 내장 배너 카드(누수탐지 기본 세트 2~8) 중 랜덤 subset — 지역생성 배너 대신 사용(사용자 지정 2026-07-24).
    cards = _fixed_cards()
    pick_cards = random.sample(cards, min(len(cards), CARDS_PER_POST)) if cards else []
    card_jpgs = [vary_image(_load_jpeg(c), base + 3001 + i * 53) for i, c in enumerate(pick_cards)]

    # 중간 이미지(mid) = 실사 페어 + 카드 배너를 섞는다. 단, 끝부분 텍스트에도 배너가 오도록 마지막은 카드로.
    mid = [("real", j) for j in real_jpgs] + [("card", j) for j in card_jpgs]
    random.shuffle(mid)
    if card_jpgs and mid and mid[-1][0] != "card":
        ci = max(i for i, (k, _) in enumerate(mid) if k == "card")
        mid.append(mid.pop(ci))
    mid_jpgs = [j for _, j in mid]
    cta_jpg = vary_image(_load_jpeg(cta_path), base + 7919)   # 상단 지역 CTA(서울/경기/인천)

    # 업로드: idx0 = 상단 CTA(사진1), idx1.. = mid(사진2..)
    up_paths = []
    for i, jpg in enumerate([cta_jpg] + mid_jpgs):
        up = upload_image(job_id, i, jpg)
        if not up:
            raise RuntimeError(f"이미지 업로드 실패 idx={i}")
        up_paths.append(up)

    body_wrapped = _interleave_markers(body, len(mid_jpgs))   # CTA=맨 위, 실사+배너는 본문 사이사이
    blocks = ([{"type": "image", "path": p} for p in up_paths] +
              [{"type": "text", "text": body_wrapped}] +
              ([{"type": "link", "url": BUSINESS_URL}] if ADD_LINK else []) +   # 링크카드(수기 원하면 CAFE_ADD_LINK=0)
              [{"type": "tags", "tags": _tags(region, dong)},
               {"type": "board", "name": BOARD_NAME}])
    ok, err = queue_job(job_id, title, blocks, company=COMPANY, region=region,
                        keyword=f"{region} {BUSINESS}", board=BOARD_NAME)
    if not ok:
        raise RuntimeError(f"큐 적재 실패: {err}")
    _log(f"  ✅ 큐 등록 완료: {job_id[:8]} (CTA[{grp}] + 실사페어 {len(real_jpgs)} + 카드 {len(card_jpgs)} 인터리브 · nusu2)")
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
KNOWN_PUBLISHED = {"과천", "광명", "잠실"}


def published_regions():
    """이미 발행/등록된 지역 = 재발행 금지. cafe_rank_posts 키워드 + cafe_publish_queue 제목 + 하드코딩.
    ※ 키워드가 동일("{지역} 누수탐지")하므로 기존 누수 발행분과 자연히 겹치지 않게 dedup 된다."""
    # FRESH 모드(새 카페): 구 카페 발행분(KNOWN_PUBLISHED·rank_posts·타 company 큐)은 무시하고,
    #   이 카페(COMPANY) 큐에 이미 넣은 지역만 제외 → 검증된 지역을 새 카페에서 재사용.
    if FRESH_REGIONS:
        regs = set()
        try:
            rows = requests.get(f"{SUPABASE_URL}/rest/v1/cafe_publish_queue", headers=sb_headers(),
                                params={"select": "title", "company": f"eq.{COMPANY}"}, timeout=30, verify=False).json()
            titles = [r.get("title") or "" for r in rows]
            for reg in DEFAULT_REGIONS:
                if any((reg in t and BUSINESS in t) for t in titles):
                    regs.add(reg)
        except Exception:
            pass
        for r in list(regs):
            if r.endswith("구") and r[:-1] in SEOUL_GU:
                regs.add(r[:-1])
        return regs
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
    # 큐(대기/처리/발행) 제목에 '지역 … 누수탐지'가 있으면 제외(best-effort)
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
    if not sb_auth.ready():
        _log("Supabase 인증 미비 — SUPABASE_URL + (SUPABASE_SERVICE_KEY 또는 publishable+내부계정) 필요"); return
    if not GENERATE_API and not OPENAI_KEY:
        _log("원고 생성 불가 — CAFE_GENERATE_API(CF 경유) 또는 OPENAI_API_KEY(직접) 중 하나 필요"); return

    _log(f"=== 카페 자동발행(nusu2): 업종 '{BUSINESS}' · 후보 {len(regions)}개 · 목표 {args.limit}건 ===")
    _log(f"실사 현장사진 {len(_real_photos())}장 풀(글당 {REAL_PER_POST[0]}~{REAL_PER_POST[1]}장) · CTA: 서울/경기/인천 3종")

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
            make_and_queue(reg, popular_verified=True)
        except Exception as e:
            _log(f"  ❌ 실패: {str(e)[:150]}")
    _log(f"\n=== 완료. publish_listener 가 순서대로 발행합니다. ===")


if __name__ == "__main__":
    main()
