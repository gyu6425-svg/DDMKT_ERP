# -*- coding: utf-8 -*-
"""카페 인기탭 발굴 — 분산 워커 (각 PC가 자기 IP로 스캔).

  동작: Supabase 큐(cafe_kw_requests)에서 '이 플레이스 조회' 요청을 원자적으로 하나 집어
        (claim_kw_request RPC · 중복 방지) → 업종·지역 후보를 검색광고로 뽑고 → 자기 IP로
        인기탭 스캔(공유 캐시 우선) → 결과를 요청.result + 공유 캐시(cafe_kw_targets)에 저장.
  ⚠️ 옛 설명 정정(2026-08-06 실측): "여러 PC에 설치하면 IP가 분산돼 용량 = PC 수 배"는 거짓이다.
     워커는 항상 CF 경유(`p._USE_CF`)라 나가는 IP가 CF egress 하나뿐이고, 그 쿼터(약 300콜/10분)를
     모든 PC·프리스캔·프론트가 공유한다. PC를 늘리면 서로의 쿼터를 갉아먹을 뿐 총량은 그대로다.

  실행: python cafe_kw_worker.py          (상시 데몬 · 큐 폴링)
        python cafe_kw_worker.py --once   (한 건만 처리하고 종료 · 테스트)
  전제: ../.env 의 SUPABASE_URL · SUPABASE_SERVICE_KEY (큐/캐시 접근). docs/cafe-kw-queue.sql 실행됨.
"""
import sys
import os
import re
import time
import json
import socket
import datetime
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore

truststore.inject_into_ssl()
import requests
from dotenv import load_dotenv

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
load_dotenv(os.path.join(_HERE, "..", ".env"))
load_dotenv(os.path.join(_HERE, ".env"))
import cafe_kw_probe as p  # 스캔·파싱·검색광고 로직 재사용

SB = os.getenv("SUPABASE_URL", "").rstrip("/")
KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
WID = f"{socket.gethostname()}-{os.getpid()}"
POLL_SEC = 15
SCAN_GAP = 2.0  # 스캔 간격(무리없게)


def _ts():
    return time.strftime("%H:%M:%S")

# 수도권 지역 토큰(--regions 서울/경기/인천 처리용)
_SUDO = set((
    "강남 강동 강북 강서 관악 광진 구로 금천 노원 도봉 동대문 동작 마포 서대문 서초 성동 성북 송파 양천 영등포 용산 은평 종로 중랑 "
    "수원 성남 고양 용인 부천 안산 안양 남양주 화성 평택 의정부 시흥 파주 김포 광명 군포 오산 이천 양주 안성 구리 의왕 하남 여주 동두천 과천 포천 가평 양평 "
    "인천 미추홀 연수 남동 부평 계양 강화 송도 청라 영종 검단 분당 판교 동탄 광교 위례 미사 다산 별내 운정 삼송 배곧 죽전 수지 정자"
).split())


def _region_ok(kw, provinces, own):
    """지역 제약.
      · 비지역 니치(조개구이·물회 등)는 항상 통과.
      · 플레이스 '자기 지역'(own: 군산·전북 등)은 항상 통과 — 업체가 실제 있는 곳이니 무조건 우선.
      · provinces(서울/경기/인천)가 남아있으면 그 수도권만 통과(서비스지역 업체용).
      · 그 외 '타지역' 지역형 키워드는 컷(영종/부산 등이 군산 업체에 섞이는 것 방지)."""
    if not p.is_regional(kw):
        return True
    if own and any(rt and rt in kw for rt in own):
        return True
    if provinces and any(w in provinces for w in ("서울", "경기", "인천")):
        return any(t in kw for t in _SUDO)
    return False


# ── Supabase REST ────────────────────────────────────────────────────────────
def _claim():
    try:
        r = requests.post(f"{SB}/rest/v1/rpc/claim_kw_request", headers=H, json={"p_worker": WID}, timeout=20)
        rows = r.json() if r.status_code == 200 else []
        return rows[0] if rows else None
    except Exception:
        return None


def _cache_get(kw):
    try:
        r = requests.get(f"{SB}/rest/v1/cafe_kw_targets?keyword=eq.{quote(kw)}&select=*", headers=H, timeout=15)
        a = r.json() if r.status_code == 200 else []
        return a[0] if a else None
    except Exception:
        return None


def _cache_put(kw, r, vol):
    row = {
        "keyword": kw, "has_section": bool(r.get("has_section")), "theme": r.get("theme"),
        "verdict": r.get("verdict"), "volume": vol,
        "cafes": [x for x in (r.get("rows") or []) if x.get("kind") == "카페"],
        # 판정 호스트를 기록한다(HOST_TAG='/m'). 인기탭 유무는 (키워드,호스트)의 결정적 함수라,
        #   어느 호스트로 판정했는지 모르면 그 행은 신뢰할 수 없다(옛 로테이션 시절 행이 그렇다).
        "scanned_by": WID + HOST_TAG,
        "scanned_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),  # 재스캔 시각 갱신(음성 TTL 판정용)
    }
    try:
        requests.post(f"{SB}/rest/v1/cafe_kw_targets", headers={**H, "Prefer": "resolution=merge-duplicates"},
                      json=[row], timeout=15)
    except Exception:
        pass


def _finish(rid, status, result=None, note=None, extra=None):
    body = {"status": status, "note": note}
    if result is not None:
        body["result"] = result
    if extra:
        body.update(extra)
    try:
        requests.patch(f"{SB}/rest/v1/cafe_kw_requests?id=eq.{rid}", headers=H, json=body, timeout=15)
    except Exception:
        pass


# ── 후보 생성 ────────────────────────────────────────────────────────────────
#   ★ 지역형 vs 키워드형은 완전히 다른 처리 (deploy_type로 명시 구분):
#     · 지역형 : 지역이 핵심. 플레이스 '자기 지역'(군산 등) × 업종 계층. 지역 키워드 유지.
#     · 키워드형: 지역 무관. 제품/니치 키워드(고체향수 등)만. 지역 키워드는 전부 컷.
def _is_kw_type(deploy_type, cats):
    """요청의 deploy_type 우선. 없으면 업종으로 추정(음식/청소/인테리어 등 위치형=지역형)."""
    dt = (deploy_type or "").replace(" ", "")
    if "키워드" in dt:
        return True
    if "지역" in dt:
        return False
    # deploy_type 없을 때 폴백: 음식점은 확실히 지역형. 그 외는 지역형 기본(대부분 로컬 업체).
    return False


def _own_brand_tokens(name, cats, region_toks):
    """업체명에서 '이 업체만의 고유어'를 뽑는다. is_brandish 는 고정 블록리스트라 신규 업체 브랜드를 모른다.
       실측(2026-08-06) '성수역 퓨어약국' → 플레이스 키워드 '성수퓨어'가 후보로 살아남아
       엉뚱한 맛집 인기탭('성수 퓨전중식당')에 붙었다. 검색량도 10(=사실상 0)이라 팔 수 없는 키워드다.
       ★ 지역명·업종어는 브랜드로 보지 않는다 — '광교횟집'의 '광교'는 실제 지역(신도시)이라
         브랜드로 처리하면 멀쩡한 후보를 통째로 죽인다."""
    toks = set()
    cat_words = {c for c in (cats or []) if c}
    for word in re.split(r"[\s()·,/]+", (name or "")):
        word = re.sub(r"[^가-힣a-zA-Z0-9]", "", word)
        if len(word) < 2:
            continue
        for c in cat_words:                       # 업종 접미 제거: 퓨어약국 → 퓨어
            if len(c) >= 2 and word.endswith(c) and len(word) > len(c):
                word = word[: -len(c)]
                break
        if len(word) < 2 or word in cat_words:
            continue
        if word in region_toks:                   # 지역명은 브랜드가 아니다
            continue
        # 행정/역 접미를 뗀 코어가 지역이면 그것도 지역이다. 역세권 마스터가 완전하지 않아도
        #   ('성수역'이 서울 281역에 없었다) '성수'로 판별된다 — 데이터 구멍에 안 걸리는 판정.
        core = re.sub(r"(역|동|구|시|군|읍|면|리|가)$", "", word)
        if len(core) >= 2 and core in region_toks:
            continue
        toks.add(word)
    return toks


def _candidates(info, provinces, pid, deploy_type):
    cats = [x.strip() for cc in info["cats"][:2] for x in re.split(r"[,·/]", cc) if x.strip()]
    kw_type = _is_kw_type(deploy_type, cats)
    cores = []
    for c0 in cats + info["keywords"]:
        core = c0
        for suf in ("디자인", "교육", "요리", "전문점", "전문", "공사", "서비스", "센터"):
            if core.endswith(suf) and len(core) - len(suf) >= 2:
                core = core[: -len(suf)]
                break
        for x in (c0, core):
            if x and len(x) >= 2 and x not in cores and not p.is_brandish(x):
                cores.append(x)

    known_master = set()          # 이 시도의 행정·역세권·신도시 토큰 — 브랜드 오판 방지에 쓴다
    if kw_type:
        # ── 키워드형: 지역 완전 배제. 제품/니치 키워드만(전국). 지역 계층·주소 조회 안 함. ──
        own, provinces, hier, narrow, city_seeds = set(), set(), [], [], []
    else:
        # ── 지역형: 플레이스 '자기 주소'에서 지역 계층. 업체가 실제 있는 곳이 기준. ──
        road, jibun = p.place_address(pid) if pid else ("", "")
        rh = p.region_hierarchy(road, jibun)                   # [전북도,전북,군산,선유남…]
        narrow = p.region_tokens(road, jibun)                  # 시·구·동(광역 제외, 시 우선) — 실질 타깃
        own = set(t for t in (narrow + rh) if t)
        place_sido = p._sido(road, jibun)                      # '전북','서울','경기'…
        if place_sido:
            # ★ 상호에 든 지역어를 브랜드로 오판하지 않게. '성수역 퓨어약국'의 '성수역'은
            #   실제 역세권 토큰인데, 주소에서 안 나온다는 이유로 브랜드 취급하면 좋은 후보를 버린다.
            known_master = set(_region_tokens_for([place_sido], True))
        food = any(any(h in c for h in p._FOOD_HINT) for c in cats)
        # 시 시드 = '{시} {업종}' (바 지역명은 연관어 거의 없음. '군산 맛집'이라야 500여개 반환).
        broad = "맛집" if food else (cats[0] if cats else "")
        city_seeds = [f"{t} {broad}" for t in narrow[:2] if broad]
        # 잘못된 지역 기본값 자동보정: 맛집(위치형)은 서비스지역 개념 없음→자기 지역만.
        #   서비스형(청소 등)은 플레이스가 provinces 안이면 서비스지역 유지, 밖이면 자기 지역.
        if food or (place_sido and place_sido not in provinces):
            provinces = set()
        bh = p.business_hierarchy(cats, info["keywords"])
        hier = []
        for bt in bh:
            if bt != "맛집":                                   # '맛집' 단독(전국)은 너무 넓어 제외
                hier.append(bt)
            # 이미 지역어를 품은 업종어에 지역을 또 붙이지 않는다 — '성수 성수역약국' 같은
            #   검색량 0짜리가 대량 생성돼 라이브 상한(28)을 먹고 진짜 후보를 밀어냈다(실측 2026-08-06).
            if any(t and t in bt for t in own):
                continue
            for rl in rh:
                hier.append(f"{rl} {bt}")
                if " " not in bt:
                    hier.append(f"{rl}{bt}")

    vol = {}
    # ★ 시(市) 시드를 '가장 먼저' 호출 — hier(지역×업종 직접 생성)어는 searchad 코어엔 안 잡혀
    #   volume 0 → 정렬에서 밀려 채택조차 안 되던 버그('군산 맛집' 117,700 미스캔). 개별 백필은
    #   콜 폭주로 스로틀되므로, searchad_keywords('군산') 1콜이 그 도시 키워드 500여개를 한 번에
    #   주는 걸 이용해 '스로틀 전에' 확보하고 hier 후보 볼륨을 무한 매칭으로 일괄 수확.
    city_vol = {}
    for seed in city_seeds:  # '{시} {업종}' 시드 — 코어보다 먼저(스로틀 전 확보)
        for r in p.searchad_keywords(seed):
            kw = (r.get("keyword") or "").replace(" ", "")
            if kw:
                city_vol[kw] = max(city_vol.get(kw, 0), r.get("total", 0))
    # 검색광고 보강(니치·서비스지역 확장)
    for core in cores[:8]:
        for kw, tot in p.searchad_candidates(core, min_total=80, limit=40):
            vol[kw] = max(vol.get(kw, 0), tot)
    # hier 후보에 시 시드 볼륨 백필
    for k in hier:
        if vol.get(k, 0) == 0:
            rv = city_vol.get(k.replace(" ", ""), 0)
            if rv:
                vol[k] = rv
    # 후보 통합 + 필터(오프토픽·타지역·자기브랜드 컷). 키워드형은 _region_ok가 지역형 키워드를 전부 컷.
    own_brand = _own_brand_tokens(info.get("name"), cats, own | set(narrow) | known_master)

    def _keep(k):
        return (k and not p.is_brandish(k) and not p.is_offtopic(k)
                and not any(b in k for b in own_brand)      # 자기 상호는 남의 인기탭에 잘못 붙는다
                and _region_ok(k, provinces, own))

    base = []
    for k in hier + cats + info["keywords"]:
        if _keep(k) and k not in base:
            base.append(k)
    for kw in sorted(vol, key=lambda k: -vol[k]):
        if _keep(kw) and kw not in base:
            base.append(kw)
    # 지역형=로컬 우선. 그 안에서도 시·구·동(narrow)을 광역(도)보다 먼저 — 도 단위 헛스캔 축소.
    def _rank(k):
        if narrow and any(t in k for t in narrow):
            return 0  # 시·구·동
        if own and any(t and t in k for t in own):
            return 1  # 광역(도) 등 나머지 로컬
        return 2      # 비지역 니치
    base.sort(key=lambda k: (_rank(k), -vol.get(k, 0)))
    return [(k, vol.get(k, 0)) for k in base]


def _real_volume(kw):
    """검색광고에서 이 키워드의 실제 월검색량. hier(지역×업종)로 생성돼 volume 0으로 채택된
    결과를 고객 화면용으로 백필. CF 경유 공식 API라 IP 위험 없음. 없으면 0(진짜 저검색 지역어)."""
    norm = kw.replace(" ", "")
    try:
        for r in p.searchad_keywords(kw):
            if (r.get("keyword") or "").replace(" ", "") == norm:
                return r.get("total", 0)
    except Exception:
        pass
    return 0


