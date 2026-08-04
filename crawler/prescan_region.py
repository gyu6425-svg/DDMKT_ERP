# [SUB4 분리IP 전용] 5개 업체 지역키워드 미리 스캔 → cafe_kw_targets(공유캐시) 적재.
#   목적: 지역형 접수가 '행정구 업종키워드'의 인기글 진입/카페수를 즉시 읽게 미리 채워둠.
#   ※ 실측(2026-07): 동(洞) 단위는 인기탭 진입 ~0%, 구/시 단위라야 잡힘 → 동 태스크 폐기, 구/시로.
#     경기는 시 단위(수원·성남·과천 등)에서 통과가 많이 나와 시·구 토큰을 함께 생성.
#   ⚠️ 대량 naver 조회라 반드시 SUB4 분리IP(폰/별도 라우팅)에서. 메인 순위크롤 IP 보호.
#   가드: 23:59 하드 시간컷(새벽 크롤 회피) · 연속 차단감지 시 자동중단 · 이미 캐시된 건 skip · 스로틀.
#   실행: py prescan_region.py               (서울만 — 기본)
#         py prescan_region.py 서울 경기 인천   (범위 지정, 순서대로)
#         py prescan_region.py 대전 세종 충북 충남 --cf   (충청권 — 17개 시도 전부 인자 가능)
#     ⚠️ 시도 오타(마스터에 없는 이름)면 조용히 서울로 안 가고 즉시 중단.
import os
import re
import sys
import json
import time
import random
import datetime
import pathlib
from urllib.parse import quote
import requests

import cafe_kw_probe as p   # classify(인기글 판정)

requests.packages.urllib3.disable_warnings()
HERE = pathlib.Path(__file__).resolve().parent

