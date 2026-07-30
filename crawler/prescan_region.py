# [SUB4 분리IP 전용] 5개 업체 지역키워드 미리 스캔 → cafe_kw_targets(공유캐시) 적재.
#   목적: 지역형 접수가 '동 업종키워드'의 인기글 진입/카페수를 즉시 읽게 미리 채워둠.
#   ⚠️ 대량 naver 조회라 반드시 SUB4 분리IP(폰/별도 라우팅)에서. 메인 순위크롤 IP 보호.
#   가드: 23:59 하드 시간컷(새벽 크롤 회피) · 연속 차단감지 시 자동중단 · 이미 캐시된 건 skip · 스로틀.
#   실행: py prescan_region.py               (서울만 — 기본)
#         py prescan_region.py 서울 경기 인천   (범위 지정, 순서대로)
import os
import re
import sys
import json
import time
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
    "더맨": ["회사보안", "사설경호"],
    "설고": ["소방업체"],
    "더티": ["입주청소"],
    "더반": ["입주청소", "이사청소", "청소업체", "사무실청소"],
    "누수": ["누수탐지"],
}
KEYWORDS = sorted({kw for lst in COMPANIES.values() for kw in lst})

SIDO_ORDER = [a for a in sys.argv[1:] if a in ("서울", "경기", "인천")] or ["서울"]
GAP = 1.5             # 스캔 간 스로틀(초)
BLOCK_STOP = 5        # 연속 차단감지 N회면 중단
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
        "scanned_by": "prescan",
    }
    try:
        requests.post(f"{SB}/rest/v1/cafe_kw_targets", headers={**H, "Prefer": "resolution=merge-duplicates"},
                      json=[row], timeout=15)
    except Exception:
        pass


def main():
    ipinfo = public_ip()
    print(f"[prescan] 공인IP {ipinfo.get('query')} · mobile={ipinfo.get('mobile')} · {ipinfo.get('isp')}", flush=True)
    print(f"[prescan] 범위 {SIDO_ORDER} · 업종어 {KEYWORDS} · 마감 {DEADLINE:%H:%M}", flush=True)

    master = json.loads((HERE / "region_dong_master.json").read_text(encoding="utf-8"))
    # 이미 캐시된 키워드 1회 로드(멤버십 체크 — 재스캔 skip)
    existing = set()
    try:
        r = requests.get(f"{SB}/rest/v1/cafe_kw_targets?select=keyword&limit=100000", headers=H, timeout=30)
        existing = {x["keyword"] for x in r.json()}
    except Exception:
        pass
    print(f"[prescan] 기존 캐시 {len(existing)}건 로드", flush=True)

    # 태스크: 시도 순서대로 동(동-only) × 업종어 → '동 업종어'
    tasks, seen = [], set()
    for sido in SIDO_ORDER:
        dongs = sorted({m["dong"] for m in master if m["sido"] == sido and m["dong"].endswith("동")})
        for kw in KEYWORDS:
            for dong in dongs:
                t = f"{dong} {kw}"
                if t not in seen:
                    seen.add(t)
                    tasks.append(t)
    print(f"[prescan] 총 태스크 {len(tasks)}건", flush=True)

    done = hits = skipped = blocks = 0
    t0 = time.time()
    for i, kw in enumerate(tasks, 1):
        if datetime.datetime.now() >= DEADLINE:
            print(f"[prescan] ⏹ 23:59 시간가드 도달 — 중단 ({i-1}/{len(tasks)})", flush=True)
            break
        if kw in existing:
            skipped += 1
            continue
        r = p.classify(kw)
        if "차단" in str(r.get("err", "")):
            blocks += 1
            print(f"[prescan] ⚠ 차단감지 {blocks}/{BLOCK_STOP}: {kw} ({r.get('err')})", flush=True)
            if blocks >= BLOCK_STOP:
                print("[prescan] ⏹ 연속 차단 — 자동중단(IP 보호)", flush=True)
                break
            time.sleep(30)
            continue
        blocks = 0
        cache_put(kw, r)
        existing.add(kw)
        done += 1
        if r.get("has_section"):
            hits += 1
        if done % 25 == 0:
            el = time.time() - t0
            print(f"[prescan] {i}/{len(tasks)} · 스캔 {done} · 인기글 {hits} · skip {skipped} · {el/max(done,1):.1f}s/건", flush=True)
        time.sleep(GAP)
    print(f"[prescan] ✅ 종료: 스캔 {done} · 인기글히트 {hits} · skip(캐시) {skipped}", flush=True)


if __name__ == "__main__":
    main()