def _region_tokens_admin(gu):
    """행정구 문자열 → 구/시 토큰. '수원시 장안구'/'고양시덕양구' 분리 + 접미형·기본형. (프론트 guTokens 와 동일 규칙)"""
    toks = set()
    parts = []
    for part in (gu or "").split():
        mm = re.match(r"^(.+?시)(.+구)$", part)
        parts += [mm.group(1), mm.group(2)] if mm else [part]
    for part in parts:
        part = part.strip()
        if not part:
            continue
        toks.add(part)
        base = re.sub(r"(특별자치시|특별자치도|특별시|광역시|자치시|자치구|시|군|구)$", "", part)
        if len(base) >= 2:
            toks.add(base)
    return toks


def _sb_page(url):
    """PostgREST 1000행 절단 방지 — offset 페이지네이션. 실패는 None(부분 결과로 진행 금지)."""
    rows, off = [], 0
    while True:
        try:
            r = requests.get(f"{url}&limit=1000&offset={off}", headers=H, timeout=30).json()
        except Exception:
            return None
        if not isinstance(r, list) or not r:
            break
        rows += r
        if len(r) < 1000:
            break
        off += 1000
    return rows


# 지역 토큰 마스터의 종류 → 스캔 단계. '빠름'은 기본 스캔, '깊이'는 '더 찾기'에서만.
#   왜 역세권·신도시가 빠름인가: 실측(2026-08-06) 네일 역세권 적중 57%·신도시 43%,
#   입주청소 신도시 60% — 동(업종에 따라 0~74%)보다 안정적으로 높다.
_KIND_FAST = ("sido", "sigungu", "newtown", "district", "station", "sigungu_suffix")
_KIND_DEEP = ("dong", "eupmyeon")


def _tokens_from_master(sidos):
    """cafe_region_token(지역 토큰 마스터) 조회 → (빠름, 깊이, 커버된 시도).
       마스터에 아직 안 채워진 시도는 커버에서 빠지고, 호출부가 행정동 테이블로 메운다(누락 0)."""
    inlist = ",".join(f'"{s}"' for s in sidos)
    rows = _sb_page(f"{SB}/rest/v1/cafe_region_token?sido=in.({inlist})&active=is.true"
                    f"&select=token,kind,sido,prio&order=prio.asc,token.asc")
    if not rows:
        return [], [], set()                    # 테이블 없음/미적재 → 조용히 기존 경로로
    fast = [r["token"] for r in rows if r.get("kind") in _KIND_FAST]
    deep = [r["token"] for r in rows if r.get("kind") in _KIND_DEEP]
    covered = {r.get("sido") for r in rows if r.get("sido")}
    return fast, deep, covered


def _region_tokens_for(sidos, include_dong=False):
    """선택 시도들의 지역 토큰. 기본=시도·시군구·신도시·역세권 — 적중률 높은 축부터.
       include_dong=True('더 찾기') 일 때만 동·읍면까지 추가.
       1순위 출처는 지역 토큰 마스터(역세권·신도시 포함), 마스터에 없는 시도는 행정동 테이블로 보완."""
    if not sidos:
        return []
    m_fast, m_deep, covered = _tokens_from_master(sidos)
    rest = [s for s in sidos if s not in covered]
    if not rest:
        return m_fast + m_deep if include_dong else m_fast
    inlist = ",".join(f'"{s}"' for s in rest)
    # ★ PostgREST 는 limit 을 크게 줘도 1000행에서 자른다 → offset 페이지네이션 필수.
    #   옛 코드는 limit=20000 이면 다 온다고 믿었다. 실측(2026-08-05): 17개 시도 선택 시
    #   토큰 483개 중 204개만 잡히고 '강남'이 통째로 빠지는데 경고 없이 '완료'로 끝났다.
    #   (수도권 3개만 쓰던 동안은 767행 < 1000 이라 우연히 안 터졌다.)
    rows = _sb_page(f"{SB}/rest/v1/cafe_region_dong?sido=in.({inlist})&select=gu,dong&order=gu.asc,dong.asc")
    if rows is None:
        return []                           # 부분 결과로 조용히 진행하지 않는다 — 호출부가 실패로 처리
    # ★ 시도명 자체도 토큰 — 보통 그 제품의 최대 검색량 키워드다('서울 누수탐지' ≫ '강남 누수탐지').
    #   실측(2026-08-04): 광역시 8/8 전부 인기탭, 道도 강원·충북·전남·경북·경남·제주 등 다수 인기탭.
    #   접미형('서울시'·'강원도')은 전부 섹션없음이라 짧은 이름만 넣는다.
    gu_toks = {s.strip() for s in rest if s and s.strip()}
    dong_toks = set()
    for r in (rows if isinstance(rows, list) else []):
        gu_toks |= _region_tokens_admin(r.get("gu") or "")
        d = (r.get("dong") or "").strip()
        if d:
            dong_toks.add(d)
    # ★ '좋은 것부터' 정렬 — target 조기 종료와 '+N 더 찾기'가 의미를 가지려면 순서가 효용순이어야 한다.
    #   실측 적중률(2026-08-06): 시도 16.2% · 시군구 기본형 12.3% · 시군구 접미형은 기본형 대비 5배 열세
    #   (같은 지역 2,316쌍 중 기본형 적중 489 vs 접미형 100) · 동은 업종 의존(네일 58%, 청소 0%).
    #   순서: 시도 → 시군구 기본형 → 시군구 접미형 → 동. 순서만 바꿀 뿐 전수 범위는 그대로다(누락 없음).
    sido_set = {s.strip() for s in rest if s and s.strip()}
    admin = gu_toks - sido_set
    suf = set()
    for t in admin:
        b = re.sub(r"(특별자치시|특별자치도|특별시|광역시|자치시|자치구|시|군|구)$", "", t)
        if b != t and len(b) >= 2 and b in admin:
            suf.add(t)                                      # '강남구'(기본형 '강남'도 있음) = 접미형 → 뒤로
    ordered = sorted(sido_set) + sorted(admin - suf) + sorted(suf)
    deep = sorted(dong_toks - gu_toks)
    # 마스터(역세권·신도시 포함) 먼저, 마스터에 없는 시도는 행정동 유래 토큰으로 이어 붙인다.
    fast = m_fast + [t for t in ordered if t not in set(m_fast)]
    if not include_dong:
        return fast                                         # 기본: 시도·시군구·신도시·역세권
    seen = set(fast)
    return fast + [t for t in (m_deep + deep) if not (t in seen or seen.add(t))]


def _cache_get_many(kws):
    """배치 캐시 조회 — keyword in.() 로 수백 개를 몇 번의 쿼리로. {정규화kw: row}.
       재스캔 시 토큰마다 개별 GET(수백 회) 안 하도록 → 재스캔 대폭 단축."""
    out = {}
    for i in range(0, len(kws), 80):
        chunk = kws[i:i + 80]
        vals = ",".join('"' + k.replace('"', '') + '"' for k in chunk)
        try:
            r = requests.get(f"{SB}/rest/v1/cafe_kw_targets?keyword=in.({quote(vals)})"
                             f"&select=keyword,has_section,theme,verdict,volume,cafes,scanned_by,scanned_at", headers=H, timeout=20)
            for row in (r.json() if r.status_code == 200 else []):
                out[(row.get("keyword") or "").replace(" ", "")] = row
        except Exception:
            pass
    return out


# 인기탭 채택 판정(공통) — '카페분산(기회)' + '블로그섹션(카페없음)=카페무경쟁'을 채택. '카페독점'·'섹션없음'·'레시피' 제외.
#   ※ 블로그섹션 = 인기글 섹션은 있는데 카페가 아직 0 → 우리가 무혈입성할 최고 기회라 포함(사장님 결정 2026-08).
def _is_pop(r):
    v = str(r.get("verdict", ""))
    return bool(r.get("has_section")) and (v.startswith("카페분산") or v.startswith("블로그섹션")) and "레시피" not in (r.get("theme") or "")


# 음성(섹션없음·비관련) 캐시 유효기간 — 네이버가 나중에 인기글 섹션을 붙일 수 있어 오래된 음성은 위음성이 됨.
#   양성은 무기한 신뢰(진짜 인기탭은 안정적), 음성만 이 기간 지나면 재검증. CF=직접 실측 일치로 원인이 시간차임을 확인(2026-08-04).
NEG_TTL_DAYS = 21

# 빈200 방어(_classify_live) 투입 시각 — 이 이전에 캐시된 '음성'은 빈 응답을 '섹션없음'으로 굳혔을 수 있어
#   신뢰하지 않는다(실측: 돌봄 5개 업종 496조합이 전부 섹션없음으로 박혀 재스캔이 막혀 있었다).
#   PID 목록으로 거르는 대신 시각 기준으로 판정해야 누락 없이 걸러진다. 양성은 영향 없음.
FIX_CUTOFF_UTC = "2026-08-04T11:00:00+00:00"

# 판정 호스트 마커 — scanned_by 끝에 붙인다(스키마 변경 없이 기록). 현재 판정은 m.search(모바일) 고정.
#   이 마커가 없는 행 = 옛 PC/모바일 로테이션 시절 판정이라 어느 호스트인지 알 수 없다 → 신뢰 불가.
HOST_TAG = "/m"

# 차단 감지 시 백오프(초). 실측(2026-08-06): 차단 후 회복까지 212초·272초 → 150초 재시도는 거의 항상 실패했다.
BLOCK_BACKOFF = 300

# 차단으로 판정하기까지 필요한 '연속 실패' 횟수.
#   ★ PAR=1 이라 청크=1건이다. 1회 실패로 차단이라 보면 일시 오류 하나가 스캔 전체를 죽인다
#     (실측 #198: 11/120 에서 중단, 그때 CF 10분 롤링 170 — 한도 300의 57%로 차단이 아니었다).
#   진짜 차단은 연속으로 실패하므로 3회면 충분히 잡힌다. 그 사이 오류는 errs 로 세고
#   _err_budget(25건) 이 완성도를 따로 지킨다.
BLOCK_STREAK = 3

# 요청(스캔 1건) 사이 휴식(초). 회당 속도가 아니라 누적량이 차단을 부르므로 건 사이를 띄운다.
#   회당 목표: 164조합 ≈ 3~4분(사장님 기준 10분 이내). 연속 처리 시에도 시간당 콜수를 낮춘다.
REQ_REST = 45


def _err_budget(n):
    """미판정 허용치 — 절대 상한을 둔다. 옛 코드는 15% 비율이라 조합이 커질수록 자동 완화됐다
       (2,924조합이면 438건 오류에도 '완료'). 규모와 무관하게 25건을 넘으면 결과가 불완전하다."""
    return min(25, max(5, 0.15 * max(n, 1)))


def _cache_trust(c):
    """재스캔 시 이 캐시를 그대로 신뢰할지 — 신뢰=건너뜀, 불신=라이브 재검증.
       ① '저검색'은 판정 아님 → 불신.
       ② 양성(_is_pop=인기탭)은 항상 신뢰(진짜 인기탭은 안정적).
       ③ 음성(섹션없음·비관련):
          - 'prescan'(대량 사전스캔) 산출물은 위음성 다수 확인(소방업체 표본 8중 6 실제 섹션 有) → 항상 불신.
          - 그 외 음성도 NEG_TTL_DAYS(21일) 지나면 불신 → 재검증(네이버가 섹션 추가하는 시간차 대응).
          지연 재검증이라 블록 부담 없음. 재스캔되면 _cache_put이 scanned_by=WID·scanned_at 갱신 → 자가치유."""
    if str(c.get("verdict", "")) == "저검색":
        return False
    # ★ 판정 호스트가 기록되지 않은 행(옛 PC/모바일 로테이션 시절)은 양성·음성 모두 신뢰하지 않는다.
    #   · 음성: PC로 판정됐으면 위음성일 수 있다(실측 m/pc 불일치 5.5%, 캐시 음성 재검증 시 3.5%가 실제 양성).
    #   · 양성: PC에서만 잡힌 것이면 팔아도 measure_cafe_rank(m.search 전용)가 측정 못 해 미달성이 된다.
    #   재스캔되면 모바일 판정으로 HOST_TAG 가 붙어 자가치유된다.
    if not str(c.get("scanned_by") or "").endswith(HOST_TAG):
        return False
    if _is_pop(c):
        return True
    if "비관련" in str(c.get("verdict") or ""):
        return False   # 토픽 규칙은 바뀔 수 있으니 '비관련(오탐)' 강등 캐시는 항상 라이브 재검증(규칙 변경 자가치유)
    # prescan 산출물 음성은 항상 불신. ⚠️ startswith 로 봐야 한다 — HOST_TAG 도입 후 prescan 이
    #   'prescan/m'·'prescan-v2/m' 으로 쓰는데 == 비교면 그게 다 빠져나가 21일간 신뢰됐다.
    if str(c.get("scanned_by") or "").startswith("prescan"):
        return False
    sa = str(c.get("scanned_at") or "")
    if not sa:
        return False   # 시각 불명 음성 → 재검증
    if sa < FIX_CUTOFF_UTC:
        return False   # 빈200 방어 이전 음성 → 재검증(위음성일 수 있음)
    cutoff = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=NEG_TTL_DAYS)).isoformat()
    return sa >= cutoff   # 최근 음성만 신뢰(오래된 건 재검증)


def _disp_theme(r):
    """결과 표시용 테마 — 카페무경쟁이면 태그를 앞에 붙여 구분."""
    t = r.get("theme") or ""
    if str(r.get("verdict", "")).startswith("블로그섹션"):
        return ("[카페무경쟁] " + t).strip()
    return t


# 오탐 필터 — 저검색 지역은 인기글 섹션이 떠도 글이 그 키워드와 무관(웨딩홀·캠핑·골프 등 generic 채움)이다.
#   진짜 인기탭 = 카페+블로그 통틀어 '제품어(+지역형이면 지역코어)가 한 제목에 같이 있는 글'이 최소 1개.
#   ※ 카페슬롯 off-topic 1개가 verdict를 카페분산으로 뒤집어도 블로그의 진짜 글을 보게 → 재현율 보전(독립검증).
def _norm(s):
    return (s or "").replace(" ", "")


def _region_core(tok):
    """지역 토큰 → 매칭용 코어(접미 제거). '영동군'→'영동', '청주시'→'청주', '흥덕구'→'흥덕'."""
    t = _norm(tok)
    base = re.sub(r"(특별자치시|특별자치도|특별시|광역시|자치시|자치구|시|군|구|동|읍|면)$", "", t)
    return base if len(base) >= 2 else t


