# [SUB4 분리IP 전용] 키워드형(플레이스 기반) 선수집 → cafe_kw_targets(공유캐시) 적재.
#   목적: 접수된 고객 플레이스의 '메뉴/업체 기반 위치+키워드' 후보를 미리 인기탭 스캔해 캐시에 채워둠.
#         → 이후 담당자가 finder/발행에서 조회할 땐 전부 캐시 히트 = 라이브 스크랩 0 = 차단 0.
#   ⚠️ 대량 naver 조회라 반드시 SUB4 분리IP(폰테더링/별도 라우팅)에서. 메인 순위크롤 IP 보호.
#   가드: 23:59 하드 시간컷(새벽 크롤 회피) · 연속 차단감지 시 자동중단 · 이미 캐시된 건 skip · 사람처럼 스로틀.
#   실행: py prescan_place.py                     (접수(cafe_deploy_requests)의 모든 플레이스)
#         py prescan_place.py https://naver.me/xxx  (특정 플레이스 1건 — 테스트/즉시)
import os
import re
import sys
import time
import random
import datetime
import pathlib
from urllib.parse import quote
import requests

import cafe_kw_probe as p   # parse_place_id / place_info / place_address / place_menu / menu_keywords / classify

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

# 플레이스당 뽑을 후보 상한(스캔해서 통과분만 캐시에 남음). 넉넉히 — 차단 방지는 스로틀이 담당.
NEED_PER_PLACE = 80
# --cap N : 플레이스당 인기글 N건 확보하면 그 플레이스는 남은 후보 스캔 생략(부하·차단 방지). 0=무제한.
CAP = 0
if "--cap" in sys.argv:
    _ci = sys.argv.index("--cap")
    if _ci + 1 < len(sys.argv):
        try:
            CAP = int(sys.argv[_ci + 1])
        except ValueError:
            CAP = 0
# 차단 안 당하게 넉넉하게 — 사람처럼 느리게 + 랜덤 지터 + 주기 휴식(prescan_region 과 동일 하네스).
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


def cache_put(kw, r):
    row = {
        "keyword": kw, "has_section": bool(r.get("has_section")), "theme": r.get("theme"),
        "verdict": r.get("verdict"), "volume": 0,
        "cafes": [x for x in (r.get("rows") or []) if x.get("kind") == "카페"],
        "scanned_by": "prescan_place",
    }
    try:
        requests.post(f"{SB}/rest/v1/cafe_kw_targets", headers={**H, "Prefer": "resolution=merge-duplicates"},
                      json=[row], timeout=15)
    except Exception:
        pass


def load_place_urls():
    """접수(cafe_deploy_requests)에서 플레이스 주소들. url 이 네이버 플레이스로 해석되는 것만(지역형 홈페이지 제외)."""
    urls = []
    try:
        r = requests.get(f"{SB}/rest/v1/cafe_deploy_requests?select=url,company_name,status&order=created_at.desc&limit=500",
                         headers=H, timeout=30)
        for x in (r.json() if r.status_code == 200 else []):
            u = (x.get("url") or "").strip()
            if u and p.parse_place_id(u):   # 네이버 플레이스만(홈페이지·빈값 skip)
                urls.append((u, x.get("company_name") or "?"))
    except Exception as e:
        print(f"[prescan_place] 접수 로드 실패: {e}", flush=True)
    # 중복 플레이스 제거(같은 pid)
    seen, out = set(), []
    for u, nm in urls:
        pid = p.parse_place_id(u)
        if pid and pid not in seen:
            seen.add(pid)
            out.append((u, nm))
    return out


def candidates_for_place(url):
    """한 플레이스 → 메뉴/업체 기반 '위치+키워드' 후보 목록(무공백 dedup은 호출측 existing 로)."""
    pid = p.parse_place_id(url)
    if not pid:
        return "?", []
    info = p.place_info(pid)
    if not info:
        return "?", []
    name = info.get("name") or "?"
    road, jibun = p.place_address(pid)
    menus = p.place_menu(pid)
    cats = info.get("cats") or []
    cands = list(p.menu_keywords(name, road, jibun, menus, NEED_PER_PLACE, set(), cats))
    # 플레이스 자체 파생 키워드(업체명/업종 기반)도 후보로 — 이미 있으면 무해(dedup).
    for k in (info.get("keywords") or [])[:20]:
        if k and k not in cands:
            cands.append(k)
    return name, cands


