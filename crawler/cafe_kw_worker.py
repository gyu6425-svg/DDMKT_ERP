# -*- coding: utf-8 -*-
"""카페 인기탭 발굴 — 분산 워커 (각 PC가 자기 IP로 스캔).

  동작: Supabase 큐(cafe_kw_requests)에서 '이 플레이스 조회' 요청을 원자적으로 하나 집어
        (claim_kw_request RPC · 중복 방지) → 업종·지역 후보를 검색광고로 뽑고 → 자기 IP로
        인기탭 스캔(공유 캐시 우선) → 결과를 요청.result + 공유 캐시(cafe_kw_targets)에 저장.
  여러 PC에 설치하면 각자 다른 요청을 맡아 IP가 분산된다(용량 = PC 수 배).

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
        "scanned_by": WID,
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


def _region_tokens_for(sidos, include_dong=False):
    """cafe_region_dong 에서 선택 시도들의 지역 토큰. 기본=구/시(밀도 높음)만 — 빠르게 인기탭 즉시.
       include_dong=True('더 찾기') 일 때만 동(洞)까지 추가(검색량 게이트가 저검색 동은 자동 컷)."""
    if not sidos:
        return []
    inlist = ",".join(f'"{s}"' for s in sidos)
    try:
        rows = requests.get(f"{SB}/rest/v1/cafe_region_dong?sido=in.({inlist})&select=gu,dong&limit=20000",
                            headers=H, timeout=30).json()
    except Exception:
        return []
    gu_toks, dong_toks = set(), set()
    for r in (rows if isinstance(rows, list) else []):
        gu_toks |= _region_tokens_admin(r.get("gu") or "")
        d = (r.get("dong") or "").strip()
        if d:
            dong_toks.add(d)
    if not include_dong:
        return sorted(gu_toks)                              # 기본: 구/시만(수초)
    return sorted(gu_toks) + sorted(dong_toks - gu_toks)   # 더 찾기: 구/시 먼저, 동은 그 뒤


def _cache_get_many(kws):
    """배치 캐시 조회 — keyword in.() 로 수백 개를 몇 번의 쿼리로. {정규화kw: row}.
       재스캔 시 토큰마다 개별 GET(수백 회) 안 하도록 → 재스캔 대폭 단축."""
    out = {}
    for i in range(0, len(kws), 80):
        chunk = kws[i:i + 80]
        vals = ",".join('"' + k.replace('"', '') + '"' for k in chunk)
        try:
            r = requests.get(f"{SB}/rest/v1/cafe_kw_targets?keyword=in.({quote(vals)})"
                             f"&select=keyword,has_section,theme,verdict,volume,cafes", headers=H, timeout=20)
            for row in (r.json() if r.status_code == 200 else []):
                out[(row.get("keyword") or "").replace(" ", "")] = row
        except Exception:
            pass
    return out


def process_region(req, product):
    """지역 인기탭 조회 — 선택 시도의 구/시(기본) × 제품키워드를 검색량 게이트 후 인기탭 스캔. 통과분만 반환·캐시.
       deploy_type 에 '동'/'dong' 오면 동(洞)까지('더 찾기'). 속도: 배치 캐시조회 + 검색량컷도 캐시 + vskip 무대기."""
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
    gap = 1.5 if cf else SCAN_GAP
    VMIN = int(req.get("vmin") or 20)          # 검색량 게이트(요청 vmin 우선)
    MAX_LIVE = 400 if cf else 120
    # 후보 키워드(중복 제거) → 배치 캐시 조회 한 번에.
    kws, seen = [], set()
    for tok in tokens:
        kw = f"{tok} {product}"
        nk = kw.replace(" ", "")
        if nk in seen:
            continue
        seen.add(nk)
        kws.append(kw)
    total = len(kws)
    cache = _cache_get_many(kws)               # ④ 배치 캐시(재스캔 즉시)

    def _pop(r):
        return r.get("has_section") and str(r.get("verdict", "")).startswith("카페분산") and "레시피" not in (r.get("theme") or "")

    found, scraped, vskip, capped = [], 0, 0, False
    for idx, kw in enumerate(kws, 1):
        if len(found) >= target:
            break
        if idx % 8 == 1:   # 진행상태(프론트 게이지바)
            try:
                requests.patch(f"{SB}/rest/v1/cafe_kw_requests?id=eq.{req['id']}", headers=H,
                               json={"note": f"진행 {idx}/{total} · 인기탭 {len(found)}"}, timeout=10)
            except Exception:
                pass
        c = cache.get(kw.replace(" ", ""))
        if c is not None:                      # 캐시 히트(인기탭/저검색 판정 재사용) — 네이버 호출 0
            if _pop(c):
                found.append({"keyword": kw, "volume": c.get("volume") or 0, "theme": c.get("theme"),
                              "cafes": [x for x in (c.get("cafes") or []) if x.get("kind") == "카페"][:5]})
            continue
        if scraped >= MAX_LIVE:
            capped = True
            continue
        v = _real_volume(kw)
        if v < VMIN:                           # 저검색 — ④ 캐시해서 다음엔 재조회 안 함. ② 대기 없음.
            _cache_put(kw, {"has_section": False, "verdict": "저검색", "theme": None, "rows": []}, v)
            vskip += 1
            continue
        r = p.classify(kw)
        _cache_put(kw, r, v)
        scraped += 1
        time.sleep(gap)
        if _pop(r):
            found.append({"keyword": kw, "volume": v, "theme": r.get("theme"),
                          "cafes": [x for x in (r.get("rows") or []) if x.get("kind") == "카페"][:5]})
    found.sort(key=lambda f: -(f.get("volume") or 0))
    scope = "동포함" if include_dong else "구시"
    _finish(req["id"], "done", result=found, extra={"biz_name": product},
            note=f"{len(found)}건 · 스캔 {scraped} · 검색량컷 {vskip} · {scope}{' · 상한' if capped else ''}")
    print(f"[{_ts()}][{req['id']}] 지역스캔 '{product}' {sidos} {scope} → 인기탭 {len(found)}건 · 스크랩 {scraped} · vcut {vskip}", flush=True)


def process(req):
    pu = req.get("place_url", "") or ""
    if pu.startswith("region:"):        # 지역 인기탭 조회(구/시 × 제품키워드)
        return process_region(req, pu[len("region:"):])
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
    for kw, vol in cands:
        if len(found) >= target:
            break
        nk = kw.replace(" ", "")
        if nk in seen:
            continue
        seen.add(nk)
        cached = _cache_get(kw)
        if cached is not None:
            r = {"has_section": cached.get("has_section"), "theme": cached.get("theme"),
                 "verdict": cached.get("verdict"), "rows": cached.get("cafes") or []}
        elif scraped >= MAX_LIVE:
            capped = True
            continue  # 라이브 상한 도달 — 미수집분은 스캔 안 함(timeout·차단 방지, prescan 이 채움)
        else:
            r = p.classify(kw)  # 자기 IP 스캔(게이트 시 CF 자동전환)
            _cache_put(kw, r, vol)
            scraped += 1
            time.sleep(SCAN_GAP)
        if r.get("has_section") and str(r.get("verdict", "")).startswith("카페분산") and "레시피" not in (r.get("theme") or ""):
            v = vol or _real_volume(kw)  # hier 생성어(volume 0)는 실제 검색량 백필
            found.append({"keyword": kw, "volume": v, "theme": r.get("theme"),
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
            if cached is not None:
                r = {"has_section": cached.get("has_section"), "theme": cached.get("theme"),
                     "verdict": cached.get("verdict"), "rows": cached.get("cafes") or []}
            elif scraped >= MAX_LIVE:
                capped = True
                break  # 라이브 상한 도달 — 보완 스크랩 중단(timeout·차단 방지, prescan 이 채움)
            else:
                r = p.classify(kw)
                _cache_put(kw, r, None)
                scraped += 1
                time.sleep(SCAN_GAP)
            if r.get("has_section") and str(r.get("verdict", "")).startswith("카페분산") and "레시피" not in (r.get("theme") or ""):
                found.append({"keyword": kw, "volume": _real_volume(kw), "theme": r.get("theme"),
                              "cafes": [x for x in (r.get("rows") or []) if x.get("kind") == "카페"][:5]})
        found.sort(key=lambda f: -(f.get("volume") or 0))
    cap_note = f" · ⚠라이브상한({MAX_LIVE}) 도달-부분결과(prescan 권장)" if capped else ""
    _finish(req["id"], "done", result=found,
            extra={"place_id": pid, "biz_name": info.get("name")},
            note=f"{len(found)}건 발견 / 후보 {len(cands)} / 라이브 {scraped}{cap_note}")
    top = ", ".join(f"{f['keyword']}({f.get('volume', 0)})" for f in found[:3])
    print(f"[{_ts()}][{req['id']}] {info.get('name')} → 인기탭 {len(found)}건 · 후보 {len(cands)} · 스크랩 {scraped}회 · {time.time() - t0:.0f}s | {top}", flush=True)


def main():
    if not SB or not KEY:
        print("SUPABASE_URL/SERVICE_KEY 없음 (.env 확인)")
        return
    once = "--once" in sys.argv
    print(f"=== 카페 인기탭 워커 시작 · {WID} ===", flush=True)
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
        else:
            if once:
                print("대기 요청 없음")
                break
            time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