# 의미 없는 일반 접미/수식 조각 — 제목에 있어도 '그 업종 글'이라는 증거가 못 된다.
#   도출 근거(실측 2026-08-04): 인기글 제목 436개 코퍼스에서 ① 5%↑ 등장 업종이 3개 이상이고
#   ② 최상위 업종 집중도 55% 미만인 조각 = 업체·정리·사무실 + 검색수식어(추천·비용·설치).
#   '청소'(집중도 92%)·'이사'(71%)·'점검'(88%)은 도메인어라 제외하지 않는다.
_GEN_FRAG = {
    "업체", "업소", "전문", "센터", "공사", "시공", "서비", "비스", "관리", "정리",
    "견적", "비용", "가격", "추천", "순위", "상담", "설치", "대행", "사무", "무실", "사무실",
}


def _product_grams(product):
    """제품어 → 매칭용 2자 조각. 한국어 복합어(소방+업체, 입주+청소, 방문+요양)를 쪼개
       '통짜 매칭' 실패를 없앤다. 조각이 전부 일반어로 걸러지면 통짜로 되돌린다."""
    pn = _norm(product)
    grams = [pn[i:i + 2] for i in range(len(pn) - 1)] or [pn]
    grams = [g for g in grams if g not in _GEN_FRAG]
    return pn, (grams or [pn])


# 수량·범위를 나타내는 꼬리 — 지역명 뒤엔 거의 안 붙고, 일반명사 뒤엔 자주 붙는다.
#   ⚠️ 위치조사(에·에서·은·는·을·를)를 넣으면 안 된다 — '강남에 있는 네일샵'처럼 지역명에도
#      똑같이 붙어 진짜 지역을 죽인다(실측에서 위음성 0을 지킨 핵심).
_QTY_TAIL = re.compile(r"(별|대비|이내|내에|범위|짜리|만원|초과|미만|절약|산정|한도|안에)")


def _region_used_as_region(rows, core):
    """이 인기탭이 '그 지역' 것인가, 아니면 지역명과 같은 일반명사 글인가.
       예: '예산 인테리어'의 인기글은 예산군이 아니라 '인테리어 예산(비용)' 글이다 —
           우리가 예산군 글을 발행해도 이 섹션엔 못 들어간다.
       판별: 토큰 뒤에 수량·범위 꼬리가 붙은 쓰임(예산별·예산 범위)이 지역 쓰임보다 많으면 탈락.
       실측(2026-08-06, 28조합): 진짜 지역 24건 전부 유지(위음성 0), '예산 인테리어' 탈락(오탐 0).
       ※ 시도·시군구 접미형('서울'·'강남구')은 애초에 일반명사와 안 겹쳐 사실상 항상 통과한다."""
    if not core or len(core) < 2:
        return True
    gen = reg = 0
    for x in (rows or []):
        n = _norm(x.get("title"))
        for m in re.finditer(re.escape(core), n):
            gen += 1 if _QTY_TAIL.match(n[m.end():m.end() + 3]) else 0
            reg += 0 if _QTY_TAIL.match(n[m.end():m.end() + 3]) else 1
    if gen == 0:
        return True                     # 일반명사 용법이 아예 없으면 판단할 것도 없다
    return reg >= gen


def _topical(rows, product, region_core=None):
    """인기글 섹션이 이 제품어와 실제 관련 있는지.
       독립검증 실측(2026-08-04, 라벨 79건): 정밀도 .973 / 재현율 .986 / F1 .980.
       ★미학습 업종(신규 고객 키워드) F1 .985 — 옛 통짜규칙은 재현율 .545였다.
       · 매칭 = 제목에 제품어 2-gram 조각이 하나라도 포함. 통짜 요구 안 함
         ('소방업체'가 없어도 '소방 지적 보수 공사'면 소방 섹션이다).
       · 채택 = 카페 관련글 ≥1  OR  블로그 관련글 ≥2.
       · 블로그에 지역 동시 포함을 요구하지 않는다 — 진짜 인기탭인데 블로그 제목에 지역명이
         없는 경우가 많아(단양 경호업체·동두천 간병인) 위음성의 주원인이었다.
         (지역코어 substring 매칭은 업체명 '(주)영동이앤씨'가 지역을 위조하는 오탐원이기도 했다.)
       · 옛 통짜규칙이 통과시킨 건을 새 규칙이 탈락시키는 경우 0건 = 단조 완화(회귀 위험 없음).
       region_core 가 오면 '지역명과 같은 일반명사' 오탐(예산 인테리어)도 함께 거른다."""
    if region_core and not _region_used_as_region(rows, _norm(region_core)):
        return False
    pn, grams = _product_grams(product)
    if len(pn) < 2:
        return True
    cafe = blog = 0
    for x in (rows or []):
        title = _norm(x.get("title"))
        if not any(g in title for g in grams):
            continue
        k = x.get("kind")
        if k == "카페":
            cafe += 1
        elif k == "블로그":
            blog += 1
    return cafe >= 1 or blog >= 2


def _budget_note(n):
    """이번에 쓴 CF 콜 수를 전역 원장에 남긴다. 온디맨드는 '기록만' 하고 제한은 안 받는다
       (고객이 항상 먼저다). 이걸 안 하면 배경 데몬이 남은 예산을 과대평가해 고객 조회와 경쟁한다.
       실패해도 무시 — 원장 기록 때문에 고객 스캔이 멈추면 본말전도다."""
    if n <= 0:
        return
    try:
        requests.post(f"{SB}/rest/v1/rpc/scan_budget_take", headers=H,
                      json={"want": int(n), "cap": 10 ** 9}, timeout=5)
    except Exception:
        pass


def _title_has_token(rows, tok):
    """인기글 제목 중 이 지역토큰이 그대로 등장하는 게 하나라도 있나.
       ★ 모든 토큰에 요구하면 안 된다 — '전북 누수탐지'는 제목이 군산·익산·전주뿐이라
         '전북'이 0건인데 진짜 인기탭이다(실측 2026-08-06). 상위 행정단위는 하위 지명으로 채워진다.
       그래서 '오타보정에 먹히는 하위 토큰'(도로명 코어·읍면리)에만 건다."""
    t = _norm(tok)
    return any(t in _norm(x.get("title")) for x in (rows or []))


# 시도 → 하위 지명 캐시(‘전북 누수탐지’처럼 상위 단위가 하위 지명으로만 채워지는 경우 대체 계산용).
_SIDO_KEYS = {"서울", "경기", "인천", "대전", "세종", "충북", "충남", "강원",
              "전북", "전남", "광주", "대구", "경북", "경남", "부산", "울산", "제주"}
_CHILDREN = {}


def _children_of(tok):
    """tok 이 시도면 그 하위 토큰 집합, 아니면 빈 집합.
       시군구·신도시·역세권·동은 더 쪼갤 하위가 없으므로 대체 계산이 필요 없다."""
    t = _norm(tok)
    if t not in _SIDO_KEYS:
        return ()
    if t not in _CHILDREN:
        try:
            _CHILDREN[t] = tuple(_norm(x) for x in _region_tokens_for([t], True))
        except Exception:
            _CHILDREN[t] = ()
    return _CHILDREN[t]


# 지역 근거 최소 건수. 2 = 진짜 최저값(노원 타이어·장한평 차수리)과 오탐값(울릉 1) 사이의 안전선.
#   3 으로 올리면 고객 본인 지역인 '장한평 차수리'가 죽는다.
_REGION_MIN_EVIDENCE = 2

# 지역 키워드 최소 검색량 — ★ 마스터 밖 토큰(strict)에만 건다. 마스터 안 토큰엔 걸지 않는다.
#   한 번 20 으로 올려 전 토큰에 걸었다가 되돌렸다(2026-08-10). 캐시 감사 결과:
#     신뢰 양성 1,169건 중 757건이 이 가드 하나로 강등 — 지역 키워드의 665건이 검색량 10이다.
#     이미 팔고 발행 중인 소방공사·회사보안·보안업체가 전부 여기 들어 있었다.
#   사장님 결정(2026-08-07): "검색량이 있던 없던 상관없어. 그냥 인기글 이거만 잡히면 된다."
#   봉화 타이어(15) 같은 오탐 하나를 잡자고 757건을 버리는 거래는 성립하지 않는다.
_REGION_MIN_VOLUME = 10

# 자격증·구직 섹션 판별. 업종 대표어가 그대로 자격증 이름인 업종(자동차정비·전기·조리)에서
#   섹션이 수험생·구직자용으로 굳어 있는 경우가 있다. 업체 홍보글을 넣어도 독자가 다르다.
#   실측(QA 2026-08-10): 자동차정비 3/5(60%) · 차량정비 2/7(29%) · 지역형 20건 0/140 · 전국 타이어 0/5.
#   임계 40% → 자동차정비만 잘리고 나머지는 그대로 통과한다.
#   ★ 임계 0.4 로 뒀다가 0.6 으로 올렸다(2026-08-10). 0.4 는 실사업 키워드를 쳤다:
#     '강북구 경호'(40%)·'구리 경호'(40%)는 1위가 우리 회사 글(강북 사설경호 총정리)인데도 강등됐다.
#     나머지 구인글은 '경호엔지니어링(상호)'·'경호빌딩 미화원'처럼 '경호'가 회사명에 든 무관 글이라
#     비율만 올리고 섹션 성격은 바꾸지 않았다. 0.6 이면 진짜 채용 섹션(고양 소방관리 60%,
#     자동차정비 60%)만 남고 실사업 키워드는 살아난다.
_CAREER_FRAG = ("기능사", "산업기사", "자격증", "필기", "실기", "국가고시",
                "연봉", "전망", "취업", "구인", "구직", "채용", "비전공")
_CAREER_RATIO = 0.6


def _offtopic_career(rows):
    rows = rows or []
    if len(rows) < 3:
        return False
    n = sum(1 for x in rows if any(f in _norm(x.get("title")) for f in _CAREER_FRAG))
    return n / len(rows) >= _CAREER_RATIO


def _region_evidence(rows, tok, product):
    """제목 하나에 '지역(또는 그 하위 지명) + 제품어'가 같이 들어간 글 수.
       ★ 왜 '토큰이 있나'가 아니라 '지역+제품 동시'인가 (QA 실측 2026-08-10, 장한평 자동차 22건):
         '울릉 타이어'는 토큰만 보면 통과한다 — 제목이 '울릉도 일주도로 후기'·'저속주행시
         울릉거림 느껴지시는분'(의성어)인 관광 섹션인데도. 동시 등장으로 세면 1건이라 걸린다.
       ★ 임계 2 인 이유: 진짜 최저값이 2(노원 타이어·장한평 차수리)이고 오탐값이 1(울릉)이다.
         3 으로 올리면 고객 본인 지역인 '장한평 차수리'가 죽는다.
       ★ 상위 행정단위는 하위 지명으로 대체한다 — '전북 누수탐지'는 지역+제품 0건이지만
         자식(군산·전주·익산)+제품이 7건이라 통과한다(기존 실측과 충돌하지 않음)."""
    _, grams = _product_grams(product)

    def count(cands):
        n = 0
        for x in (rows or []):
            title = _norm(x.get("title"))
            if any(c and c in title for c in cands) and any(g in title for g in grams):
                n += 1
        return n

    core = _region_core(tok)
    hit = count([core])
    kids = _children_of(tok)
    return max(hit, count(kids) if kids else 0)


def adjudicate(kw, r, tok, product, known, want_volume=True):
    """인기탭 채택 최종 판정 — 네 경로(플레이스형·지역형·정보입력형·키워드형)가 전부 이 하나를 탄다.

       ★ 왜 한 곳인가: 필터를 경로마다 따로 넣었더니 같은 계열 오탐이 반복해서 샜다.
         2026-08-06 하루에만 두 번 — 지역형에 넣은 오타보정 필터가 플레이스형엔 없었고(8799e1b),
         자기 상호 유입도 지역형만 막혀 있었다(2e6dc73). 경로가 셋이면 매번 세 곳을 확인해야 한다.
         (SUB4 지적 2026-08-06.)

       tok      = 지역 토큰(없으면 '')      product = 제품어(지역을 뗀 나머지)
       known    = 그 지역의 행정 마스터 토큰 집합 — 여기 없는 토큰이면 '엄격 판정' 대상
       반환 (r, 채택여부, 검색량). r 은 강등된 verdict 가 반영된 것 — 그대로 캐시에 넣으면 된다."""
    if not _is_pop(r):
        return r, False, None
    rows = r.get("rows")
    strict = bool(tok) and tok not in (known or set())

    def _demote(why):
        return {"has_section": r.get("has_section"), "verdict": f"비관련({why})",
                "theme": r.get("theme"), "rows": rows}

    # ① 오타보정 — 네이버가 '선유남'을 '선유도'로 고쳐 남의 동네 인기글을 준다. 마스터 밖 토큰만 확인
    #    (마스터 안 토큰은 '전북 누수탐지'처럼 제목이 하위 지명으로만 채워지는 정상 케이스가 있다).
    #    ★ 여기에 '지역+제품 동시 등장 ≥2건'(_region_evidence)을 얹었다가 되돌렸다(2026-08-10).
    #      자동차 25건으로는 완벽했지만(불일치 0) 전 업종에 대면 무너진다.
    #      강등 후보 605건 중 22건을 라이브 재판정: 살아남은 것 6건(27%), 실제 강등 추정 440건.
    #        군포 사설경호 근거 0 · 연수 간병인 0 · 관악 소방시설 0 · 동작 소방수리 0 (전부 7행)
    #      원인: 소방·경호·간병 인기글은 제목이 '소방점검 어디서 받나요' 처럼 지역 없이 쓰이고
    #      지역은 본문에만 있다. 타이어(지역 상점 글이 제목에 지역을 넣음)와 언어가 다르다.
    #      → 표본 업종 하나로 만든 규칙을 전 업종에 걸면 안 된다. 울릉 타이어 오탐 1건은 남긴다.
    if strict and not _title_has_token(rows, tok):
        return _demote("지역불일치"), False, None
    # ② 제품 관련성 + 일반명사 지역(예산 인테리어)
    if not _topical(rows, product, _region_core(tok) if tok else None):
        return _demote("오탐"), False, None
    # ②-b 테마 이탈 — 섹션이 자격증·구직 콘텐츠면 업체 홍보글이 들어가도 독자가 다르다.
    if _offtopic_career(rows):
        return _demote("자격증·구직섹션"), False, None
    if not want_volume:
        return r, True, None
    v = _real_volume(kw)
    # ③ 검색량 — 마스터 밖 지역어(오타보정으로 만들어진 가짜 지명)일 때만 건다.
    #    마스터 안 토큰까지 걸면 실제 판매 중인 키워드가 대량으로 죽는다(위 상수 주석 참고).
    if strict and (v or 0) <= _REGION_MIN_VOLUME:
        return _demote("검색량없음"), False, v
    return r, True, v


