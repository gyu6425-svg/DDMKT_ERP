# -*- coding: utf-8 -*-
"""Cloudflare R2 이미지 백업 — 이미지 실물은 R2 에만 있다(Supabase 원본은 삭제됨).

왜: Supabase 백업(pg_dump/JSON)에는 이미지 바이너리가 없다. R2 는 Supabase 와 무관한
    별개의 단일장애점이라, Cloudflare 계정 사고 = 이미지 전량 소실이다.
방법: DB 백업에서 뽑은 키 목록(_r2_keys.txt)을 /api/img 로 받아 로컬에 그대로 저장.
      x-img-src 헤더로 R2 에서 나온 것인지 확인하고, 이미 받은 건 건너뛴다(재실행 안전).
실행: python r2_backup.py [키목록파일]
결과: _backup/<날짜>/r2/<prefix>/<path>
"""
import os
import sys
import json
import pathlib
import datetime
import concurrent.futures as cf

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import requests
requests.packages.urllib3.disable_warnings()

ROOT = pathlib.Path(__file__).resolve().parent.parent
DAY = datetime.date.today().isoformat()
KEYS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_backup" / DAY / "_r2_keys.txt"
OUT = ROOT / "_backup" / DAY / "r2"
SITE = "https://ddmkt-erp.pages.dev"

if not KEYS.exists():
    print(f"키 목록이 없습니다: {KEYS}", flush=True)
    sys.exit(1)
keys = [k.strip() for k in KEYS.read_text(encoding="utf-8").splitlines() if k.strip()]
print(f"=== R2 백업 {len(keys)}개 → {OUT} ===", flush=True)


def one(key):
    dst = OUT / key
    if dst.exists() and dst.stat().st_size > 0:
        return key, "이미받음", dst.stat().st_size
    url = f"{SITE}/api/img/" + "/".join(requests.utils.quote(s, safe="") for s in key.split("/"))
    try:
        r = requests.get(url, timeout=90, verify=False, allow_redirects=False)
    except Exception as e:
        return key, f"오류 {type(e).__name__}", 0
    if r.status_code != 200 or not r.content:
        return key, f"실패 {r.status_code}", 0
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(r.content)
    return key, ("ok" if r.headers.get("x-img-src") == "r2" else "ok(폴백)"), len(r.content)


done = {}
total = 0
with cf.ThreadPoolExecutor(max_workers=10) as ex:
    for i, (k, st, n) in enumerate(ex.map(one, keys), 1):
        done[st] = done.get(st, 0) + 1
        total += n
        if i % 300 == 0:
            print(f"   {i}/{len(keys)} · {total/1024/1024:,.0f} MB", flush=True)
print("  결과:", done)
fails = [k for k in keys if not (OUT / k).exists()]
(ROOT / "_backup" / DAY / "_r2_backup_report.json").write_text(
    json.dumps({"at": datetime.datetime.now().isoformat(timespec="seconds"),
                "keys": len(keys), "bytes": total, "missing": fails}, ensure_ascii=False),
    encoding="utf-8")
print(f"\n=== 완료: {len(keys)-len(fails)}/{len(keys)}개 · {total/1024/1024:,.1f} MB ===", flush=True)
if fails:
    print(f"   ⚠ 못 받은 것 {len(fails)}개:", fails[:5], flush=True)
    sys.exit(1)
