# 지역형 접수용 '고정 행정동 마스터' 구축 — 서울/경기/인천 전체 (구/시군구, 동/읍/면).
#   소스: raqoon886/Local_HangJeongDong 행정동 GeoJSON(adm_nm). 1회 구축 후 DB(cafe_region_dong) 적재.
#   실행: py build_region_dong.py           → region_dong_master.json 생성(+DB 적재는 --db)
#         py build_region_dong.py --db      → 위 + Supabase cafe_region_dong 업서트(테이블 선행 필요)
import re
import sys
import json
import pathlib
from urllib.parse import quote
import requests

requests.packages.urllib3.disable_warnings()

BASE = "https://raw.githubusercontent.com/raqoon886/Local_HangJeongDong/master/"
FILES = {
    "서울": "hangjeongdong_서울특별시.geojson",
    "경기": "hangjeongdong_경기도.geojson",
    "인천": "hangjeongdong_인천광역시.geojson",
    # 충청권(2026-08 확장)
    "대전": "hangjeongdong_대전광역시.geojson",
    "세종": "hangjeongdong_세종특별자치시.geojson",
    "충북": "hangjeongdong_충청북도.geojson",
    "충남": "hangjeongdong_충청남도.geojson",
}
HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "region_dong_master.json"


def clean_dong(d):
    # 행정동 → 검색형 동. 역삼1동→역삼동, 목2동→목동. '가동'·읍·면·리는 그대로.
    return re.sub(r"\d+(?=동$)", "", d)


def build():
    rows = []
    for sido, fn in FILES.items():
        r = requests.get(BASE + quote(fn), timeout=60, verify=False)
        r.raise_for_status()
        names = [json.loads('"' + n + '"') for n in re.findall(r'"adm_nm"\s*:\s*"([^"]+)"', r.text)]
        seen = set()
        cnt = 0
        for nm in names:
            parts = nm.split()
            if len(parts) < 2:
                continue
            if len(parts) == 2:
                gu, dong = parts[0], clean_dong(parts[1])   # 구 없는 시(세종 등) — gu=시명
            else:
                gu, dong = parts[1], clean_dong(parts[-1])
            key = (sido, gu, dong)
            if key in seen:
                continue
            seen.add(key)
            rows.append({"sido": sido, "gu": gu, "dong": dong})
            cnt += 1
        print(f"{sido}: 행정동 {len(names)} → 유니크 {cnt}", flush=True)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"총 {len(rows)}개 → {OUT.name} 저장", flush=True)
    return rows


def upsert_db(rows):
    import os
    for envp in (HERE / ".env",):
        if envp.exists():
            for line in envp.read_text(encoding="utf-8", errors="ignore").splitlines():
                m = re.match(r'^([A-Z_]+)\s*=\s*"?([^"\n\r]+)"?', line)
                if m and m.group(1) not in os.environ:
                    os.environ[m.group(1)] = m.group(2).strip()
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_KEY"]
    H = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
         "Prefer": "resolution=merge-duplicates,return=minimal"}
    for i in range(0, len(rows), 500):
        chunk = rows[i:i + 500]
        rr = requests.post(f"{url}/rest/v1/cafe_region_dong?on_conflict=sido,gu,dong",
                           headers=H, json=chunk, timeout=30, verify=False)
        print(f"  업서트 {i}-{i+len(chunk)}: {rr.status_code} {rr.text[:120] if rr.status_code>=300 else ''}", flush=True)


if __name__ == "__main__":
    data = build()
    if "--db" in sys.argv:
        upsert_db(data)