def _is_canceled(req_id):
    """사장님이 화면에서 '중단'을 눌렀나 — 상태가 claimed 가 아니면 중단으로 본다.

       ★ 왜 필요한가(2026-08-13): 화면의 '⏹ 중단'은 아직 워커가 안 집은 대기분만 껐다.
         이미 집은 회차는 120콜을 다 쓸 때까지 안 멈춰서, 사장님이 세 번을 그냥 기다렸다.
       ★ DB 읽기 1회뿐이라 CF 콜·차단 예산과 무관하다. 5건마다만 본다(회차당 24회).
       ★ 못 읽으면 False — 네트워크가 흔들린다고 멀쩡한 스캔을 죽이지 않는다."""
    try:
        r = requests.get(f"{SB}/rest/v1/cafe_kw_requests?select=status&id=eq.{req_id}",
                         headers=H, timeout=8)
        rows = r.json()
        return bool(rows) and rows[0].get("status") != "claimed"
    except Exception:
        return False


def _run_scan(req, kws, target, scope, extra=None, tag="스캔", max_live=None):
    """지역축 × 제품 조합 스캔 공통 루프. kws = [(지역토큰, 키워드, 제품키워드[, strict])].
       strict=True 면 제목에 지역토큰이 실제로 등장해야 채택(오타보정 오탐 차단).
       지역형(process_region)과 정보입력형(process_menu)이 이 하나를 공유한다 —
       차단 감지·오탐 필터·캐시 규약·조기 종료가 두 경로에서 갈라지지 않게.
       max_live=이번 회차 라이브 스캔 상한(None=조합 전수). 캐시분은 상한에 안 걸린다."""
    cf = bool(p._USE_CF)
    # CF는 분산IP(요청이 CF 엣지에서 나감)라 사무실 IP 보호용 긴 스로틀이 불필요.
    #   실측(2026-08-04): CF classify 1건 평균 0.77s, 무-gap 직렬 20건 13s·에러 0. 옛 1.5s는 벽시계의 66%가 순수 대기였다.
    # ★ 차단은 '속도'가 아니라 '콜 수'에 걸린다 — 실측(2026-08-06) 0.81/1.28/5.78 req/s 로 7배 차이인데
    #   차단은 전부 294~302콜에서 발생. CF egress 당 약 300콜 / 10분 롤링이 한도다.
    #   따라서 병렬을 올려도 총량 이득이 0이고 쿼터만 조기 소진된다 → 직렬 + 넉넉한 간격(0.4 req/s)으로 간다.
    #   164조합 ≈ 7분(사장님 기준 10분 이내). 연속 요청에도 10분 쿼터(240콜, 실측 한도의 80%)를 안 넘긴다.
    gap = 2.5 if cf else SCAN_GAP
    # ★ 완전성 우선(누락 금지): 검색량으로 스캔을 건너뛰지 않는다 — 저검색이라도 인기탭 있는 니치(피로연·예식 등)
    #   포착. 검색량은 판정 '후' 표시·정렬용으로만 조회. 판정결과(인기탭/섹션없음)는 캐시되어 재스캔은 즉시.
    total = len(kws)
    # ★ 회차는 짧게 끊는다 — 목표(target)를 채우면 즉시 멈추고, 못 채워도 이 콜 수에서 끝낸다.
    #   왜: 예전엔 못 채우면 330콜(약 14분)까지 계속 돌았다. 사장님 실측 2026-08-10(장한평):
    #   23건에서 30을 못 채워 끝까지 돌았고, 그 14분에 나온 건 강서·도봉 같은 먼 자치구뿐이었다.
    #   화면 폴링도 그 사이 끊겨 '아직 분석 중'만 반복됐다. 짧게 끊고 '＋더 찾기'로 사장님이
    #   이어갈지 결정하는 편이 낫다(이미 본 조합은 캐시라 다음 회차가 그만큼 빨라진다).
    ROUND_MAX_LIVE = 120                        # 약 5분(2.5초 간격) — 한 번 누르면 이만큼만 본다
    MAX_LIVE = ROUND_MAX_LIVE if cf else 120
    # 저수익 조기 중단 임계 — 반드시 회차 상한보다 작아야 한다(같거나 크면 절대 안 걸린다).
    #   ★ 값 근거(SUB4 실측 2026-08-10, 양성 1건 이상 나온 과거 요청의 '첫 양성 위치' 분포):
    #     p95=14 · p99=42 · 90 이상은 0.69%. 90도 통계적으로는 안전하다.
    #     그런데 소방시설(146스캔·양성 4건=2.7%)의 첫 양성이 정확히 90이었다 — 경계에 걸린다.
    #     회차 상한이 120이라 이 규칙이 아끼는 건 90이면 30콜, 110이면 10콜. 차이는 20콜뿐인데
    #     오판 손해는 '팔 수 있는 업종을 안 맞음으로 버리는 것'이라 비대칭이다. → 110 으로 여유.
    #     (0건 안내 문구는 조기 중단과 무관하게 회차 끝에서도 나오므로 아무것도 안 잃는다.)
    LOWYIELD_AT = min(110, MAX_LIVE - 1)
    if max_live:
        MAX_LIVE = min(MAX_LIVE, max_live)      # 호출부가 더 작게 주면 그쪽을 따른다
    kws = [(k + (False,))[:4] for k in kws]            # (tok, kw, product[, strict]) 정규화
    cache = _cache_get_many([kw for _, kw, _, _ in kws])  # 배치 캐시(재스캔 즉시)

    found, scraped, errs, capped = [], 0, 0, False
    err_streak, aborted = 0, False    # 연속 실패 횟수(차단 감지)·중단 여부
    canceled = False                  # 사장님이 화면에서 중단을 누른 경우
    lowyield = False                  # 저수익 조기 중단(이 업종은 지역형이 안 맞음)
    # ① 캐시 패스(네트워크 0) — 신뢰 캐시로 이미 결론난 건 즉시 채택/스킵하고, 남은 것만 라이브 대상으로.
    to_scan = []
    for tok, kw, prod, strict in kws:
        c = cache.get(kw.replace(" ", ""))
        # 신뢰 캐시만 채택·건너뜀. prescan 위음성(섹션없음)은 불신 → 라이브 재검증. verdict 에 topicality 반영됨.
        if c is not None and _cache_trust(c):
            if _is_pop(c):
                found.append({"keyword": kw, "volume": c.get("volume") or 0, "theme": _disp_theme(c),
                              "cafes": [x for x in (c.get("cafes") or []) if x.get("kind") == "카페"][:5]})
            continue
        to_scan.append((tok, kw, prod, strict))
    left = 0
    if len(to_scan) > MAX_LIVE:
        left = len(to_scan) - MAX_LIVE          # 이번 회차에 못 본 조합 수 — note 에 명시(조용한 절단 금지)
        to_scan = to_scan[:MAX_LIVE]
        capped = True

    # 조합 1건 처리(스레드에서 실행) — classify → 오탐필터 → 캐시. 반환 ('pop'|'neg'|'err', 결과).
    def _scan_one(item):
        tok, kw, product, strict = item
        r = p.classify(kw)
        if r.get("err"):                       # C1 — 차단/일시실패는 캐시하지 않음(영구 위음성 방지). 다음에 재시도.
            return ("err", None)
        # 판정은 전부 adjudicate 한 곳에서 — 경로마다 따로 넣으면 반드시 한쪽이 샌다.
        #   strict 는 '마스터 밖 토큰'이라는 뜻이므로 known 을 그렇게 흉내 낸다.
        r, ok, v = adjudicate(kw, r, tok, product, set() if strict else {tok})
        _cache_put(kw, r, v if ok else None)
        if not ok:
            return ("neg", None)
        return ("pop", {"keyword": kw, "volume": v, "theme": _disp_theme(r),
                        "cafes": [x for x in (r.get("rows") or []) if x.get("kind") == "카페"][:5]})

    # ② 라이브 패스 — CF는 분산IP(요청이 CF 엣지에서 나감)라 병렬이 안전하다.
    #    실측(2026-08-04): 병렬x6 20건 2.1s·에러0 (직렬 무gap 13s 대비 6배). 사무실 직접 IP는 차단 보호로 직렬 유지.
    PAR = 1 if cf else 1
    ex = ThreadPoolExecutor(max_workers=PAR) if PAR > 1 else None
    pushed_n = -1                      # 마지막으로 화면에 흘려보낸 인기탭 개수(캐시 양성부터 바로 보낸다)
    try:
        for i in range(0, len(to_scan), PAR):
            if len(found) >= target:
                break
            # 사장님이 중단을 눌렀으면 여기서 빠져나온다 — 찾은 것은 그대로 저장된다.
            if i % 5 == 0 and _is_canceled(req["id"]):
                aborted = True
                canceled = True
                break
            chunk = to_scan[i:i + PAR]
            try:                               # 진행상태(프론트 게이지바)
                # ★ 찾는 즉시 화면에 쌓이게 한다(2026-08-10 사장님 요청) — 예전엔 result 를 _finish 에서만
                #   써서, 5분짜리 회차 내내 게이지 숫자만 오르고 키워드는 끝나야 한 번에 나타났다.
                #   중간에 폴링이 끊기거나 새로고침해도 여기까지 찾은 건 남는다.
                #   찾은 개수가 늘었을 때만 result 를 실어 보낸다(매 청크마다 보내면 payload 낭비).
                body = {"note": f"진행 {i + len(chunk)}/{len(to_scan)} · 인기탭 {len(found)}"}
                if len(found) != pushed_n:
                    body["result"] = sorted(found, key=lambda f: -(f.get("volume") or 0))
                    pushed_n = len(found)
                requests.patch(f"{SB}/rest/v1/cafe_kw_requests?id=eq.{req['id']}", headers=H,
                               json=body, timeout=10)
            except Exception:
                pass
            results = list(ex.map(_scan_one, chunk)) if ex else [_scan_one(x) for x in chunk]
            # 청크가 통째로 실패 = 차단 신호. 백오프 후 1회 재시도하고, 그래도 전멸이면 중단한다.
            #   ★ 차단인데 '0건 완료'로 반환하면 고객에겐 '인기탭 없음'과 구별되지 않는다(조용한 미달).
            #   ⚠️ 2026-08-10 과민반응 수정. 이 규칙은 PAR=6(병렬) 시절 '청크 6건 전멸'을 보려고 만든 건데,
            #      지금 PAR=1 이라 '한 건 실패'가 곧 '청크 전멸'이 됐다. 그래서 일시적 오류 하나에
            #      300초를 쉬고, 재시도도 실패하면 120조합짜리 스캔을 통째로 '차단'으로 죽였다.
            #      실측 #198(2026-08-10 17:42): 11/120 에서 중단·결과 0건인데 CF 10분 롤링은 170
            #      (한도 300의 57%)로 여유가 있었다 — 차단이 아니라 그냥 한 번 실패한 것이었다.
            #      → 연속 BLOCK_STREAK 회 실패해야 차단으로 본다. 진짜 차단은 계속 실패하므로 여전히 잡힌다.
            if all(k == "err" for k, _ in results):
                err_streak += 1
                if err_streak >= BLOCK_STREAK:
                    errs += len(results)               # 재시도 결과로 덮이기 전에 장부에 남긴다
                    time.sleep(BLOCK_BACKOFF)          # 실측: CF 차단은 100초 이상 지속 → 충분히 쉬고 재시도
                    results = list(ex.map(_scan_one, chunk)) if ex else [_scan_one(x) for x in chunk]
                    if all(k == "err" for k, _ in results):
                        aborted = True
                    else:
                        err_streak = 0
            else:
                err_streak = 0
            _budget_note(len(results))      # 오류 포함 — 차단당한 콜도 CF 버킷은 똑같이 소모한다
            for kind, item in results:
                if kind == "err":
                    errs += 1
                    continue
                scraped += 1
                if kind == "pop":
                    found.append(item)
            # ★ 저수익 조기 중단 — 이 업종이 지역형과 안 맞으면 더 긁어도 안 나온다.
            #   실측(2026-08-06) '창업' 6제품×수도권 780지역: 330콜 써서 2건, 둘 다 검색량 10.
            #   ⚠️ 2026-08-10 두 곳을 고쳤다(SUB4 지적).
            #   ① 임계가 150이었는데 회차 상한이 120(2a30ae6)으로 내려가 '절대 안 걸리는' 죽은 코드였다.
            #      실제로 #189·#192·#194·#195 가 0건인데도 '＋더 찾기' 안내만 받았다 — 사장님이
            #      '더 찾으면 나올까'와 '이 업종은 원래 안 나온다'를 구분할 수 없었다. → 90 으로.
            #   ② 조건이 '검색량 10 초과가 없으면'이었다. 사장님 확정(2026-08-07)은
            #      "검색량이 있든 없든 상관없다, 인기탭만 잡히면 된다" 이므로 검색량으로 끊으면 안 된다.
            #      → '인기탭이 아예 0건'일 때만 끊는다. 저검색 니치는 이제 안 죽는다.
            #   예산 걱정은 회차 상한(120)이 이미 막는다 — 이 규칙이 아끼는 건 최대 30콜이고,
            #   진짜 값어치는 '이 업종은 지역형이 안 맞는다'는 안내를 띄우는 데 있다.
            if scraped >= LOWYIELD_AT and not found:
                lowyield = True
                break
            if aborted:
                break
            time.sleep(gap)                    # 청크 사이만 쉼(병렬이면 건당 실효 gap = gap/PAR)
    finally:
        if ex:
            ex.shutdown(wait=False)
    found.sort(key=lambda f: -(f.get("volume") or 0))
    # 판정 못 한 조합이 많으면 '완료'로 위장하지 않는다 — 결과가 불완전함을 명시하고 failed 로 끝낸다.
    unscanned = len(to_scan) - scraped
    # 사장님이 누른 중단은 '차단'이 아니다 — 찾은 것까지 정상 완료로 돌려준다.
    if canceled:
        _finish(req["id"], "done", result=found, extra=extra,
                note=f"⏹ 중단했습니다 — {scraped}개 보고 인기탭 {len(found)}건. "
                     f"남은 조합 {unscanned}개(＋더 찾기로 이어서)")
        print(f"[{_ts()}][{req['id']}] {tag} 사용자 중단 · 스크랩 {scraped} · 인기탭 {len(found)}", flush=True)
        return found
    if aborted or errs > _err_budget(len(to_scan)):
        _finish(req["id"], "failed", result=found, extra=extra,
                note=f"⚠ 스캔 차단 — {unscanned}/{len(to_scan)}건 판정 못 함(오류 {errs}). "
                     f"부분결과 {len(found)}건뿐이니 잠시 후 다시 조회하세요.")
        return found
    # 이번 회차에 못 본 조합 = 상한에 잘린 것(left) + 조기 중단으로 남긴 것.
    remain = left + max(0, len(to_scan) - scraped - errs)
    # ★ 0건일 때는 반드시 이유를 말한다 — '더 찾으면 나올까'와 '이 업종은 원래 안 나온다'를
    #   사장님이 구분할 수 있어야 한다(SUB4 지적 2026-08-10). 조기 중단이 안 걸렸어도 마찬가지다.
    if not found:
        lownote = (f" · ⚠ {scraped}개 조합을 봤는데 인기탭이 하나도 없습니다 — "
                   f"이 업종은 지역형이 잘 안 맞습니다(일반 배포를 권합니다)"
                   + (f". 그래도 더 보려면 ＋더 찾기 — 남은 조합 {remain}개" if remain else ""))
    else:
        lownote = ""
    _finish(req["id"], "done", result=found, extra=extra,
            note=f"{len(found)}건 · 스캔 {scraped}{' · 오류 ' + str(errs) if errs else ''} · {scope}"
                 f"{f' · 남은 조합 {remain}개(＋더 찾기로 이어서)' if remain and found else ''}{lownote}")
    print(f"[{_ts()}][{req['id']}] {tag} {total}조합 {scope} → 인기탭 {len(found)}건 · 스크랩 {scraped} · err {errs}", flush=True)
    return found


