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
    # 후보 통합 + 필터(오프토픽·타지역 컷). 키워드형은 _region_ok가 지역형 키워드를 전부 컷.
    base = []
    for k in hier + cats + info["keywords"]:
        if k and not p.is_brandish(k) and not p.is_offtopic(k) and _region_ok(k, provinces, own) and k not in base:
            base.append(k)
    for kw in sorted(vol, key=lambda k: -vol[k]):
        if not p.is_offtopic(kw) and _region_ok(kw, provinces, own) and kw not in base:
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
       region_core 는 호출부 시그니처 호환용으로만 남긴다(판정에 쓰지 않음)."""
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
    # 후보 (tok, kw) — tok 은 오탐필터의 지역코어용. 중복 제거.
    kws, seen = [], set()
    for tok in tokens:
        kw = f"{tok} {product}"
        nk = kw.replace(" ", "")
        if nk in seen:
            continue
        seen.add(nk)
        kws.append((tok, kw))
    total = len(kws)
    MAX_LIVE = max(total, 400) if cf else 120   # 전수 스캔 보장 — 상한이 토큰수보다 작아 뒷지역 누락되던 것 방지
    cache = _cache_get_many([kw for _, kw in kws])  # 배치 캐시(재스캔 즉시)

    found, scraped, errs, capped = [], 0, 0, False
    dead_chunks, aborted = 0, False   # 차단 감지(청크 전멸)·중단 여부
    # ① 캐시 패스(네트워크 0) — 신뢰 캐시로 이미 결론난 건 즉시 채택/스킵하고, 남은 것만 라이브 대상으로.
    to_scan = []
    for tok, kw in kws:
        c = cache.get(kw.replace(" ", ""))
        # 신뢰 캐시만 채택·건너뜀. prescan 위음성(섹션없음)은 불신 → 라이브 재검증. verdict 에 topicality 반영됨.
        if c is not None and _cache_trust(c):
            if _is_pop(c):
                found.append({"keyword": kw, "volume": c.get("volume") or 0, "theme": _disp_theme(c),
                              "cafes": [x for x in (c.get("cafes") or []) if x.get("kind") == "카페"][:5]})
            continue
        to_scan.append((tok, kw))
    if len(to_scan) > MAX_LIVE:
        to_scan = to_scan[:MAX_LIVE]
        capped = True

    # 조합 1건 처리(스레드에서 실행) — classify → 오탐필터 → 캐시. 반환 ('pop'|'neg'|'err', 결과).
    def _scan_one(item):
        tok, kw = item
        r = p.classify(kw)
        if r.get("err"):                       # C1 — 차단/일시실패는 캐시하지 않음(영구 위음성 방지). 다음에 재시도.
            return ("err", None)
        # 오탐 필터: 인기글 섹션이 이 지역×제품과 무관(generic 채움)이면 '비관련'으로 강등 → 채택·캐시에서 탈락.
        if _is_pop(r) and not _topical(r.get("rows"), product, _region_core(tok)):
            r = {"has_section": r.get("has_section"), "verdict": "비관련(오탐)", "theme": r.get("theme"), "rows": r.get("rows")}
        if _is_pop(r):
            v = _real_volume(kw)               # 표시·정렬용 검색량 — 인기탭인 것만 1콜(스로틀 부담↓)
            _cache_put(kw, r, v)
            return ("pop", {"keyword": kw, "volume": v, "theme": _disp_theme(r),
                            "cafes": [x for x in (r.get("rows") or []) if x.get("kind") == "카페"][:5]})
        _cache_put(kw, r, None)                # 섹션없음·비관련도 캐시(재스캔 즉시) — 볼륨 불필요
        return ("neg", None)

    # ② 라이브 패스 — CF는 분산IP(요청이 CF 엣지에서 나감)라 병렬이 안전하다.
    #    실측(2026-08-04): 병렬x6 20건 2.1s·에러0 (직렬 무gap 13s 대비 6배). 사무실 직접 IP는 차단 보호로 직렬 유지.
    PAR = 1 if cf else 1
    ex = ThreadPoolExecutor(max_workers=PAR) if PAR > 1 else None
    try:
        for i in range(0, len(to_scan), PAR):
            if len(found) >= target:
                break
            chunk = to_scan[i:i + PAR]
            try:                               # 진행상태(프론트 게이지바)
                requests.patch(f"{SB}/rest/v1/cafe_kw_requests?id=eq.{req['id']}", headers=H,
                               json={"note": f"진행 {i + len(chunk)}/{len(to_scan)} · 인기탭 {len(found)}"}, timeout=10)
            except Exception:
                pass
            results = list(ex.map(_scan_one, chunk)) if ex else [_scan_one(x) for x in chunk]
            # 청크가 통째로 실패 = 차단 신호. 백오프 후 1회 재시도하고, 그래도 전멸이면 중단한다.
            #   ★ 차단인데 '0건 완료'로 반환하면 고객에겐 '인기탭 없음'과 구별되지 않는다(조용한 미달).
            if all(k == "err" for k, _ in results):
                dead_chunks += 1
                if dead_chunks == 1:
                    time.sleep(BLOCK_BACKOFF)          # 실측: CF 차단은 100초 이상 지속 → 충분히 쉬고 재시도
                    results = list(ex.map(_scan_one, chunk)) if ex else [_scan_one(x) for x in chunk]
                    if all(k == "err" for k, _ in results):
                        aborted = True
                    else:
                        dead_chunks = 0
                else:
                    aborted = True
            else:
                dead_chunks = 0
            for kind, item in results:
                if kind == "err":
                    errs += 1
                    continue
                scraped += 1
                if kind == "pop":
                    found.append(item)
            if aborted:
                break
            time.sleep(gap)                    # 청크 사이만 쉼(병렬이면 건당 실효 gap = gap/PAR)
    finally:
        if ex:
            ex.shutdown(wait=False)
    found.sort(key=lambda f: -(f.get("volume") or 0))
    scope = "동포함" if include_dong else "구시"
    # 판정 못 한 조합이 많으면 '완료'로 위장하지 않는다 — 결과가 불완전함을 명시하고 failed 로 끝낸다.
    unscanned = len(to_scan) - scraped
    if aborted or errs > _err_budget(len(to_scan)):
        return _finish(req["id"], "failed", result=found, extra={"biz_name": product},
                       note=f"⚠ 스캔 차단 — {unscanned}/{len(to_scan)}건 판정 못 함(오류 {errs}). "
                            f"부분결과 {len(found)}건뿐이니 잠시 후 다시 조회하세요.")
    _finish(req["id"], "done", result=found, extra={"biz_name": product},
            note=f"{len(found)}건 · 스캔 {scraped}{' · 오류 ' + str(errs) if errs else ''} · {scope}{' · 상한초과' if capped else ''}")
    print(f"[{_ts()}][{req['id']}] 지역스캔 '{product}' {sidos} {scope} → 인기탭 {len(found)}건 · 스크랩 {scraped} · err {errs}", flush=True)


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
        r = p.classify(kw)
        if r.get("err"):                       # C1 — 차단/일시실패는 캐시하지 않음(영구 위음성 방지)
            errs += 1
            if errs >= 5 and scraped == 0:     # 처음부터 연속 실패 = 차단. '0건'으로 위장하지 않는다.
                aborted = True
                break
            continue
        # 오탐 필터(키워드형=지역 없음) — 제목에 제품어(=키워드) 관련 글 없으면 비관련 강등.
        if _is_pop(r) and not _topical(r.get("rows"), kw, None):
            r = {"has_section": r.get("has_section"), "verdict": "비관련(오탐)", "theme": r.get("theme"), "rows": r.get("rows")}
        v = _real_volume(kw)
        _cache_put(kw, r, v)
        scraped += 1
        time.sleep(gap)
        if _is_pop(r):
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
    pid = p.parse_place_id(pu)
    info = p.place_info(pid) if pid else None
    if not info:
        return _finish(req["id"], "failed", note="플레이스 해석 실패")
    provinces = set((req.get("regions") or "").replace(" ", "").split(",")) if req.get("regions") else set()
    target = int(req.get("target") or 10)
    cands = _candidates(info, provinces, pid, req.get("deploy_type"))
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
        cached = _cache_get(kw)
        if cached is not None and _cache_trust(cached):   # prescan 위음성은 불신 → 아래 라이브 재검증
            r = {"has_section": cached.get("has_section"), "theme": cached.get("theme"),
                 "verdict": cached.get("verdict"), "rows": cached.get("cafes") or []}
        elif scraped >= MAX_LIVE:
            capped = True
            continue  # 라이브 상한 도달 — 미수집분은 스캔 안 함(timeout·차단 방지, prescan 이 채움)
        else:
            r = p.classify(kw)  # 자기 IP 스캔(게이트 시 CF 자동전환)
            if r.get("err"):              # C1 — 차단/일시실패는 캐시 안 함(영구 위음성 방지)
                errs += 1
                if errs >= 5 and scraped == 0:   # 처음부터 연속 실패 = 차단 → '0건 발견'으로 위장 금지
                    aborted = True
                    break
                continue
            _cache_put(kw, r, vol)
            scraped += 1
            time.sleep(SCAN_GAP)
        if _is_pop(r):
            v = vol or _real_volume(kw)  # hier 생성어(volume 0)는 실제 검색량 백필
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
