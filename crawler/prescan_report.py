# prescan 결과 보기 — cafe_kw_targets 에서 '동 업종키워드' 집계(업종별/업체별 인기글 진입 현황).
#   실행: py prescan_report.py            (요약)
#         py prescan_report.py 입주청소    (그 업종어의 진입 동 전체 나열)
import os
import re
import sys
import json
import pathlib
from urllib.parse import quote
import requests

requests.packages.urllib3.disable_warnings()
HERE = pathlib.Path(__file__).resolve().parent
for envp in (HERE / ".env",):
    if envp.exists():
        for line in envp.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = re.match(r'^([A-Z_]+)\s*=\s*"?([^"\n\r]+)"?', line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip()
SB = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY") or ""
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

# prescan_region 과 동일 업종어·지역토큰 규칙 재사용(동기화).
from prescan_region import COMPANIES, KEYWORDS, region_tokens  # noqa: E402
BY_KW = {kw: [c for c, ks in COMPANIES.items() if kw in ks] for kw in KEYWORDS}


def fetch_all():
    rows, off = [], 0
    while True:
        r = requests.get(f"{SB}/rest/v1/cafe_kw_targets",
                         headers=H, params={"select": "keyword,has_section,cafes,verdict", "limit": "1000", "offset": str(off)},
                         timeout=30, verify=False)
        b = r.json()
        if not isinstance(b, list) or not b:
            break
        rows += b
        if len(b) < 1000:
            break
        off += 1000
    return rows


def main():
    master = json.loads((HERE / "region_dong_master.json").read_text(encoding="utf-8"))
    # 구/시 토큰 집합(prescan 이 실제 쓰는 지역 축). 동 아님 — 그래서 구/시 결과가 0으로 나오던 버그 수정.
    region_toks = set()
    for m in master:
        region_toks |= region_tokens(m["gu"])
    rows = fetch_all()
    # 업종어별 버킷: '구/시 업종어' 형태 & 지역토큰이 마스터에 있는 것만
    buckets = {kw: [] for kw in KEYWORDS}
    for x in rows:
        k = (x.get("keyword") or "").strip()
        parts = k.split()
        if len(parts) < 2:
            continue
        tail = " ".join(parts[1:])
        head = parts[0]
        if tail in buckets and head in region_toks:
            buckets[tail].append(x)

    detail = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in KEYWORDS else None
    print("=== prescan 결과 요약 (cafe_kw_targets 기준) ===", flush=True)
    print(f"{'업종어':10} {'업체':12} {'스캔동':>6} {'인기글진입':>8} {'카페진입':>7}", flush=True)
    for kw in KEYWORDS:
        rs = buckets[kw]
        hit = [x for x in rs if x.get("has_section")]
        cafe = [x for x in rs if (x.get("cafes") or [])]
        comps = "·".join(BY_KW[kw])
        print(f"{kw:10} {comps:12} {len(rs):>6} {len(hit):>8} {len(cafe):>7}", flush=True)
    if detail:
        rs = sorted(buckets[detail], key=lambda x: -len(x.get("cafes") or []))
        print(f"\n=== '{detail}' 인기글 진입 동 (카페수 많은 순) ===", flush=True)
        for x in rs:
            if x.get("has_section"):
                print(f"  {x['keyword']:22} 카페{len(x.get('cafes') or []):>2} · {x.get('verdict')}", flush=True)
    else:
        print("\n특정 업종 상세: py prescan_report.py 입주청소", flush=True)


if __name__ == "__main__":
    main()