def process_region(req, product):
    """지역 인기탭 조회 — 선택 시도의 구/시(기본) × 제품키워드 전수 인기탭 판정(누락 금지). 통과분만 반환·캐시.
       deploy_type 에 '동'/'dong' 오면 동(洞)까지('더 찾기'). 완전성: 검색량 게이트 없음 + err 캐시 금지 + 전수 스캔."""
    product = (product or "").strip()
    if not product:
        return _finish(req["id"], "failed", note="제품키워드 없음")
    sidos = [s for s in (req.get("regions") or "").replace(" ", "").split(",") if s]
    target = int(req.get("target") or 300)
    dt = (req.get("deploy_type") or "")
    include_dong = ("동" in dt) or ("dong" in dt.lower())
    tokens = _region_tokens_for(sidos, include_dong)
    if not tokens:
        return _finish(req["id"], "failed", note=f"지역 토큰 없음(sido={sidos})")
    # 제품 자체가 지명이면 지역을 곱하지 않는다 — '송도 대전창업' 같은 조합 방지(사장님 지시 2026-08-11).
    #   대신 지역 없이 그 키워드 하나만 판정한다(대전 업체에겐 '대전창업'이 진짜 키워드다).
    _ph = _product_place_head(product)
    if _ph:
        _run_scan(req, [("", product, product, False)], 1, "전국(제품이 지명)",
                  extra={"biz_name": product}, tag=f"지명제품 '{product}'")
        return
    # 후보 (tok, kw, product) — tok 은 오탐필터의 지역코어용. 중복 제거.
    kws, seen = [], set()
    for tok in tokens:
        kw = f"{tok} {product}"
        nk = kw.replace(" ", "")
        if nk in seen:
            continue
        seen.add(nk)
        kws.append((tok, kw, product, False))   # 지역형 토큰은 전부 행정 마스터 유래 → strict 불필요
    _run_scan(req, kws, target, "동포함" if include_dong else "구시",
              extra={"biz_name": product}, tag=f"지역스캔 '{product}' {sidos}")


_SIDO_SUF = re.compile(r"(특별자치시|특별자치도|특별시|광역시|자치시|자치구|시|군|구|도)$")


def normalize_region(addr):
    """직접 입력한 위치 문자열 → 스캔용 지역 토큰(넓은 것 → 좁은 것).
       플레이스가 없는 업체용. '전북 군산시 옥도면 선유남길 19-9'
         → ['전북','군산','옥도면','옥도','선유남길','선유남']
       ★ 접미형('강남구')만 있으면 기본형('강남')도 만든다 — 실측(2026-08-06) 기본형이 접미형보다
         적중 5배(2,316쌍 중 489 vs 100). 접미형은 뒤로 미루되 버리지는 않는다(누락 0)."""
    addr = (addr or "").strip()
    if not addr:
        return []
    # ★ 출구 번호는 지역이 아니다 — '장한평역 1번출구'에서 '번출','번출구'가 토큰으로 나왔다
    #   (QA 실측 2026-08-10). 스캔해도 0건인 순수 낭비라 파싱 전에 지운다.
    addr = re.sub(r"\d+\s*번\s*출구", " ", addr)
    sido = p._sido(addr, addr)
    narrow = p.region_tokens(addr, addr)
    # ★ 역 이름만 적는 고객이 많다. '장한평역' 한 줄이면 기존 파서는 토큰 0개를 돌려주고
    #   워커가 '위치를 해석하지 못했습니다'로 실패했다(QA 실측 2026-08-10).
    #   역명은 그 자체가 상권 축이므로(장한평=자동차부품 상가) 역/역명 기본형을 축에 넣는다.
    for m in re.finditer(r"([가-힣]{2,6})역(?=\s|$|[,·])", addr):
        stn = m.group(1)
        if len(stn) >= 2 and stn not in narrow:
            narrow = list(narrow) + [stn]
    base, suffixed, road = [], [], []
    for t in narrow:
        b = _SIDO_SUF.sub("", t)
        if b != t and len(b) >= 2:
            base.append(b)
            suffixed.append(t)
        elif t.endswith(("로", "길")):
            road.append(t)                      # 도로명은 인기탭 확률이 낮아 맨 뒤
        else:
            base.append(t)
    out, seen = [], set()
    for t in ([sido] if sido else []) + base + suffixed + road:
        t = (t or "").strip()
        if len(t) >= 2 and t not in seen:
            seen.add(t)
            out.append(t)
    return out




def process_menu(req, payload):
    """정보입력형 — 플레이스가 없는 업체. 위치(직접입력) × 제품키워드(붙여넣기→GPT 추출, 사용자 체크 확정).
       payload = JSON {"addr": "...", "products": ["누수탐지", ...], "name": "업체명"}
       지역 축 = 자기 주소에서 뽑은 토큰(가까운 곳 우선). regions(시도)가 오면 그 시도 전체 토큰까지 확장."""
    try:
        d = json.loads(payload or "{}")
    except Exception:
        return _finish(req["id"], "failed", note="정보입력 payload 파싱 실패")
    addr = (d.get("addr") or "").strip()
    products = [str(x).strip() for x in (d.get("products") or []) if str(x).strip()]
    if not products:
        return _finish(req["id"], "failed", note="제품키워드 없음 — 추출 결과에서 1개 이상 선택하세요")
    # ★ 제품을 검색량 내림차순으로 세운다(2026-08-07).
    #   추출을 최대로 하는 방침으로 바뀌면서 제품이 70개 넘게 들어온다. 회차 상한(ROUND_MAX_LIVE=120)이
    #   지역 우선 순회를 자르므로, 제품 순서가 나쁘면 앞쪽 지역에서 '활력징후측정 0' 같은 것만
    #   돌다가 회차가 끝난다. 어차피 한 번에 다 못 돌 바엔 수요 큰 것부터 본다.
    #   (searchad 호출이라 CF egress 예산과 무관하다. 나머지는 '＋더 찾기'가 이어서 본다.)
    if len(products) > 12:
        vol = {}
        for pr in products:
            try:
                vol[pr] = _real_volume(pr) or 0
            except Exception:
                vol[pr] = 0
        products.sort(key=lambda x: -vol.get(x, 0))
        print(f"[{_ts()}][{req['id']}] 제품 {len(products)}개 검색량순 정렬 — 상위: "
              + ", ".join(f"{p}({vol.get(p, 0):,})" for p in products[:5]), flush=True)
    own = normalize_region(addr)
    sidos = [s for s in (req.get("regions") or "").replace(" ", "").split(",") if s]
    dt = (req.get("deploy_type") or "")
    include_dong = ("동" in dt) or ("dong" in dt.lower())
    wide = _region_tokens_for(sidos, include_dong) if sidos else []
    if not own and not wide:
        return _finish(req["id"], "failed", note=f"위치를 해석하지 못했습니다(입력: {addr[:40] or '없음'})")
    # 자기 지역 먼저, 그 다음 시도 전체 — target 조기 종료가 '가까운 곳'을 먼저 채우도록.
    tokens, tseen = [], set()
    for t in own + wide:
        if t not in tseen:
            tseen.add(t)
            tokens.append(t)
    # 제품 우선(첫 제품의 전 지역 → 다음 제품)이 아니라 지역 우선으로 섞는다 —
    #   조기 종료 때 특정 제품만 몰리지 않게.
    # ★ 행정 마스터에 없는 토큰(도로명 코어 '선유남' 등)은 제목 확인을 강제한다.
    #   네이버가 '선유남'을 '선유동'으로 오타보정해 남의 동네 인기글을 돌려줬다(실측 2026-08-06).
    #   시도·시군구·동은 마스터에 있으므로 그대로 — '전북 누수탐지'는 제목이 군산·익산뿐이어도 진짜다.
    sido_of = p._sido(addr, addr) if addr else ""
    known = set(wide) | set(_region_tokens_for([sido_of], True) if sido_of else [])
    kws, seen = [], set()
    # 지명 제품은 지역을 곱하지 않는다('송도 대전창업' 방지). 지역 없이 단독 판정만 한다.
    _place_prods = [x for x in products if _product_place_head(x)]
    products = [x for x in products if x not in _place_prods]
    for pr in _place_prods:
        kws.append(("", pr, pr, False))
    for tok in tokens:
        strict = tok not in known
        for prod in products:
            kw = f"{tok} {prod}"
            nk = kw.replace(" ", "")
            if nk in seen:
                continue
            seen.add(nk)
            kws.append((tok, kw, prod, strict))
    target = int(req.get("target") or 30)
    # ★ 회차 상한은 _run_scan(ROUND_MAX_LIVE=120, 약 5분)이 정한다. 여기서 따로 주지 않는다.
    #   제품 축이 곱해져 조합이 폭증하므로(제품 11 × 서울 340 = 3,740) 한 번에 다 볼 수 없다.
    #   목표를 채우면 즉시 멈추고, 못 채워도 120콜에서 끊는다. 남은 건 '＋더 찾기'가 이어서 본다.
    _run_scan(req, kws, target, f"정보입력·지역{len(tokens)}×제품{len(products)}",
              extra={"biz_name": (d.get("name") or products[0])},
              tag=f"정보입력스캔 '{products[0]}'{'…' if len(products) > 1 else ''} @{addr[:20]}")


# ── 연관 인기글: 씨앗어 하나로 '전국형'과 '지역형'을 한 번에 훑는다 ────────────────
#   왜: 같은 씨앗이라도 업종에 따라 정답이 갈린다(실측 2026-08-07).
#     보홀·창업 → 지역을 붙이면 검색량이 1.7%로 무너지고 섹션도 3분의 2가 사라진다.
#     간병인·입주청소 → 반대로 지역을 붙여야만 나온다(간병인 46/104, 지역 없이는 0).
#   그래서 씨앗어를 넣으면 둘 다 시도해 '어느 쪽이 되는 업종인지'까지 알려 준다.
# 찔러볼 지역 — 카페 활동이 많은 곳을 손으로 고른다. 종류도 섞는다.
#   ★ 마스터에서 기계적으로 뽑으면(prio·가나다순) '419민주묘지역'·'가능역' 같은 변두리가 나와,
#     지역형인데도 못 찾는다(위음성). 찔러보기는 표본이 K개뿐이라 대표성이 전부다.
#   순서 근거(실측 2026-08-07): 신도시 74% > 시군구 21% > 시도 18% — 잘 나오는 종류를 앞에.
#   ★ 유명 역(강남역·홍대입구역)을 넣으면 오히려 나빠진다 — 전수 36제품 대조에서
#     역 없음 30/36 > 역 2개 29 > 역 4개 25. 창업의 역세권 적중(101/554)은 변두리 역에 흩어져 있어
#     대표 역 몇 개로는 못 잡는다.
#   ★ 한계: 찔러보기가 0이어도 '지역형 아님'이 아니다. 적중밀도가 낮은 제품
#     (소자본창업 4/205=2%, 소방시설 4/146=3%)은 8번 찔러도 22% 확률로만 걸린다.
#     그래서 결과는 '미확인'으로 표시하고 전수 지역 스캔을 따로 돌릴 수 있게 한다.
# 지역형인지 찔러볼 지역. ★ 순서가 곧 우선순위다(앞에서 K개만 쓴다).
#   실측(독립검증 2026-08-10, 지역형 5제품):
#     축별 적중밀도 — newtown 50~84% · sigungu 10~59% · sido '경기' 0/4 · station 1/599(0.2%)
#     현행 8곳(동탄·강남·수원·서울·판교·부천·성남·경기) = 5개 중 4개 판명, '욕창'은 0/8 완전 누락
#     신형 신도시(청라·송도·위례·고촌·고덕·광교) 앞세우면 4곳만으로 5/5 판명
#   그래서 ① 신형 신도시를 맨 앞에 ② 역세권(강남역·홍대입구역)과 시도('경기')는 뒤로/제거
#   동탄·판교는 오래된 신도시라 시군구처럼 굳었다 — 앞자리에서 뺀다.
#   ★ 순서 재정렬(2026-08-11, 독립검증 실측). 16곳이 모두 스캔된 제품 20개로 공정 비교한 적중 수:
#       고덕 8 · 동탄 7 · 광교 6 · 성남 6 · 부천 6 · 청라 6 · 송도 5 · 위례 5 · 미사 5 · 서울 5
#       수원 5 · 판교 5 · … · 고촌 3(16곳 중 꼴찌)
#     '신형 신도시가 최상'은 표본 5개로 만든 값이었고 91개 모집단에서 재현되지 않았다.
#     특히 '고촌'이 앞 4자리에 있었는데 실측 꼴찌였다. 그리디 셋커버로는 수원 하나가 신규 24개로
#     현행 4곳 합계(16개)보다 많았다(다만 캐시 편중이 있어 그대로 채택하진 않는다).
#   ⚠️ 빼지 않고 '순서만' 바꾼다 — 지우면 그 지역의 양성을 영영 못 본다(누락 금지).
#     앞자리가 곧 우선순위이고, 아래 K_ADAPT 가 앞에서 몇 개를 쓸지 정한다.
_PROBE_SEED = [
    "고덕", "동탄", "광교", "성남",          # 실측 적중 상위
    "부천", "청라", "수원", "송도",
    "위례", "미사", "서울", "판교",
    "고양", "인천", "안양", "고촌",          # 고촌은 실측 꼴찌 → 뒤로
]


