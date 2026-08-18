# -*- coding: utf-8 -*-
"""Supabase 전체 백업 — 무료 플랜은 자동 백업이 없다. 제한(402)이 걸리면 읽어올 수조차 없다.

받는 것
  · 모든 테이블 행(REST, 1000행씩 range 페이징 — PostgREST 서버 상한 때문에 limit 만으론 잘린다)
  · 로그인 계정(auth.users) — Admin API. RLS·권한의 뿌리라 이게 없으면 복구가 안 된다
  · 스토리지 파일 목록(실물은 R2 에 있음)
  · 스키마 정의(OpenAPI) — 컬럼·NOT NULL·기본값 확인용

저장: _backup/<날짜>/  (git 에는 안 올라간다)
실행: python supabase_backup.py
"""
import os
import re
import sys
import json
import pathlib
import datetime

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import requests
import truststore
truststore.inject_into_ssl()
requests.packages.urllib3.disable_warnings()

HERE = pathlib.Path(__file__).resolve().parent
for envp in (HERE / ".env", HERE.parent / ".env"):
    if envp.exists():
        for line in envp.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = re.match(r'^([A-Z_]+)\s*=\s*"?([^"\n\r]+)"?', line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip()

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
OUT = HERE.parent / "_backup" / datetime.date.today().isoformat()
OUT.mkdir(parents=True, exist_ok=True)
PAGE = 1000
total_rows = total_bytes = 0


def save(name, obj):
    p = OUT / f"{name}.json"
    p.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    return p.stat().st_size


print(f"=== Supabase 백업 → {OUT} ===", flush=True)

# ── 스키마 ────────────────────────────────────────────────────────────────
spec = requests.get(f"{URL}/rest/v1/", headers={**H, "Accept": "application/openapi+json"},
                    timeout=60).json()
save("_schema_openapi", spec)
tables = sorted(spec.get("definitions", {}).keys())
print(f"테이블 {len(tables)}개", flush=True)

# ── 테이블 행 ─────────────────────────────────────────────────────────────
manifest = {}
for t in tables:
    rows, frm = [], 0
    while True:
        r = requests.get(f"{URL}/rest/v1/{t}?select=*",
                         headers={**H, "Range-Unit": "items", "Range": f"{frm}-{frm+PAGE-1}"},
                         timeout=180)
        if r.status_code >= 400:
            print(f"  ! {t}: HTTP {r.status_code} {r.text[:80]}", flush=True)
            break
        part = r.json()
        if not isinstance(part, list):
            break
        rows += part
        if len(part) < PAGE:
            break
        frm += PAGE
    n = save(t, rows)
    manifest[t] = {"rows": len(rows), "bytes": n}
    total_rows += len(rows)
    total_bytes += n
    print(f"  {t:<34} {len(rows):>6}행  {n/1024:>9,.0f} KB", flush=True)

# ── 로그인 계정(auth.users) ───────────────────────────────────────────────
users, page = [], 1
while True:
    r = requests.get(f"{URL}/auth/v1/admin/users?page={page}&per_page=200", headers=H, timeout=60)
    if r.status_code >= 400:
        print(f"  ! auth.users: HTTP {r.status_code} {r.text[:80]}", flush=True)
        break
    j = r.json()
    part = j.get("users", j if isinstance(j, list) else [])
    users += part
    if len(part) < 200:
        break
    page += 1
n = save("_auth_users", users)
manifest["_auth_users"] = {"rows": len(users), "bytes": n}
total_rows += len(users)
total_bytes += n
print(f"  {'_auth_users':<34} {len(users):>6}행  {n/1024:>9,.0f} KB", flush=True)

# ── 스토리지 파일 목록 ────────────────────────────────────────────────────
def listing(bucket, prefix=""):
    out, off = [], 0
    while True:
        r = requests.post(f"{URL}/storage/v1/object/list/{bucket}",
                          headers={**H, "Content-Type": "application/json"}, timeout=90,
                          json={"prefix": prefix, "limit": 1000, "offset": off,
                                "sortBy": {"column": "name", "order": "asc"}})
        items = r.json()
        if not isinstance(items, list) or not items:
            break
        for it in items:
            p = prefix + it["name"]
            if it.get("metadata") is not None:
                out.append({"path": p, "size": int(it["metadata"].get("size") or 0)})
            else:
                out += listing(bucket, p + "/")
        if len(items) < 1000:
            break
        off += 1000
    return out


store = {}
for b in requests.get(f"{URL}/storage/v1/bucket", headers=H, timeout=60).json():
    name = b.get("name") or b.get("id")
    store[name] = listing(name)
save("_storage_index", store)
print(f"  {'_storage_index':<34} {sum(len(v) for v in store.values()):>6}개", flush=True)

manifest["_meta"] = {
    "at": datetime.datetime.now().isoformat(timespec="seconds"),
    "supabase_url": URL, "tables": len(tables), "total_rows": total_rows,
    "total_bytes": total_bytes,
    "note": "이미지 실물은 Cloudflare R2(ddmkt-cafe-images)에 있음 — 여기엔 목록만.",
}
save("_manifest", manifest)
print(f"\n=== 완료: {len(tables)}테이블 · {total_rows:,}행 · {total_bytes/1024/1024:,.1f} MB → {OUT} ===", flush=True)