# env
for envp in (HERE / ".env",):
    if envp.exists():
        for line in envp.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = re.match(r'^([A-Z_]+)\s*=\s*"?([^"\n\r]+)"?', line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip()
SB = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

# 업체별 업종키워드(기존 발행글에서 확정). 입주청소는 더티·더반 공유 → 유니크로 스캔.
COMPANIES = {
    "더맨": ["경호업체", "경호", "신변보호", "행사경호", "회사보안", "보안업체", "사설경호"],
    "설고": ["소방점검", "소방시설", "소방공사", "소방관리", "소방업체", "소방수리"],
    "더티": ["입주청소"],
    "더반": ["입주청소", "이사청소", "청소업체", "상가청소"],   # 사무실청소 제외(1.2%·헛스캔), 상가청소 추가
    "누수": ["누수탐지"],
}
KEYWORDS = sorted({kw for lst in COMPANIES.values() for kw in lst})

# 시도 화이트리스트를 마스터(region_dong_master.json)에서 읽음 — 17개 시도 전부 인자로 사용 가능.
#   (옛 버그: 서울/경기/인천 하드코딩 → 대전·충북 등이 조용히 서울로 폴백돼 엉뚱한 지역 4시간 스캔)
try:
    _SIDOS = {m["sido"] for m in json.loads((HERE / "region_dong_master.json").read_text(encoding="utf-8"))}
except Exception:
    _SIDOS = {"서울", "경기", "인천"}


def _parse_sido_order():
    """CLI 인자에서 스캔할 시도 순서. 위치인자(--flag·--cap/--vmin 값 제외)만 후보.
       시도 아닌 위치인자(오타)가 있으면 조용히 서울로 폴백하지 않고 중단(엉뚱한 4시간 스캔 방지).
       ※ 모듈 import 시 부작용(다른 스크립트 argv로 sys.exit) 방지 위해 함수로 분리 — main()에서만 호출."""
    flag_vals = set()
    for f in ("--cap", "--vmin"):
        if f in sys.argv and sys.argv.index(f) + 1 < len(sys.argv):
            flag_vals.add(sys.argv[sys.argv.index(f) + 1])
    cand = [a for a in sys.argv[1:] if not a.startswith("--") and a not in flag_vals]
    order = [a for a in cand if a in _SIDOS]
    bad = [a for a in cand if a not in _SIDOS]
    if bad:
        print(f"[prescan] ⛔ 알 수 없는 지역 인자 {bad} — 유효 시도: {sorted(_SIDOS)}", flush=True)
        print("[prescan]    오타로 엉뚱한 지역을 스캔하지 않도록 중단합니다.", flush=True)
        sys.exit(1)
    return order or ["서울"]   # 인자 없으면 서울(기존 기본값)
# --cap N : 업종어별로 인기글 N건 확보하면 그 업종은 남은 지역 스캔 생략(부하·차단 방지, 테스트용). 0=무제한.
CAP = 0
if "--cap" in sys.argv:
    _ci = sys.argv.index("--cap")
    if _ci + 1 < len(sys.argv):
        try:
            CAP = int(sys.argv[_ci + 1])
        except ValueError:
            CAP = 0
# --vmin N : 검색량 게이트. '구/시 제품키워드' 월검색량 N 미만은 인기탭 스캔 자체를 건너뜀(헛스캔·차단↓).
#   지방(전국) 확장 시 필수 — 검색량 없는 조합을 searchad(무차단)로 먼저 걸러 classify 를 아낀다. 0=끄기.
VMIN = 0
if "--vmin" in sys.argv:
    _vi = sys.argv.index("--vmin")
    if _vi + 1 < len(sys.argv):
        try:
            VMIN = int(sys.argv[_vi + 1])
        except ValueError:
            VMIN = 0


def _volume(kw):
    """그 키워드 자체의 월 검색량(PC+모바일). searchad(검색광고 API·무차단)로 조회."""
    norm = kw.replace(" ", "")
    try:
        for r in p.searchad_keywords(kw):
            if (r.get("keyword") or "").replace(" ", "") == norm:
                return r.get("total", 0)
    except Exception:
        pass
    return 0
# 차단 안 당하게 넉넉하게 — 사람처럼 느리게 + 랜덤 지터 + 주기 휴식.
GAP_MIN, GAP_MAX = 3.0, 5.0     # 스캔 간 스로틀(초, 랜덤)
REST_EVERY = 60                 # 이만큼 스캔하면
REST_MIN, REST_MAX = 45, 90     # 이만큼 길게 쉼(초, 랜덤)
BLOCK_STOP = 3                  # 연속 차단감지 N회면 중단(보수적)
BLOCK_COOLDOWN = 120            # 차단감지 시 쿨다운(초)
DEADLINE = datetime.datetime.now().replace(hour=23, minute=59, second=0, microsecond=0)


def public_ip():
    try:
        return requests.get("http://ip-api.com/json/?fields=query,mobile,isp", timeout=10).json()
    except Exception:
        return {}


def region_tokens(gu):
    """행정구 문자열 → 스캔 지역토큰들. '수원시 장안구'→{수원시,수원,장안구,장안}, '강남구'→{강남구,강남}.
       '고양시덕양구'(붙은형)도 시/구로 분리. 접미형·기본형 둘 다 생성(SUB4 실측: 업종별로 통과 형태가 갈림)."""
    toks = set()
    parts = []
    for part in (gu or "").split():
        mm = re.match(r"^(.+?시)(.+구)$", part)   # 고양시덕양구 → 고양시 + 덕양구
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


# --refresh : 기존 캐시를 skip하지 않고 전수 재스캔한다. 옛 prescan 음성(빈200 위음성 시절 산출)을 치유하는 배치.
#   저장 시 scanned_by 를 'prescan' 이 아닌 값으로 남긴다 — 워커 _cache_trust 가 'prescan' 음성은 항상 불신하기 때문.
#   이걸 한 번 돌려두면 온디맨드 지역스캔이 캐시를 실제로 신뢰해 즉시 응답한다(현재는 100% 라이브 재검증이라 느림).
REFRESH = "--refresh" in sys.argv
SCANNED_BY = "prescan-v2" if REFRESH else "prescan"


def _load_all_keywords():
    """cafe_kw_targets 의 keyword 전량 로드(offset 페이지네이션). PostgREST 기본 1000 상한 우회 — limit=100000 도 1000에서 잘림."""
    out, off = set(), 0
    while True:
        try:
            r = requests.get(f"{SB}/rest/v1/cafe_kw_targets", headers=H, timeout=30,
                             params={"select": "keyword", "order": "keyword.asc", "limit": "1000", "offset": str(off)}).json()
        except Exception:
            break
        if not isinstance(r, list) or not r:
            break
        out |= {x["keyword"] for x in r}
        if len(r) < 1000:
            break
        off += 1000
    return out


def cache_put(kw, r):
    row = {
        "keyword": kw, "has_section": bool(r.get("has_section")), "theme": r.get("theme"),
        "verdict": r.get("verdict"), "volume": 0,
        "cafes": [x for x in (r.get("rows") or []) if x.get("kind") == "카페"],
        "scanned_by": SCANNED_BY,
        "scanned_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    try:
        requests.post(f"{SB}/rest/v1/cafe_kw_targets", headers={**H, "Prefer": "resolution=merge-duplicates"},
                      json=[row], timeout=15)
    except Exception:
        pass


def main():
    global W
    import cafe_kw_worker as W   # 오탐필터(_topical/_is_pop/_region_core) 재사용. env 세팅 후여야 해서 main 안에서 import.
    SIDO_ORDER = _parse_sido_order()   # 인자 검증(오타면 여기서 중단) — import 부작용 방지 위해 main 안에서 파싱
    use_cf = "--cf" in sys.argv
    if use_cf:
        p._USE_CF = True   # CF SERP 프록시(분산IP) 경유 — naver 요청이 CF에서 나가 사무실 유선 IP 미노출.
        print("[prescan] ☁ CF 경유(--cf) — 분산IP 스캔, 사무실 IP 보호. 모바일 가드 생략.", flush=True)
    ipinfo = public_ip()
    print(f"[prescan] 공인IP {ipinfo.get('query')} · mobile={ipinfo.get('mobile')} · {ipinfo.get('isp')}", flush=True)
    # ⛔ 안전가드 — CF도 폰테더링도 아니면 중단. 사무실 유선 직접스캔=메인 새벽크롤 IP 노출이라 금지.
    if not use_cf and not ipinfo.get("mobile") and "--force" not in sys.argv:
        print("[prescan] ⛔ CF도 모바일도 아님 — 사무실 유선 직접스캔 중단(새벽 크롤 보호).", flush=True)
        print("[prescan]    분산IP는 --cf(권장), 폰테더링이면 그대로, 유선 강행은 --force.", flush=True)
        return
    print(f"[prescan] 범위 {SIDO_ORDER} · 업종어 {KEYWORDS} · 마감 {DEADLINE:%H:%M}", flush=True)

    master = json.loads((HERE / "region_dong_master.json").read_text(encoding="utf-8"))
    # 이미 캐시된 키워드 전량 로드(멤버십 체크 — 재스캔 skip). PostgREST 기본 1000 상한이라 offset 페이지네이션 필수.
    #   ⚠️ --refresh 면 skip하지 않는다: 옛 prescan 산출물(빈200 위음성 시절)을 새 classify로 다시 찍기 위함.
    existing = set() if REFRESH else _load_all_keywords()
    if REFRESH:
        print("[prescan] ♻ --refresh — 기존 캐시 무시하고 전수 재스캔(옛 위음성 치유). "
              f"scanned_by='{SCANNED_BY}' 로 저장돼 온디맨드가 신뢰(TTL 21일)한다.", flush=True)
    else:
        print(f"[prescan] 기존 캐시 {len(existing)}건 로드", flush=True)

    # 태스크: 시도 순서대로 행정구/시 토큰 × 업종어 → '강남 입주청소'. (동 폐기 — 실측상 인기탭 0)
    tasks, seen = [], set()
    for sido in SIDO_ORDER:
        # ★ 시도명 자체도 토큰 — 보통 그 제품의 최대 검색량 키워드('서울 누수탐지' ≫ '강남 누수탐지').
        #   실측(2026-08-04): 광역시 8/8 인기탭, 道도 다수. 접미형(서울시·강원도)은 섹션없음이라 제외.
        toks = {sido}
        for m in master:
            if m["sido"] == sido:
                toks |= region_tokens(m["gu"])
        for kw in KEYWORDS:
            for tk in sorted(toks):
                t = f"{tk} {kw}"
                if t not in seen:
                    seen.add(t)
                    tasks.append((t, kw))   # (스캔어, 업종어) — --cap 업종별 집계용
    print(f"[prescan] 총 태스크 {len(tasks)}건 (구/시 토큰 기반){' · cap ' + str(CAP) + '/업종' if CAP else ''}", flush=True)

    done = hits = skipped = blocks = vskip = irrel = 0
    hits_by_biz = {}
    t0 = time.time()
    for i, (task, biz) in enumerate(tasks, 1):
        if datetime.datetime.now() >= DEADLINE:
            print(f"[prescan] ⏹ 23:59 시간가드 도달 — 중단 ({i-1}/{len(tasks)})", flush=True)
            break
        if CAP and hits_by_biz.get(biz, 0) >= CAP:
            continue  # 이 업종어 목표수(--cap) 달성 — 남은 지역 스캔 생략
        if task in existing:
            skipped += 1
            continue
        if VMIN and _volume(task) < VMIN:
            vskip += 1
            time.sleep(0.3)   # searchad 무리없게
            continue
        r = p.classify(task)
        err = str(r.get("err", ""))
        if err:   # 어떤 err도 캐시 금지(위음성 방지) — 차단은 쿨다운, 빈응답 등은 스킵 후 다음에 재시도
            if "차단" in err:
                blocks += 1
                print(f"[prescan] ⚠ 차단감지 {blocks}/{BLOCK_STOP}: {task} ({err}) — {BLOCK_COOLDOWN}s 쿨다운", flush=True)
                if blocks >= BLOCK_STOP:
                    print("[prescan] ⏹ 연속 차단 — 자동중단(IP 보호)", flush=True)
                    break
                time.sleep(BLOCK_COOLDOWN)
            else:
                # 빈 200 등 비정상 응답 — '섹션없음'으로 굳히지 않고 스킵(캐시 안 함). 7/31 위음성 2009건 재발 방지.
                print(f"[prescan] ⚠ 빈응답/오류 스킵(캐시안함): {task} ({err})", flush=True)
                time.sleep(random.uniform(GAP_MIN, GAP_MAX))
            continue
        blocks = 0
        # 오탐 필터를 여기서도 적용 — 안 하면 캐시가 필터를 우회한다.
        #   워커는 신뢰 캐시(scanned_by != 'prescan')를 캐시히트로 바로 채택하므로, prescan 이 원시 판정만
        #   저장하면 generic 채움(무관 섹션)이 필터 없이 고객에게 나간다(실측 generic 기저율 7.6%).
        #   task = "<지역토큰> <업종어>" 이므로 지역토큰을 되잘라 지역코어로 쓴다.
        if W._is_pop(r):
            tok = task[: len(task) - len(biz)].strip()
            if not W._topical(r.get("rows"), biz, W._region_core(tok)):
                r = {"has_section": r.get("has_section"), "verdict": "비관련(오탐)",
                     "theme": r.get("theme"), "rows": r.get("rows")}
                irrel += 1
        cache_put(task, r)
        existing.add(task)
        done += 1
        if r.get("has_section"):
            hits += 1
            hits_by_biz[biz] = hits_by_biz.get(biz, 0) + 1
        if done % 25 == 0:
            el = time.time() - t0
            print(f"[prescan] {i}/{len(tasks)} · 스캔 {done} · 인기글 {hits} · skip {skipped} · {el/max(done,1):.1f}s/건", flush=True)
        # 주기 휴식(사람처럼) — 지속 부하 완화
        if done % REST_EVERY == 0:
            rest = random.uniform(REST_MIN, REST_MAX)
            print(f"[prescan] ⏸ 휴식 {rest:.0f}s (누적 스캔 {done})", flush=True)
            time.sleep(rest)
        else:
            time.sleep(random.uniform(GAP_MIN, GAP_MAX))
    biz_summary = " · ".join(f"{b}:{hits_by_biz.get(b, 0)}" for b in KEYWORDS)
    print(f"[prescan] ✅ 종료: 스캔 {done} · 인기글히트 {hits}(그중 비관련강등 {irrel}) · skip(캐시) {skipped} · 검색량컷 {vskip}", flush=True)
    print(f"[prescan]    업종별 인기글: {biz_summary}", flush=True)


if __name__ == "__main__":
    main()