# ── 지역 × 지역 조합 금지 ────────────────────────────────────────────────────
#   실측(#226, 2026-08-11): 씨앗 '창업' 지역형 후보 22건 중 5건이 제품 자체가 지명이었다.
#     대전창업 → '송도 대전창업' · 청주창업 → '청라 청주창업' · 천안창업 · 경기창업 · 한국창업
#   인천 송도에 대전을 붙이면 말이 안 된다. 발행하면 독자가 혼란스럽다.
#   ★ 제품을 버리는 게 아니라 '지역 곱하기 대상에서만' 뺀다 — '대전창업'은 대전 업체에겐
#     진짜 키워드다. 전국 판정은 그대로 태운다(사장님 지시 2026-08-11).
#   ⚠️ 동·읍면·역세권 토큰(3,600여 개)은 검사에 쓰지 않는다 — 흔한 낱말과 겹쳐
#     '고기창업'·'전수창업' 같은 정상 제품을 오폭한다. 시도·시군구·신도시·자치구만 본다(약 300개).
_PLACE_KINDS = ("sido", "sigungu", "newtown", "district")
_PLACE_HEADS = None


def _place_heads():
    """제품 앞머리가 지명인지 볼 때 쓰는 토큰 집합(광역 단위만)."""
    global _PLACE_HEADS
    if _PLACE_HEADS is None:
        rows = _sb_page(f"{SB}/rest/v1/cafe_region_token?select=token,kind&active=is.true") or []
        s = {r["token"] for r in rows if r.get("kind") in _PLACE_KINDS and r.get("token")}
        s |= _SIDO_KEYS
        s |= {"한국", "전국", "국내", "수도권", "충청", "호남", "영남", "제주도"}
        _PLACE_HEADS = s
    return _PLACE_HEADS


def _product_place_head(prod):
    """제품키워드가 지명으로 시작하면 그 지명을, 아니면 None. 긴 것부터 본다."""
    n = _norm(prod)
    heads = _place_heads()
    for size in (4, 3, 2):
        if len(n) > size + 1 and n[:size] in heads:   # 지명 뒤에 2자 이상 남아야 '지명+업종'이다
            return n[:size]
    return None


def _probe_regions(k=8):
    """지역형인지 찔러볼 지역 K개. 마스터에 실제로 있는 것만(없는 건 스캔해도 무의미)."""
    rows = _sb_page(f"{SB}/rest/v1/cafe_region_token?select=token&active=is.true") or []
    have = {r["token"] for r in rows}
    out = [t for t in _PROBE_SEED if t in have][:k]
    return out or _PROBE_SEED[:k]


# 씨앗어가 '지명(목적지)'인지 — 지명이면 지역 축을 붙이지 않는다.
#   왜(SUB4 제안 2026-08-07): '판교 보홀투어'·'하와이→디트로이트'처럼 씨앗과 지리적으로 무관한
#     지명이 붙어 팔 수 없는 키워드가 결과에 올라왔다. '제주 제외' 같은 개별 예외로 잡으면
#     보홀·괌·다낭이 나올 때마다 두더지 잡기가 된다. 씨앗이 목적지면 {지역}{목적지} 조합 자체가
#     성립하지 않는다("판교 보홀투어"를 검색하는 사람은 없다).
#   판별: ① 국내 지명은 지역 토큰 마스터에 있다 ② 해외 지명은 '{씨앗}여행/항공권/숙소…'가 크게 잡힌다.
#   실측 16개(보홀·하와이·괌·다낭·제주·강릉·코타키나발루 vs 입주청소·누수탐지·창업·골프·네일·간병인·필라테스):
#     신호 6종 + 임계 3,000 → 오판 0. 임계 1,000 이면 '골프'가 골프여행 2,770 때문에 지명으로 오판된다.
_DEST_SIGNALS = ("여행", "항공권", "숙소", "맛집", "가볼만한곳", "호텔")
_DEST_MIN_VOL = 3000


def _is_place_seed(seed, vol_by_kw, known_tokens):
    s = (seed or "").replace(" ", "")
    if not s:
        return False
    if s in known_tokens:
        return True
    return any((vol_by_kw.get(s + g) or 0) >= _DEST_MIN_VOL for g in _DEST_SIGNALS)


def process_reviews(req, payload):
    """리뷰 수집 — payload = 플레이스 URL/ID. 리뷰 텍스트와 부가 정보를 모아 돌려준다.

       왜 워커인가: m.place 는 브라우저 UA·한국 IP 경로로 받아야 안정적이라 CF 함수에서 못 긁는다.
         이미 place_info/place_menu 를 이 경로로 받고 있으므로 같은 자리에 붙인다.
       추출(GPT)은 프론트가 기존 /api/extract-menu 로 한다 — 여기선 텍스트만 준다.
       ⚠️ 네이버 검색(m.search)을 안 쓰므로 CF 예산과 무관하다."""
    pid = p.parse_place_id((payload or "").strip())
    if not pid:
        return _finish(req["id"], "failed", note="플레이스 주소를 해석하지 못했습니다")
    info = p.place_info(pid) or {}
    road, jibun = p.place_address(pid)
    try:
        blob, rmenus = p.place_reviews(pid)
    except Exception as e:
        return _finish(req["id"], "failed", note=f"리뷰 수집 실패: {str(e)[:80]}")
    menu = []
    try:
        menu = p.place_menu(pid) or []
    except Exception:
        pass
    # 결과는 result 배열에 한 건으로 담는다(cafe_kw_requests 에 별도 컬럼이 없다).
    row = {
        "kind": "reviews", "keyword": info.get("name") or str(pid),
        "addr": road or jibun or "",
        "cats": info.get("cats") or [], "place_kws": info.get("keywords") or [],
        "menu": menu, "review_menus": rmenus, "text": blob,
        "chars": len(blob),
    }
    note = (f"리뷰 {len(blob):,}자 · 메뉴 {len(menu)}개 · 플레이스키워드 {len(row['place_kws'])}개"
            + (f" · 리뷰메뉴 {len(rmenus)}개" if rmenus else "")
            + ("" if blob else " · ⚠ 리뷰 없음"))
    _finish(req["id"], "done", result=[row], note=note, extra={"biz_name": info.get("name")})
    print(f"[{_ts()}][{req['id']}] 리뷰수집 {info.get('name')} — {len(blob)}자", flush=True)


_ALL_TOKENS = None


def _all_region_tokens():
    """지역 토큰 전체(활성) — 키워드 앞머리에서 지역을 떼어낼 때 쓴다."""
    global _ALL_TOKENS
    if _ALL_TOKENS is None:
        rows = _sb_page(f"{SB}/rest/v1/cafe_region_token?select=token&active=is.true") or []
        _ALL_TOKENS = {r["token"] for r in rows if r.get("token")}
    return _ALL_TOKENS


def process_recheck(req, payload):
    """발행 전 재확인 — 담아둔 키워드를 팔기 직전에 라이브로 다시 판정한다.
       payload = JSON {"kws": ["청라 여자창업", ...]}

       ★ 왜(SUB4 실측 2026-08-11): 5~6일 지난 양성 30건을 재판정하니 3건(10%)이 죽어 있었다.
         고촌 입주청소 · 경기 더반클린 · 강동 사설경호 — 전부 '섹션없음'으로, 규칙 경계가 아니라
         네이버가 그 키워드에 인기글 섹션을 더 이상 안 주는 경우였다.
         30건이면 30콜(데몬 3분치)이라, 팔기 직전에 한 번 보는 게 가장 싸고 확실한 해결이다.
       ★ 캐시를 믿지 않는다 — 무조건 라이브. 그게 이 라우트의 존재 이유다.
       결과(result)에는 '살아있는 것'만 담는다. 죽은 건 화면이 차집합으로 안다."""
    try:
        d = json.loads(payload or "{}")
    except Exception:
        return _finish(req["id"], "failed", note="재확인 payload 파싱 실패")
    kws = [str(x).strip() for x in (d.get("kws") or []) if str(x).strip()][:200]
    if not kws:
        return _finish(req["id"], "failed", note="확인할 키워드 없음")
    cf = bool(p._USE_CF)
    gap = 2.5 if cf else SCAN_GAP
    master = _all_region_tokens()
    alive, dead, errs, streak = [], [], 0, 0
    for i, kw in enumerate(kws, 1):
        if i % 5 == 1:
            try:
                requests.patch(f"{SB}/rest/v1/cafe_kw_requests?id=eq.{req['id']}", headers=H,
                               json={"note": f"재확인 {i}/{len(kws)} · 살아있음 {len(alive)} · 죽음 {len(dead)}",
                                     "result": alive}, timeout=10)
            except Exception:
                pass
        parts = kw.split()
        tok = parts[0] if len(parts) >= 2 and parts[0] in master else ""
        product = " ".join(parts[1:]) if tok else kw
        r = p.classify(kw)
        _budget_note(1)
        if r.get("err"):
            errs += 1
            streak += 1
            if streak >= BLOCK_STREAK:      # 연속 실패 = 차단. 남은 건 판정 못 한 것으로 남긴다.
                return _finish(req["id"], "failed", result=alive,
                               note=f"⚠ 스캔 차단 — {len(kws) - i}건 확인 못 함. 잠시 후 다시 확인하세요.")
            continue
        streak = 0
        r2, ok, v = adjudicate(kw, r, tok, product, {tok} if tok else set())
        _cache_put(kw, r2, v if ok else None)
        time.sleep(gap)
        if ok:
            alive.append({"keyword": kw, "volume": v or 0, "theme": _disp_theme(r2),
                          "cafes": [x for x in (r2.get("rows") or []) if x.get("kind") == "카페"][:5]})
        else:
            dead.append(kw)
    note = (f"재확인 {len(kws)}건 · 살아있음 {len(alive)} · 더 이상 안 나옴 {len(dead)}"
            + (f" · 오류 {errs}" if errs else "")
            + (f" — 빼야 할 것: {', '.join(dead[:8])}{'…' if len(dead) > 8 else ''}" if dead else ""))
    _finish(req["id"], "done", result=alive, note=note)
    print(f"[{_ts()}][{req['id']}] 재확인 {len(kws)} → 생존 {len(alive)} · 사망 {len(dead)}", flush=True)


def process_chain(req, payload):
    """목표 채우기 — 키워드를 하나씩 끝까지 파고, 목표(target)를 채우면 즉시 멈춘다.
       payload = JSON {"products": ["여자창업", ...], "regions": "서울,경기,인천"}

       ★ 사장님 설계(2026-08-11). 기존 경로와 두 군데가 다르다.
         ① 제품 우선 순회 — 한 키워드의 전 지역을 다 보고 나서 다음 키워드로 간다.
            (process_menu 는 '지역 우선'이라 제품이 섞인다. 조기종료 때 특정 제품에 안 몰리게 한
             설계였는데, 여기선 반대로 '첫 키워드에서 30개를 채우면 오히려 좋다'가 요구사항이다.)
         ② 단독 판정을 각 키워드 맨 앞에 넣는다 — 지역을 안 붙여도 인기탭이면 그것부터 챙긴다.
            기존 연관형은 '전국에서 되면 지역은 안 붙인다'라 둘 다 되는 경우를 못 봤다.
            캐시로는 검증이 안 된다(해본 적이 없어 조합 자체가 없다). 제품당 몇 콜이라 싸다.
       조기종료·차단감지·캐시규약은 _run_scan 공통이라 다른 경로와 갈리지 않는다."""
    try:
        d = json.loads(payload or "{}")
    except Exception:
        return _finish(req["id"], "failed", note="목표채우기 payload 파싱 실패")
    products = [str(x).strip() for x in (d.get("products") or []) if str(x).strip()]
    if not products:
        return _finish(req["id"], "failed", note="키워드 없음 — 1개 이상 선택하세요")
    sidos = [s for s in ((d.get("regions") or req.get("regions") or "")).replace(" ", "").split(",") if s]
    if not sidos:
        sidos = ["서울", "경기", "인천"]
    dt = (req.get("deploy_type") or "")
    include_dong = ("동" in dt) or ("dong" in dt.lower())
    tokens = _region_tokens_for(sidos, include_dong)
    if not tokens:
        return _finish(req["id"], "failed", note=f"지역 토큰 없음(sido={sidos})")
    known = set(tokens)

    # ★ 2단계로 나눈다 — 1단계(전 키워드 단독) 전부 → 2단계(지역 곱하기).
    #   ⚠️ 2026-08-12 수정. 예전엔 키워드마다 '단독 + 그 키워드의 전 지역'을 한 블록으로 이어 붙였다.
    #     블록이 1 + 955(서울·경기·인천 토큰) 이라, 회차 상한 120콜이 첫 키워드의 지역에서 다 소진됐다.
    #     → 두 번째 키워드는 단독 판정조차 못 받는다. "200개를 돌면서 30개 채우면 멈춘다"는 설계가
    #       실제로는 "1번 키워드의 지역만 판다"로 동작했다.
    #     실측(DH크리드 바닥시공, 요청 #239·#240): 씨앗 200개 중 판정된 건 6개(3%)뿐이었고,
    #     이미 단독 양성으로 알던 '상가바닥공사'는 목록 57번째라 지역 차례가 446회차 뒤였다.
    #     그 4건에 지역이 붙어 판정된 조합은 0개.
    #   ★ 순서만 바꾼다 — 조합을 빼거나 더하지 않는다(누락 금지). 판정 규칙(adjudicate)도 그대로다.
    #     1단계는 키워드당 1콜이라 200개면 200콜(약 2회차)에 '어느 게 살아있나'가 전부 나온다.
    #     2단계 지역 곱하기는 그 다음이고, 목록 순서(웹이 양성 확인분을 앞으로 보냄)를 따른다.
    solo, regional, seen = [], [], set()
    for prod in products:
        # ① 단독(지역 없음) — 전 키워드 몫을 한데 모아 맨 앞에 둔다.
        nk0 = prod.replace(" ", "")
        if nk0 not in seen:
            seen.add(nk0)
            solo.append(("", prod, prod, False))
        # ② 제품이 지명이면 지역을 곱하지 않는다('송도 대전창업' 방지). 단독만 보고 넘어간다.
        if _product_place_head(prod):
            continue
        for tok in tokens:
            kw = f"{tok} {prod}"
            nk = kw.replace(" ", "")
            if nk in seen:
                continue
            seen.add(nk)
            regional.append((tok, kw, prod, tok not in known))
    kws = solo + regional
    target = int(req.get("target") or 30)
    _run_scan(req, kws, target, f"목표채우기 {len(products)}개 키워드",
              extra={"biz_name": products[0]}, tag=f"목표채우기 {products[:3]}")


