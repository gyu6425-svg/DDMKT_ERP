# -*- coding: utf-8 -*-
"""카페 자동발행 오케스트레이터 (로컬).
   업종+지역리스트 → 인기글 뜨는 지역만 필터(PC lb_api, 브라우저X) → 통과 지역만
   원고(gpt-5-mini, 2000자+ 보장) + 배너(api:dev :8787) 생성 → 미세변형(varyImage) →
   cafe-images 업로드 + cafe_publish_queue 적재. 발행은 publish_listener 가 처리.

실행:  python cafe_auto_publish.py            # 기본 지역리스트에서 통과분 2개 발행 등록
       python cafe_auto_publish.py --limit 2 --regions 안양,과천,구로,잠실
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
from PIL import Image, ImageEnhance

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
requests.packages.urllib3.disable_warnings()

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
FIXED_DIR = os.path.join(ROOT, "public", "images", "cafe-fixed")
CAFE_BUCKET = "cafe-images"
UA_PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"

# 업체 고정정보
BUSINESS, BRAND, PHONE = "누수탐지", "든든한 누수탐지", "010-4614-4424"

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
# 배너 생성 API — 기본은 로컬 dev(:8787). 다른 PC(집)에서는 .env 의 CAFE_BANNER_API 에
# 운영 주소(https://<배포도메인>/api/generate-cafe-card)를 넣으면 로컬 서버 없이 생성 가능.
# ※ _load_env() 뒤에 있어야 .env 값이 반영된다.
BANNER_API = os.environ.get("CAFE_BANNER_API", "http://127.0.0.1:8787/api/generate-cafe-card")

def sb_headers():
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

def _log(m): print(m, flush=True)


# ── 1) PC 인기글 필터 (lb_api 봇 호출, 브라우저 불필요) ──
def has_popular_pc(keyword):
    su = f"https://search.naver.com/search.naver?query={quote(keyword)}"
    try:
        r = requests.get(su, headers={"User-Agent": UA_PC, "Accept-Language": "ko-KR,ko;q=0.9"}, timeout=15, verify=False)
        html = r.text
    except Exception:
        return False
    for u in re.findall(r"https://s\.search\.naver\.com/p/review/\d+/search\.naver\?[^\s\"'<>\\]+", html):
        u2 = htmlmod.unescape(u)
        try:
            b = requests.get(u2, headers={"User-Agent": UA_PC, "Referer": su, "Accept": "*/*"}, timeout=15, verify=False).text
        except Exception:
            continue
        if len(b) > 1000 and "인기글" in b and re.search(r"cafe\.naver\.com/[A-Za-z0-9_-]+/\d+", b):
            return True
    return False


# ── 2) 원고 생성 (gpt-5-mini, 2000자+ 보장) ──
def _review_prompt(region, count, ending="후기"):
    return "\n".join([
        f'너는 네이버 카페 지역글 전문 카피라이터다. 아래 업체의 "{region} {BUSINESS}" 홍보 카페 본문을 [후기형]으로 쓴다.',
        f'업체명 "{BRAND}", 지역 "{region}", 업종 "{BUSINESS}", 전화 "{PHONE}".',
        '시작 예: "안녕하세요 :) 얼마 전 누수 때문에 든든한 누수탐지 불러봤는데, 정리해서 공유해야겠다 싶어 글 남깁니다."',
        f'- 제목(가장 중요): 반드시 "{region} {BUSINESS}"로 **시작**(맨 앞 한 덩어리 대표키워드, 절대 쪼개거나 앞에 다른 말 붙이지 마라). '
        f'그 뒤에 구체적 상황·서비스 키워드(천장 물샘, 아파트·빌라, 아랫집 연락, 24시간 출동, 원인 확인, 방수 등)를 붙이고 **마무리는 "{ending}" 느낌**으로. 제목 22~40자. '
        f'좋은 예: "과천 누수탐지, 천장 물샘부터 아랫집 연락까지 직접 불러본 후기" / "부평 누수탐지 아파트 빌라 24시간 출동이 가능한 가이드". '
        f'제목 금지: 업체명("{BRAND}") 넣기, "~때문에/~골치였다면" 같은 가정·하소연형, 물결(~)·대괄호·따옴표. 매번 서술을 다르게 써라.',
        f'- 인사말 문단 먼저, 그 다음 「사진 1」~「사진 {count}」 각 한 줄 단독(정확히 {count}개).',
        '- 각 「사진」 뒤 본문 문단(3~5문장) 필수. 부제목만 있는 사진 없게. 문단과 문단 사이는 빈 줄 하나로 띄워라(가독성).',
        # 실제 이미지는 참고용 고정 이미지/배너라, 사진에 찍힌 장면인 것처럼 쓰면 글과 사진이 따로 논다.
        '- [매우 중요] 사진에 무엇이 찍혀 있는지 묘사하지 마라. 사진은 참고 이미지일 뿐이고 실제 현장 사진이 아니다. '
        '"진행 모습", "작업 사진", "시공 장면", "위 사진처럼", "사진에서 보이듯", "~하는 모습이 보이네요" 같은 '
        '사진 장면 서술·지시 표현을 본문과 부제목 어디에도 절대 쓰지 마라. '
        '대신 겪은 상황, 알아본 정보, 판단 기준, 느낀 점 위주로 서술하라.',
        f'- 부제목: 절반가량만 "부제목 : <내용>"(한 줄). "부제목" 두 번 쓰지 마라. 1~2개 지역({region})+키워드.',
        f'- 전화({PHONE}) 정확. 분량 공백포함 2,000~2,300자, 반드시 2,000자 이상.',
        '- 본문에 해시태그(#…)나 URL/링크는 절대 넣지 마라(발행 시 자동으로 붙는다).',
        '반드시 JSON 하나만(코드펜스 금지): {"title":"제목","body":"본문(「사진 N」 마커 포함)","topics":["'+str(count)+'개"]}',
    ])

def _openai_review(prompt):
    r = requests.post("https://api.openai.com/v1/responses",
        headers={"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"},
        data=json.dumps({"input": prompt, "model": "gpt-5-mini", "reasoning": {"effort": "low"}}), timeout=150, verify=False)
    j = r.json()
    txt = j.get("output_text") or ""
    if not txt:
        for it in j.get("output", []):
            for ct in it.get("content", []):
                if ct.get("type") == "output_text": txt += ct.get("text", "")
    # strict=False: 모델이 본문에 이스케이프 안 된 줄바꿈(제어문자)을 넣어도 허용.
    p = json.loads(txt[txt.index("{"):txt.rindex("}") + 1], strict=False)
    return p

def _blen(b): return len(re.sub(r'「사진\s*\d+」', '', b or '').replace("\n", ""))

# 발행용 홈페이지 링크(맨 마지막 줄 고정)
BUSINESS_URL = "https://ddnusu.imweb.me/"
# 제목 마무리 표현 풀 — 매번 다르게(사용자: 후기/가이드 등 다양하게)
TITLE_ENDINGS = ["후기", "솔직 후기", "직접 불러본 후기", "가이드", "총정리", "체크 가이드", "정리", "경험담", "꿀팁 정리"]

def _fix_title(region, title):
    """대표키워드 "{region} {BUSINESS}"를 제목 '맨 앞'에 붙이되, 기존의 긴 제목은 그대로 살린다.
    (모델이 대부분 처리 — 이건 안전망. 절대 제목을 짧게 자르지 않음.)"""
    kw = f"{region} {BUSINESS}"
    t = (title or "").strip().strip('"').strip()
    if not t:
        return f"{kw} 직접 불러본 후기, 원인 확인부터 마무리까지 정리했어요"
    if t.startswith(kw):
        return t                                  # 이미 대표키워드로 시작 → 그대로(길이 유지)
    # 대표키워드를 앞에 붙임. 선두 지역조각·업체명·가정형·대시 제거해 깔끔한 서술만 남김(길이 보존).
    tail = re.sub(rf'^\s*{re.escape(region)}\S*\s*', '', t)
    tail = re.sub(re.escape(BRAND), '', tail)                 # 업체명 제거(제목 중복 방지)
    tail = re.sub(r'[—–\-~"\'\[\]]', ' ', tail)               # 대시·물결·따옴표·대괄호 제거
    tail = re.sub(r'^[\s:,.]+', '', tail)
    tail = re.sub(r'\s{2,}', ' ', tail).strip()
    return f"{kw} {tail}" if tail else kw

def _tags(region):
    """에디터 '태그 입력칸'(최대 10개)에 넣을 대표키워드 — 본문 #해시태그가 아니라 블로그식 하단 태그칩.
    사용자 요청(2026-07-16): 사진1처럼 하단 태그로. 지역은 공백 제거해 한 덩어리 키워드로."""
    rj = region.replace(" ", "")
    return [f"{rj}누수탐지", f"{rj}누수", f"{rj}누수탐지업체", f"{rj}화장실누수",
            "누수탐지", "누수", "누수탐지업체", "화장실누수", "아파트누수", "든든한누수탐지"][:10]

def gen_review(region, count):
    ending = random.choice(TITLE_ENDINGS)   # 제목 마무리 매번 다르게
    best = _openai_review(_review_prompt(region, count, ending))
    for _ in range(3):   # 2000자 이상 나올 때까지 최대 3회 재생성(더 긴 쪽 유지) — 사용자: 2000자 밑 금지
        if _blen(best.get("body", "")) >= 2000:
            break
        p = _openai_review(_review_prompt(region, count, ending) +
            f'\n\n[매우 중요] 방금 본문이 {_blen(best.get("body",""))}자로 2,000자 미만이라 규칙 위반이다. 각 「사진」 뒤 본문을 5문장 이상으로 더 길고 구체적으로 늘려 반드시 공백 포함 2,100자 이상으로 다시 작성하라.')
        if _blen(p.get("body", "")) > _blen(best.get("body", "")):
            best = p
    title = _fix_title(region, best.get("title", ""))
    body = (best.get("body", "") or "").rstrip()   # 태그/링크는 본문이 아니라 별도 블록으로 처리
    return title, body


# ── 3) 배너 생성 (api:dev :8787, hero/low) ──
def gen_banner(region):
    # 화질/모델은 .env 로 조정 가능(기본: 저화질 low + gpt-5-mini = 최저비용).
    #   quality/imageQuality 둘 다 보냄 — 서버가 예전엔 imageQuality 만 읽어 low 가 무시됐었다.
    q = os.environ.get("CAFE_BANNER_QUALITY", "low")
    m = os.environ.get("CAFE_BANNER_MODEL", "gpt-5-mini")
    r = requests.post(BANNER_API, headers={"Content-Type": "application/json"},
        data=json.dumps({"region": region, "topic": BUSINESS, "phone": PHONE, "mode": "hero",
                         "quality": q, "imageQuality": q, "model": m}), timeout=240)
    d = r.json()
    if not d.get("imageDataUrl"):
        raise RuntimeError(f"배너 실패: {d.get('message', r.status_code)}")
    return base64.b64decode(d["imageDataUrl"].split(",", 1)[1])


# ── 4) 고정 이미지 로드 ──
def load_fixed():
    mani = os.path.join(FIXED_DIR, "manifest.json")
    names = json.load(open(mani, encoding="utf-8")) if os.path.exists(mani) else []
    out = []
    for n in names:
        fp = os.path.join(FIXED_DIR, os.path.basename(n))
        if os.path.exists(fp): out.append(open(fp, "rb").read())
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


# ── 6) 이미지 순서 (배너1장 = 북엔드: [banner, ...fixed, banner]) ──
def build_order(banner, fixed):
    return [banner] + list(fixed) + [banner]


# ── 7) 업로드 + 큐 적재 ──
def upload_image(job_id, idx, jpg):
    path = f"{job_id}/{idx:02d}.jpg"
    r = requests.post(f"{SUPABASE_URL}/storage/v1/object/{CAFE_BUCKET}/{path}",
        headers={**sb_headers(), "Content-Type": "image/jpeg", "x-upsert": "true"}, data=jpg, timeout=120, verify=False)
    return path if r.ok else None

def queue_job(job_id, title, blocks):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/cafe_publish_queue",
        headers={**sb_headers(), "Content-Type": "application/json", "Prefer": "return=minimal"},
        data=json.dumps({"id": job_id, "title": title, "manifest": blocks, "status": "pending"}), timeout=30, verify=False)
    return r.ok, (r.text[:200] if not r.ok else "")


def make_and_queue(region, fixed):
    count = len(fixed) + 2
    _log(f"  원고 생성(gpt-5-mini)…")
    title, body = gen_review(region, count)
    _log(f"    제목: {title[:30]} · {_blen(body)}자")
    _log(f"  배너 생성(api:dev)…")
    banner = gen_banner(region)
    order = build_order(banner, fixed)   # count 장
    job_id = str(uuid.uuid4())
    base = random.randint(0, 10**9)
    blocks = []
    for i, img in enumerate(order):
        jpg = vary_image(img, base + i * 7919 + 1)   # 전 이미지 미세변형(1·마지막 배너 포함)
        path = upload_image(job_id, i, jpg)
        if not path: raise RuntimeError(f"이미지 업로드 실패 idx={i}")
        blocks.append({"type": "image", "path": path})
    blocks.append({"type": "text", "text": body})
    # 본문 뒤: 홈페이지 링크(썸네일 카드로 삽입) + 하단 태그칩(에디터 태그칸)
    blocks.append({"type": "link", "url": BUSINESS_URL})
    blocks.append({"type": "tags", "tags": _tags(region)})
    ok, err = queue_job(job_id, title, blocks)
    if not ok: raise RuntimeError(f"큐 적재 실패: {err}")
    _log(f"  ✅ 큐 등록 완료: {job_id[:8]} (이미지 {count} + 본문)")
    return job_id


# 후보 지역 = 인천·경기·서울권만 (사용자 지정). 인기글 필터가 이 중에서 뜨는 것만 통과.
DEFAULT_REGIONS = [
    # 서울
    "강남", "서초", "송파", "강동", "강서", "양천", "구로", "금천", "영등포", "동작", "관악",
    "마포", "용산", "성동", "광진", "동대문", "중랑", "성북", "노원", "도봉", "강북", "은평", "잠실",
    # 경기
    "안양", "과천", "군포", "의왕", "부천", "광명", "시흥", "안산", "수원", "성남", "용인", "화성",
    "평택", "오산", "의정부", "남양주", "구리", "하남", "고양", "일산", "파주", "김포",
    # 인천
    "인천 부평", "인천 남동구", "인천 연수구", "인천 서구", "인천 계양구", "인천 미추홀구",
]

# 기존 수동 발행분(중복 발행 금지) — 안전 하드코딩. 자동발행분은 아래 DB 조회로 자동 누적.
KNOWN_PUBLISHED = {"과천", "광명", "잠실"}


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
    fixed = load_fixed()
    _log(f"고정 이미지 {len(fixed)}장 → 글당 사진 {len(fixed)+2}장")

    # 이미 발행/등록된 지역 제외(중복 발행 금지)
    done = published_regions()
    _log(f"이미 발행된 지역(제외): {sorted(done)}")
    todo = [r for r in regions if r not in done]

    passed = []
    for reg in todo:
        kw = f"{reg} {BUSINESS}"
        has = has_popular_pc(kw)   # 인기글 탭 뜨는 지역만
        _log(f"  [{'✅통과' if has else '❌인기글없음'}] {kw}")
        if has:
            passed.append(reg)
        time.sleep(2)
        if len(passed) >= args.limit:
            break
    _log(f"→ 발행 대상 {len(passed)}개: {passed}")
    if not passed:
        _log("발행할 신규 인기글 지역이 없습니다."); return
    if args.dry:
        _log("(dry-run: 생성·발행 안 함)"); return

    for reg in passed:
        _log(f"\n[{reg} {BUSINESS}] 생성·등록")
        try:
            make_and_queue(reg, fixed)
        except Exception as e:
            _log(f"  ❌ 실패: {str(e)[:150]}")
    _log(f"\n=== 완료. publish_listener 가 순서대로 발행합니다. ===")


if __name__ == "__main__":
    main()