def main():
    use_cf = "--cf" in sys.argv
    if use_cf:
        p._USE_CF = True   # CF SERP 프록시(분산IP) 경유 — naver 요청이 CF에서 나가 사무실 유선 IP 미노출.
        print("[prescan_place] ☁ CF 경유(--cf) — 분산IP 스캔, 사무실 IP 보호. 모바일 가드 생략.", flush=True)
    ipinfo = public_ip()
    print(f"[prescan_place] 공인IP {ipinfo.get('query')} · mobile={ipinfo.get('mobile')} · {ipinfo.get('isp')}", flush=True)
    # ⛔ 안전가드 — CF도 폰테더링도 아니면 중단. 사무실 유선 직접스캔=메인 새벽크롤 IP 노출이라 금지.
    if not use_cf and not ipinfo.get("mobile") and "--force" not in sys.argv:
        print("[prescan_place] ⛔ CF도 모바일도 아님 — 사무실 유선 직접스캔 중단(새벽 크롤 보호).", flush=True)
        print("[prescan_place]    분산IP는 --cf(권장), 폰테더링이면 그대로, 유선 강행은 --force.", flush=True)
        return

    # 대상 플레이스 — CLI 인자(URL) 있으면 그것만, 없으면 접수 전체.
    arg_urls = [a for a in sys.argv[1:] if a.startswith("http")]
    places = [(u, "CLI") for u in arg_urls] if arg_urls else load_place_urls()
    print(f"[prescan_place] 대상 플레이스 {len(places)}곳 · 플레이스당 최대 {NEED_PER_PLACE}후보 · 마감 {DEADLINE:%H:%M}", flush=True)
    if not places:
        print("[prescan_place] 처리할 플레이스 없음(접수에 네이버 플레이스 주소 없음).", flush=True)
        return

    # 이미 캐시된 키워드 로드(재스캔 skip)
    existing = set()
    try:
        r = requests.get(f"{SB}/rest/v1/cafe_kw_targets?select=keyword&limit=100000", headers=H, timeout=30)
        existing = {x["keyword"] for x in r.json()}
    except Exception:
        pass
    print(f"[prescan_place] 기존 캐시 {len(existing)}건 로드", flush=True)

    done = hits = skipped = blocks = 0
    t0 = time.time()
    for pu, pnm in places:
        if datetime.datetime.now() >= DEADLINE:
            print("[prescan_place] ⏹ 23:59 시간가드 도달 — 중단", flush=True)
            break
        try:
            name, cands = candidates_for_place(pu)
        except Exception as e:
            print(f"[prescan_place] 후보생성 실패 {pnm}({pu}): {e}", flush=True)
            continue
        print(f"[prescan_place] ▶ {name}({pnm}) — 후보 {len(cands)}건{' · cap ' + str(CAP) if CAP else ''}", flush=True)
        place_hits = 0
        for kw in cands:
            if datetime.datetime.now() >= DEADLINE:
                print("[prescan_place] ⏹ 23:59 시간가드 도달 — 중단", flush=True)
                break
            if CAP and place_hits >= CAP:
                print(f"[prescan_place]    ✓ {name} 목표 {CAP}건 달성 — 남은 후보 생략", flush=True)
                break
            if kw in existing:
                skipped += 1
                continue
            r = p.classify(kw)
            err = str(r.get("err", ""))
            if err:   # 어떤 err도 캐시 금지(위음성 방지) — 차단은 쿨다운, 빈응답 등은 스킵 후 다음에 재시도
                if "차단" in err:
                    blocks += 1
                    print(f"[prescan_place] ⚠ 차단감지 {blocks}/{BLOCK_STOP}: {kw} ({err}) — {BLOCK_COOLDOWN}s 쿨다운", flush=True)
                    if blocks >= BLOCK_STOP:
                        print("[prescan_place] ⏹ 연속 차단 — 자동중단(IP 보호)", flush=True)
                        return
                    time.sleep(BLOCK_COOLDOWN)
                else:
                    # 빈 200 등 비정상 응답 — '섹션없음'으로 굳히지 않고 스킵(캐시 안 함).
                    print(f"[prescan_place] ⚠ 빈응답/오류 스킵(캐시안함): {kw} ({err})", flush=True)
                    time.sleep(random.uniform(GAP_MIN, GAP_MAX))
                continue
            blocks = 0
            cache_put(kw, r)
            existing.add(kw)
            done += 1
            if r.get("has_section"):
                hits += 1
                place_hits += 1
            if done % 25 == 0:
                el = time.time() - t0
                print(f"[prescan_place] 스캔 {done} · 인기글 {hits} · skip {skipped} · {el/max(done,1):.1f}s/건", flush=True)
            if done % REST_EVERY == 0:
                rest = random.uniform(REST_MIN, REST_MAX)
                print(f"[prescan_place] ⏸ 휴식 {rest:.0f}s (누적 스캔 {done})", flush=True)
                time.sleep(rest)
            else:
                time.sleep(random.uniform(GAP_MIN, GAP_MAX))
    print(f"[prescan_place] ✅ 종료: 스캔 {done} · 인기글히트 {hits} · skip(캐시) {skipped}", flush=True)


if __name__ == "__main__":
    main()