def process_related(req, payload):
    """연관 인기글 — payload = JSON {"seed": "장기요양", "kws": [...], "probe": 8}
       ① kws 를 지역 없이 판정(전국형)  ② 안 되는 것만 지역 K개로 찔러 지역형인지 본다.
       결과 result = 전국형 히트. extra.regional = 지역형으로 판명된 제품키워드(전수는 지역형 스캔으로)."""
    try:
        d = json.loads(payload or "{}")
    except Exception:
        return _finish(req["id"], "failed", note="연관 payload 파싱 실패")
    seed = (d.get("seed") or "").strip()
    kws = [str(x).strip() for x in (d.get("kws") or []) if str(x).strip()]
    K = int(d.get("probe") or 8)
    if not kws:
        return _finish(req["id"], "failed", note="후보 키워드 없음")
    cf = bool(p._USE_CF)
    gap = 2.5 if cf else SCAN_GAP
    # 전국 판정 상한 — 웹 폴링이 900초라 그 안에 끝나야 '결과 없음'처럼 안 보인다.
    #   2.5초 간격 × 200 ≈ 8.5분, 찔러보기(6×8=48) 포함해도 10.5분이라 폴링 안쪽이다.
    #   캐시 히트는 네트워크 0이라 상한과 무관하게 통과한다.
    MAX_A = 200
    # ★ 깊이(6제품×8지역)를 넓이(전 제품×4지역)로 재배분한다 — 지역 K 는 8→4 로 줄여도 안전하다
    #   (신형 신도시 4곳으로 5/5 판명 실측 2026-08-10).
    #   실측(독립검증 2026-08-10, 씨앗 '간병인' 연관어 20개 전수):
    #     검색량 상위 6개 = 간병인보험·노인장기요양보험·요양보호사자격증·요양보호사시험 …
    #     전부 '정보성 키워드'라 지역을 붙여도 인기탭이 없다 → 48콜 쓰고 0건.
    #     진짜 지역형은 9위(욕창)와 20위(간병인)에 있었다. 상위 N개 컷 자체가 구조적으로 헛콜이었다.
    #   그래서 제품 수 상한(옛 MAX_PROBE_PROD=24)은 없앴다 — 아래 PROBE_MAX_LIVE(콜 예산)로만 끊는다.
    known = set(_region_tokens_for(["서울", "경기", "인천"], True))

    national, miss, errs = [], [], 0
    cache = _cache_get_many(kws[:MAX_A])
    for i, kw in enumerate(kws[:MAX_A], 1):
        if i % 5 == 1:
            try:
                requests.patch(f"{SB}/rest/v1/cafe_kw_requests?id=eq.{req['id']}", headers=H,
                               json={"note": f"전국 판정 {i}/{min(len(kws), MAX_A)} · 발견 {len(national)}"}, timeout=10)
            except Exception:
                pass
        c = cache.get(kw.replace(" ", ""))
        if c is not None and _cache_trust(c):
            (national if _is_pop(c) else miss).append(
                {"keyword": kw, "volume": c.get("volume") or 0, "theme": _disp_theme(c),
                 "cafes": [x for x in (c.get("cafes") or []) if x.get("kind") == "카페"][:5]})
            continue
        r = p.classify(kw)
        _budget_note(1)
        if r.get("err"):
            errs += 1
            if errs >= 5 and not national and not miss:
                return _finish(req["id"], "failed", note="⚠ 스캔 차단 — 잠시 후 다시 시도하세요")
            continue
        r, ok, v = adjudicate(kw, r, "", kw, set())
        v = v if v is not None else _real_volume(kw)
        _cache_put(kw, r, v)
        time.sleep(gap)
        row = {"keyword": kw, "volume": v or 0, "theme": _disp_theme(r),
               "cafes": [x for x in (r.get("rows") or []) if x.get("kind") == "카페"][:5]}
        (national if ok else miss).append(row)

    # ② 전국에서 안 나온 것 중 검색량 높은 것부터 지역으로 찔러본다.
    #    실측(전수 판정 36개 제품으로 시뮬레이션): K=8 이면 36개 중 33개를 맞히고 위양성은 0이다.
    #    즉 '찔러서 나오면 진짜 지역형'이고, 놓치는 쪽(위음성)만 K 로 줄인다.
    regional = []
    # ★ 씨앗이 지명(보홀·하와이·제주)이면 지역 축을 아예 붙이지 않는다 — 위 _is_place_seed 참고.
    #   연관어 검색량을 그대로 재활용하므로 추가 조회가 없다.
    vol_by_kw = {}
    for x in (p.searchad_keywords(seed) or []):
        k = str(x.get("keyword") or "").replace(" ", "")
        if k:
            vol_by_kw[k] = max(vol_by_kw.get(k, 0), x.get("total") or 0)
    if _is_place_seed(seed, vol_by_kw, known):
        print(f"[{_ts()}][{req['id']}] '{seed}' 는 지명 — 지역 축 생략", flush=True)
        national.sort(key=lambda f: -(f.get("volume") or 0))
        for n in national:
            n["kind"] = "national"
        _finish(req["id"], "done", result=national, extra={"biz_name": seed},
                note=f"전국형 {len(national)}건 · 씨앗이 지명이라 지역 조합은 건너뜀"
                     f"{' · 오류 ' + str(errs) if errs else ''}"
                     + (f" · 판정 {min(len(kws), MAX_A)}/{len(kws)}(상한)" if len(kws) > MAX_A else ""))
        return
    # ★ 지역 찔러보기를 '상위 24개'로 자르지 않는다(2026-08-11 사장님 요청: 나오는 건 다 보여달라).
    #   옛 코드는 miss 200개 중 24개만 찔러 176개는 지역형인지 확인조차 안 했다 — 조용한 누락이었다.
    #   실측 그날: 체크 200개 · 지역형 후보 2건. 그런데 찔러본 것들의 적중이 여자창업 3/4 ·
    #   창업떡집 3/4 · 1인창업 2/4 로 높았다 — 안 찔러본 176개에 더 있었다고 보는 게 맞다.
    #   대신 ① 이미 판정된 조합은 캐시에서 공짜로 가져오고 ② 라이브 콜만 예산으로 끊는다.
    #   끊기면 note 에 남은 개수를 명시한다(조용한 절단 금지). 다시 조회하면 캐시분을 건너뛰고 이어서 본다.
    # 제품 자체가 지명인 것은 지역을 곱하지 않는다('송도 대전창업' 방지). 전국 판정은 이미 위에서 했다.
    place_prod = [(x["keyword"], _product_place_head(x["keyword"])) for x in miss]
    skipped_place = [k for k, h in place_prod if h]
    todo = sorted([x for x in miss if not _product_place_head(x["keyword"])],
                  key=lambda x: -(x.get("volume") or 0))
    # ★ 지역 폭을 제품 수에 맞춰 늘린다(사장님 지시 2026-08-11: "넓게 봐라 — 지금 도시 말고 더 있다").
    #   고정 4곳은 좁았다. 독립검증 실측(91개 제품): 현행 4곳(청라·송도·위례·고촌) 재현율 59.3%
    #   — 지역형인 제품의 40%가 4곳에서 안 걸려 '지역형 아님'으로 지나갔다.
    #   제품이 적으면 지역을 더 넓게 본다. 같은 콜 예산에서 커버리지가 가장 커지는 배분이다.
    #     제품 ≤40 → 14곳 · ≤120 → 10곳 · 그 이상 → 8곳
    #   (제품이 많아도 8곳은 확보 — 옛 4곳의 두 배다. 판정된 조합은 캐시라 다음 회차가 훨씬 빠르다.)
    K_ADAPT = 14 if len(todo) <= 40 else (10 if len(todo) <= 120 else 8)
    probes = _probe_regions(min(max(K, K_ADAPT), len(_PROBE_SEED)))
    PROBE_MAX_LIVE = 450                 # 약 19분(2.5초 간격). 캐시 히트는 여기 안 든다.
    #   400 → 600 으로 올렸다가 450 으로 내렸다(SUB4 예산 계산 2026-08-11).
    #     600 × 2.5초 = 25분 → 분당 24콜 → 10분 롤링 240콜. 연관형 한 건이 혼자 CAP 을 다 쓴다.
    #     데몬은 예산이 없으면 0콜로 물러나므로(2abb8bf) 차단선 300 까지 가진 않지만,
    #     그 25분간 데몬이 완전히 굶고 두 번째 온디맨드가 겹치면 둘 다 느려진다.
    #     450 → 10분 롤링 180콜. 데몬 90 을 남기면서(270 < 300) 재현율 개선은 대부분 가져간다.
    #   ★ 판정 품질 때문이 아니다 — '콜을 많이 쏘면 섹션이 마른다'는 가설은 SUB4 3라운드 실측으로
    #     반증됐다(순번 효과 없음 · 부하 136/89/140콜에서 음성률 30.0/27.5/27.5% 동일).
    #     재현율 개선의 주 효과는 지역 폭 확대(4→8~14곳)지 이 상한이 아니다.
    #   화면은 시간초과돼도 자동으로 이어붙으므로(172f342) 길어지는 것 자체는 문제가 아니다.
    #   남은 것은 note 에 명시하고 다음 조회가 캐시를 건너뛰고 이어 본다.
    pcache = _cache_get_many([f"{tok} {row['keyword']}" for row in todo for tok in probes])
    plive, pleft, pushed_r = 0, 0, -1
    for j, row in enumerate(todo, 1):
        prod = row["keyword"]
        hits, unseen = [], False
        try:                             # 진행상태 + 찾는 즉시 화면에 쌓기(부분결과)
            body = {"note": f"지역형 확인 {j}/{len(todo)} · {prod} · 발견 {len(regional)}"}
            if len(regional) != pushed_r:
                body["result"] = national + regional
                pushed_r = len(regional)
            requests.patch(f"{SB}/rest/v1/cafe_kw_requests?id=eq.{req['id']}", headers=H, json=body, timeout=10)
        except Exception:
            pass
        for tok in probes:
            kw2 = f"{tok} {prod}"
            c2 = pcache.get(kw2.replace(" ", ""))
            if c2 is not None and _cache_trust(c2):      # 이미 판정됨 — 네트워크 0
                if _is_pop(c2):
                    hits.append({"keyword": kw2, "volume": c2.get("volume") or 0, "theme": _disp_theme(c2)})
                continue
            if plive >= PROBE_MAX_LIVE:                  # 회차 예산 소진 — 못 본 것으로 표시하고 넘어간다
                unseen = True
                continue
            r2 = p.classify(kw2)
            _budget_note(1)
            plive += 1
            time.sleep(gap)
            if r2.get("err"):
                continue
            r2, ok2, v2 = adjudicate(kw2, r2, tok, prod, known)
            _cache_put(kw2, r2, v2)
            if ok2:
                hits.append({"keyword": kw2, "volume": v2 or 0, "theme": _disp_theme(r2)})
        if unseen:
            pleft += 1
        if hits:
            # 지역형 후보는 '제품키워드' 자체가 결과다 — 그대로 발행하는 게 아니라
            #   이걸로 지역형 스캔을 한 번 더 돌려야 전수 키워드가 나온다. kind 로 구분해 둔다.
            regional.append({
                "kind": "regional", "keyword": prod, "volume": row.get("volume") or 0,
                "theme": f"지역형 · {len(hits)}/{len(probes)} 지역에서 발견",
                # ★ 찾은 조합을 '예시 3개'가 아니라 전부 준다(사장님 지시 2026-08-11).
                #   1/4·2/4 라고만 하면 그 1~2개가 뭔지 알 수 없어 바로 못 쓴다.
                #   이건 이미 판정된 진짜 인기탭이라 그대로 발행 키워드로 쓸 수 있다.
                "cafes": [], "sample": [h["keyword"] for h in hits],
                "hits": [{"keyword": h["keyword"], "volume": h.get("volume") or 0} for h in hits],
            })

    national.sort(key=lambda f: -(f.get("volume") or 0))
    for n in national:
        n["kind"] = "national"
    regional.sort(key=lambda f: -(f.get("volume") or 0))
    note = (f"전국형 {len(national)}건 · 지역형 후보 {len(regional)}건"
            f" · 지역 찔러보기 {len(todo) - pleft}/{len(todo)}개"
            + (f" · 지명 제품 {len(skipped_place)}개는 지역 곱하기 제외" if skipped_place else "")
            + f"{' · 오류 ' + str(errs) if errs else ''}"
            + (f" · 남은 {pleft}개(다시 조회하면 이어서 봅니다)" if pleft else "")
            + (f" · 판정 {min(len(kws), MAX_A)}/{len(kws)}(상한)" if len(kws) > MAX_A else ""))
    # 결과 배열 하나에 담고 kind 로 가른다 — cafe_kw_requests 에 별도 컬럼이 없다(extra 는 컬럼 업데이트라 실패한다).
    _finish(req["id"], "done", result=national + regional, note=note, extra={"biz_name": seed})
    print(f"[{_ts()}][{req['id']}] 연관 '{seed}' → 전국 {len(national)} · 지역형후보 {len(regional)}", flush=True)


