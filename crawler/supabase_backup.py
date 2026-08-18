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
failed = []
for t in tables:
    # 서버가 아는 실제 행수 — 다 받았는지 대조할 유일한 근거(조용한 절단·누락 검출).
    server_n = None
    try:
        h = requests.get(f"{URL}/rest/v1/{t}?select=*&limit=1",
                         headers={**H, "Prefer": "count=exact"}, timeout=120)
        cr = h.headers.get("content-range", "")
        if "/" in cr and cr.split("/")[-1].isdigit():
            server_n = int(cr.split("/")[-1])
    except Exception:
        pass

    rows, frm, err = [], 0, None
    page = PAGE
    while True:
        # ★ order 없는 Range 페이징은 안 된다 — Postgres 는 LIMIT/OFFSET 순서를 보장하지 않고,
        #   백업 중 UPDATE 가 일어나면 행이 힙의 다른 위치로 옮겨가 페이지 사이에서 빠지거나 겹친다.
        #   (cafe_kw_targets 는 26,590행 27페이지인데 워커가 계속 scanned_at 을 갱신한다.)
        r = requests.get(f"{URL}/rest/v1/{t}?select=*&order=id",
                         headers={**H, "Range-Unit": "items", "Range": f"{frm}-{frm+page-1}"},
                         timeout=300)
        if r.status_code == 400 and "column" in (r.text or "") and "id" in (r.text or ""):
            r = requests.get(f"{URL}/rest/v1/{t}?select=*",   # id 컬럼이 없는 테이블 폴백
                             headers={**H, "Range-Unit": "items", "Range": f"{frm}-{frm+page-1}"},
                             timeout=300)
        if r.status_code >= 400:
            # ★ 큰 행(base64 이미지 등)은 statement timeout(57014)으로 500 이 난다.
            #   실측 2026-08-18: banner_outputs(행당 2.08MB) · blog_save_queue(행당 4.12MB) 가
            #   0행으로 저장돼 '빈 테이블'과 구분이 안 됐다. 페이지를 줄여 다시 시도한다.
            if page > 1:
                page = max(1, page // 10)
                print(f"    {t}: HTTP {r.status_code} → 페이지 {page} 로 낮춰 재시도", flush=True)
                continue
            err = f"HTTP {r.status_code} {r.text[:120]}"
            print(f"  ! {t}: {err}", flush=True)
            break
        part = r.json()
        if not isinstance(part, list):
            err = f"예상 밖 응답: {str(part)[:120]}"
            break
        rows += part
        if len(part) < page:
            break
        frm += page
    n = save(t, rows)
    # 서버 행수와 다르면 '성공'으로 기록하지 않는다 — 조용한 거짓 성공이 가장 위험하다.
    ok = err is None and (server_n is None or len(rows) >= server_n)
    manifest[t] = {"rows": len(rows), "server_count": server_n, "ok": ok, "bytes": n}
    if err:
        manifest[t]["error"] = err
    if not ok:
        failed.append(t)
    total_rows += len(rows)
    total_bytes += n
    mark = "" if ok else f"  ⚠ 서버 {server_n}행"
    print(f"  {t:<34} {len(rows):>6}행  {n/1024:>9,.0f} KB{mark}", flush=True)

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
if failed:
    sys.exit(1)          # 예약작업이 실패를 알 수 있게 — 항상 0 으로 끝나면 실패가 묻힌다