def process_list(req, payload):
    """키워드형 — 붙여넣기(정보/메뉴)에서 추출된 키워드 리스트를 '지역 없이(전국)' 인기탭 판정.
       플레이스에 메뉴·정보가 없어 후보를 못 뽑는 경우 대체 경로. 프론트에서 검색량 선별된 리스트가 '|' 로 옴."""
    kws, seen = [], set()
    for k in (payload or "").split("|"):
        k = k.strip()
        nk = k.replace(" ", "")
        if k and nk not in seen:
            seen.add(nk)
            kws.append(k)
    if not kws:
        return _finish(req["id"], "failed", note="키워드 없음")
    cf = bool(p._USE_CF)
    # CF는 분산IP(요청이 CF 엣지에서 나감)라 사무실 IP 보호용 긴 스로틀이 불필요.
    #   실측(2026-08-04): CF classify 1건 평균 0.77s, 무-gap 직렬 20건 13s·에러 0. 옛 1.5s는 벽시계의 66%가 순수 대기였다.
    # ★ 차단은 '속도'가 아니라 '콜 수'에 걸린다 — 실측(2026-08-06) 0.81/1.28/5.78 req/s 로 7배 차이인데
    #   차단은 전부 294~302콜에서 발생. CF egress 당 약 300콜 / 10분 롤링이 한도다.
    #   따라서 병렬을 올려도 총량 이득이 0이고 쿼터만 조기 소진된다 → 직렬 + 넉넉한 간격(0.4 req/s)으로 간다.
    #   164조합 ≈ 7분(사장님 기준 10분 이내). 연속 요청에도 10분 쿼터(240콜, 실측 한도의 80%)를 안 넘긴다.
    gap = 2.5 if cf else SCAN_GAP
    MAX_LIVE = 60 if cf else 40
    total = len(kws)
    cache = _cache_get_many(kws)               # 재판정 즉시(배치 캐시)

    found, scraped, errs, capped, aborted = [], 0, 0, False, False
    for idx, kw in enumerate(kws, 1):
        if idx % 5 == 1:
            try:
                requests.patch(f"{SB}/rest/v1/cafe_kw_requests?id=eq.{req['id']}", headers=H,
                               json={"note": f"진행 {idx}/{total} · 인기탭 {len(found)}"}, timeout=10)
            except Exception:
                pass
        c = cache.get(kw.replace(" ", ""))
        # 신뢰 캐시만 히트로 인정(네이버 호출 0). '저검색'·prescan 위음성은 불신 → 재판정.
        if c is not None and _cache_trust(c):
            if _is_pop(c):
                found.append({"keyword": kw, "volume": c.get("volume") or 0, "theme": _disp_theme(c),
                              "cafes": [x for x in (c.get("cafes") or []) if x.get("kind") == "카페"][:5]})
            continue
        if scraped >= MAX_LIVE:
            capped = True                      # 상한으로 남은 키워드를 못 봄 — note 에 반드시 표기(조용한 절단 금지)
            break
        if idx % 5 == 1 and _is_canceled(req["id"]):
            aborted = True                     # 화면에서 중단 — 찾은 것은 그대로 저장한다
            break
        r = p.classify(kw)
        _budget_note(1)                        # 전역 원장 — 배경 데몬이 남은 예산을 과대평가하지 않게
        if r.get("err"):                       # C1 — 차단/일시실패는 캐시하지 않음(영구 위음성 방지)
            errs += 1
            if errs >= 5 and scraped == 0:     # 처음부터 연속 실패 = 차단. '0건'으로 위장하지 않는다.
                aborted = True
                break
            continue
        # 키워드형은 지역이 없다(tok='') → adjudicate 안에서 오타보정·검색량 게이트는 자동으로 안 탄다.
        r, ok, v = adjudicate(kw, r, "", kw, set())
        v = v if v is not None else _real_volume(kw)
        _cache_put(kw, r, v)
        scraped += 1
        time.sleep(gap)
        if ok:
            found.append({"keyword": kw, "volume": v, "theme": _disp_theme(r),
                          "cafes": [x for x in (r.get("rows") or []) if x.get("kind") == "카페"][:5]})
    found.sort(key=lambda f: -(f.get("volume") or 0))
    # 차단·다수 오류를 '완료 0건'으로 위장하지 않는다(process_region 과 동일 규약).
    if aborted or errs > _err_budget(total):
        return _finish(req["id"], "failed", result=found,
                       note=f"⚠ 스캔 차단 — {total - scraped}/{total}건 판정 못 함(오류 {errs}). "
                            f"부분결과 {len(found)}건뿐이니 잠시 후 다시 조회하세요.")
    _finish(req["id"], "done", result=found,
            note=f"{len(found)}건 · 스캔 {scraped}{' · 오류 ' + str(errs) if errs else ''}{' · 상한초과' if capped else ''}")
    print(f"[{_ts()}][{req['id']}] 리스트스캔 {total}개 → 인기탭 {len(found)}건 · 스크랩 {scraped}", flush=True)


def process(req):
    pu = req.get("place_url", "") or ""
    if pu.startswith("region:"):        # 지역 인기탭 조회(구/시 × 제품키워드)
        return process_region(req, pu[len("region:"):])
    if pu.startswith("list:"):          # 키워드형 — 붙여넣기 추출 키워드 리스트(지역 없이) 인기탭 판정
        return process_list(req, pu[len("list:"):])
    if pu.startswith("menu:"):          # 정보입력형 — 플레이스 없는 업체(위치 직접입력 × 추출 제품키워드)
        return process_menu(req, pu[len("menu:"):])
    if pu.startswith("related:"):       # 연관 인기글 — 씨앗어에서 전국형·지역형을 한 번에
        return process_related(req, pu[len("related:"):])
    if pu.startswith("chain:"):         # 목표 채우기 — 키워드를 하나씩 끝까지 파고 target 채우면 종료
        return process_chain(req, pu[len("chain:"):])
    if pu.startswith("recheck:"):       # 발행 전 재확인 — 담아둔 키워드를 라이브로 다시 판정(캐시 무시)
        return process_recheck(req, pu[len("recheck:"):])
    if pu.startswith("reviews:"):       # 리뷰 수집 — 메뉴판 없는 업체의 제품키워드 원천
        return process_reviews(req, pu[len("reviews:"):])
    pid = p.parse_place_id(pu)
    info = p.place_info(pid) if pid else None
    if not info:
        return _finish(req["id"], "failed", note="플레이스 해석 실패")
    provinces = set((req.get("regions") or "").replace(" ", "").split(",")) if req.get("regions") else set()
    target = int(req.get("target") or 10)
    cands = _candidates(info, provinces, pid, req.get("deploy_type"))
    # ★ 플레이스 주소에서 나온 하위 지역어(도로명 코어 등)는 제목 확인을 강제한다.
    #   실측 감사(2026-08-06): 인기탭 캐시 703건 중 5건이 이런 토큰이었다 — '선유남 맛집'·'전북도 삼합'.
    #   네이버가 '선유남'을 '선유동'으로 고쳐 검색해 남의 동네 인기글을 돌려준 것(검색량도 전부 ≤10).
    #   행정 마스터에 있는 토큰(시도·시군구·동·읍면)은 종전대로 — '전북 누수탐지'처럼 제목이
    #   하위 지명으로만 채워지는 정상 케이스를 죽이면 안 된다.
    _sido_of = p._sido(*(p.place_address(pid) if pid else ("", "")))
    _known = set(_region_tokens_for([_sido_of], True)) if _sido_of else set()
    found = []
    seen = set()  # 띄어쓰기 변형(군산 맛집/군산맛집) 중복 스캔·중복 결과 방지
    t0 = time.time()
    scraped = 0  # 실제 라이브 스크랩 횟수(캐시 히트 제외) — 헛스캔 측정용
    # 온디맨드 라이브 스크랩 상한 — 웹 timeout(target>10=600s / 이하=180s) 초과 방지.
    #   캐시 히트는 무제한(선수집된 플레이스는 전체 반환). 상한 도달 후 미수집분은 prescan 에 맡김.
    MAX_LIVE = 90 if target > 10 else 28
    capped = False
    errs, aborted = 0, False
    for kw, vol in cands:
        if len(found) >= target:
            break
        nk = kw.replace(" ", "")
        if nk in seen:
            continue
        seen.add(nk)
        tok0 = kw.split()[0] if " " in kw else ""
        cached = _cache_get(kw)
        if cached is not None and _cache_trust(cached):   # prescan 위음성은 불신 → 아래 라이브 재검증
            r = {"has_section": cached.get("has_section"), "theme": cached.get("theme"),
                 "verdict": cached.get("verdict"), "rows": cached.get("cafes") or []}
        elif scraped >= MAX_LIVE:
            capped = True
            continue  # 라이브 상한 도달 — 미수집분은 스캔 안 함(timeout·차단 방지, prescan 이 채움)
        else:
            r = p.classify(kw)  # 자기 IP 스캔(게이트 시 CF 자동전환)
            _budget_note(1)               # 전역 원장 — 배경 데몬이 남은 예산을 과대평가하지 않게
            if r.get("err"):              # C1 — 차단/일시실패는 캐시 안 함(영구 위음성 방지)
                errs += 1
                if errs >= 5 and scraped == 0:   # 처음부터 연속 실패 = 차단 → '0건 발견'으로 위장 금지
                    aborted = True
                    break
                continue
            # 판정은 전부 adjudicate 한 곳에서 — 제품어 = 키워드에서 앞 지역토큰을 뗀 나머지.
            r, _ok, _v = adjudicate(kw, r, tok0, kw[len(tok0):].strip() if tok0 else kw, _known)
            _cache_put(kw, r, _v if _ok else vol)
            scraped += 1
            time.sleep(SCAN_GAP)
        if _is_pop(r):
            v = vol or _real_volume(kw)  # hier 생성어(volume 0)는 실제 검색량 백필
            if tok0 and tok0 not in _known and (v or 0) <= 10:
                continue                 # 캐시 히트 경로 — 마스터 밖 지역어 + 검색량 없음은 팔 수 없다
            found.append({"keyword": kw, "volume": v, "theme": _disp_theme(r),
                          "cafes": [x for x in (r.get("rows") or []) if x.get("kind") == "카페"][:5]})
    found.sort(key=lambda f: -(f.get("volume") or 0))  # 고객 화면: 검색량 높은 순
    # 인기글 진입만으론 target(계약건수) 미달 시 — 플레이스 메뉴 기반 후보도 '실제 인기탭 스캔'해서 통과분만 추가.
    #   ⚠️ 무조건 채우기(padding) 아님: menu_keywords 후보를 classify로 검증 → 인기탭(has_section+카페분산)만 남긴다.
    #     통과율이 낮으므로 부족분보다 넉넉히(최대 40개) 뽑아 스캔하고, target 채우면 멈춘다.
    #   음식점 아니면 메뉴가 없어 자동 no-op(지역형 청소·보안 등은 hier로 이미 충분).
    if len(found) < target and pid:
        road, jibun = p.place_address(pid)
        menus = p.place_menu(pid)
        exclude = {f["keyword"].replace(" ", "") for f in found} | seen
        # 통과율이 낮으므로(맛집 메뉴 조합도 인기탭 없는 게 다수) 부족분의 넉넉한 배수로 후보를 크게 뽑아 스캔.
        #   target 채우면 즉시 멈추고(break), 끝까지 못 채우면 통과분만 반환. 상한 120(≈scan 4분, 600s 예산 내).
        pool = min(120, max(target - len(found), 1) * 12)
        for kw in p.menu_keywords(info.get("name", ""), road, jibun, menus, pool, exclude, info.get("cats") or []):
            if len(found) >= target:
                break
            nk = kw.replace(" ", "")
            if nk in seen:
                continue
            seen.add(nk)
            cached = _cache_get(kw)
            if cached is not None and _cache_trust(cached):   # prescan 위음성은 불신 → 아래 라이브 재검증
                r = {"has_section": cached.get("has_section"), "theme": cached.get("theme"),
                     "verdict": cached.get("verdict"), "rows": cached.get("cafes") or []}
            elif scraped >= MAX_LIVE:
                capped = True
                break  # 라이브 상한 도달 — 보완 스크랩 중단(timeout·차단 방지, prescan 이 채움)
            else:
                r = p.classify(kw)
                _budget_note(1)               # 전역 원장 — 배경 데몬이 남은 예산을 과대평가하지 않게
                if not r.get("err"):          # C1 — 차단/일시실패는 캐시 안 함(영구 위음성 방지)
                    _cache_put(kw, r, None)
                scraped += 1
                time.sleep(SCAN_GAP)
            if _is_pop(r):
                found.append({"keyword": kw, "volume": _real_volume(kw), "theme": _disp_theme(r),
                              "cafes": [x for x in (r.get("rows") or []) if x.get("kind") == "카페"][:5]})
        found.sort(key=lambda f: -(f.get("volume") or 0))
    cap_note = f" · ⚠라이브상한({MAX_LIVE}) 도달-부분결과(prescan 권장)" if capped else ""
    # 차단·다수 오류를 '0건 발견'으로 위장하지 않는다(process_region·process_list 와 동일 규약).
    if aborted or errs > _err_budget(len(cands)):
        return _finish(req["id"], "failed", result=found,
                       extra={"place_id": pid, "biz_name": info.get("name")},
                       note=f"⚠ 스캔 차단 — 후보 {len(cands)}건 중 라이브 {scraped}건만 판정(오류 {errs}). "
                            f"부분결과 {len(found)}건뿐이니 잠시 후 다시 조회하세요.")
    _finish(req["id"], "done", result=found,
            extra={"place_id": pid, "biz_name": info.get("name")},
            note=f"{len(found)}건 발견 / 후보 {len(cands)} / 라이브 {scraped}{cap_note}"
                 f"{' · 오류 ' + str(errs) if errs else ''}")
    top = ", ".join(f"{f['keyword']}({f.get('volume', 0)})" for f in found[:3])
    print(f"[{_ts()}][{req['id']}] {info.get('name')} → 인기탭 {len(found)}건 · 후보 {len(cands)} · 스크랩 {scraped}회 · {time.time() - t0:.0f}s | {top}", flush=True)


def main():
    if not SB or not KEY:
        print("SUPABASE_URL/SERVICE_KEY 없음 (.env 확인)")
        return
    once = "--once" in sys.argv
    # ★ 로컬 파일 캐시(cafe_kw_cache.json, TTL 7일)를 끈다 — DB 캐시(_cache_trust)가 유일한 권위가 되게.
    #   끄지 않으면: _cache_trust 가 '불신 → 라이브 재검증'으로 판단한 조합에 대해 p.classify() 안에서
    #   로컬 파일이 옛 판정을 조용히 돌려주고, 그걸 _cache_put 이 scanned_by=WID+'/m' · scanned_at=now 로
    #   DB에 다시 써서 '방금 모바일로 스캔한 신선한 음성'으로 세탁된다.
    #   → HOST_TAG · NEG_TTL_DAYS · FIX_CUTOFF_UTC · prescan 불신 네 방어가 한꺼번에 무력화된다.
    #   워커는 이미 _cache_get_many 로 DB 배치캐시를 쓰므로 로컬 캐시는 불필요하다.
    p._USE_CACHE = False
    print(f"=== 카페 인기탭 워커 시작 · {WID} · 로컬캐시 OFF(DB 권위) ===", flush=True)
    while True:
        row = _claim()
        if row:
            # 항상 CF 경유(분산IP) — 차단 방지 + 사무실 IP 미노출(검증됨: 차단 0). CAFE_KW_DIRECT=1 이면 직접(구형).
            p._USE_CF = (os.getenv("CAFE_KW_DIRECT") != "1") or p.blog_crawl_active()
            print(f"[{row['id']}] 스캔 IP: {'CF 분산' if p._USE_CF else '직접'}", flush=True)
            try:
                process(row)
            except Exception as e:
                _finish(row["id"], "failed", note=str(e)[:200])
                print(f"[{row['id']}] 실패: {e}", flush=True)
            if once:
                break
            # 요청 사이 휴식 — 차단은 순간 속도보다 '누적량'에 걸린다(실측: 연속 7건 1,148콜에서 차단).
            #   한 건은 2~4분이라 10분 기준에 여유가 있으므로, 다음 건 전에 쉬어 누적을 흩는다.
            time.sleep(REQ_REST)
        else:
            if once:
                print("대기 요청 없음")
                break
            time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
