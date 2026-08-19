# -*- coding: utf-8 -*-
"""진짜 백업 — pg_dump 로 스키마·데이터·auth 까지. JSON 백업이 못 담는 것을 담는다.

JSON 백업(supabase_backup.py)에 없는 것
  · 테이블 정의(컬럼 타입·제약·기본값) · 인덱스 · 트리거
  · DB 함수(RPC) · **RLS 정책** · 권한(GRANT)
  · **auth 스키마 — 비밀번호 해시(encrypted_password) · 카카오 연동(auth.identities)**
  · storage 스키마 — 버킷 정의와 정책
  이게 없으면 자체호스팅에 '데이터만' 부어도 앱이 안 돈다(로그인부터 막힌다).

전제
  · PostgreSQL 클라이언트(pg_dump) 설치 — winget install PostgreSQL.PostgreSQL.17
  · .env 에 SUPABASE_DB_URL_CLOUD_FROZEN (Session pooler · 포트 5432) — 옛 클라우드 전용
      postgresql://postgres.<ref>:<pw>@aws-1-<region>.pooler.supabase.com:5432/postgres
    ⚠ Direct connection(db.<ref>.supabase.co)은 IPv6 전용이라 IPv4 회선에서 못 쓴다.
    ⚠ Transaction pooler(6543)는 pg_dump 가 안 된다.

실행: python supabase_pgdump.py
결과: _backup/<날짜>/pg/
"""
import os
import re
import sys
import glob
import pathlib
import datetime
import subprocess
import urllib.parse as up

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
for envp in (HERE / ".env", ROOT / ".env"):
    if envp.exists():
        for line in envp.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = re.match(r'^([A-Z_]+)\s*=\s*"?([^"\n\r]+)"?', line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip()

# ⚠ 이 스크립트가 뜨는 것은 **얼어붙은 옛 클라우드**다(2026-08-19 컷오버).
#   라이브(자체호스팅) 백업은 selfhost_backup.py 가 맡는다. 헷갈리지 않게 변수명 자체를 분리했다.
DB = os.environ.get("SUPABASE_DB_URL_CLOUD_FROZEN", "").strip()
if not DB:
    print("SUPABASE_DB_URL_CLOUD_FROZEN 이 없습니다(.env). 옛 클라우드를 뜨려면 그 값을 넣으세요.", flush=True)
    sys.exit(1)
u = up.urlparse(DB)
PW = up.unquote(u.password or "")


def find_pg_dump():
    if os.name == "nt":
        cands = sorted(glob.glob(r"C:\Program Files\PostgreSQL\*\bin\pg_dump.exe"), reverse=True)
        if cands:
            return cands[0]
    from shutil import which
    return which("pg_dump") or "pg_dump"


PGDUMP = find_pg_dump()
OUT = ROOT / "_backup" / datetime.date.today().isoformat() / "pg"
OUT.mkdir(parents=True, exist_ok=True)

# 순서가 중요하다 — 스키마 먼저, 데이터 나중. 복원도 이 순서로 한다.
#   public  = 우리 테이블·함수·RLS
#   auth    = 로그인 계정과 비밀번호 해시(★ 이게 빠지면 전원 로그인 불가)
#   storage = 버킷 정의와 정책
STEPS = [
    ("schema_public.sql", ["--schema-only", "--schema=public"]),
    ("schema_auth_storage.sql", ["--schema-only", "--schema=auth", "--schema=storage"]),
    ("data_public.sql", ["--data-only", "--schema=public"]),
    ("data_auth_storage.sql", ["--data-only", "--schema=auth", "--schema=storage"]),
]

env = {**os.environ, "PGPASSWORD": PW, "PGCONNECT_TIMEOUT": "30"}
base = [PGDUMP, "-h", u.hostname, "-p", str(u.port or 5432), "-U", u.username,
        "-d", (u.path or "/postgres").lstrip("/"), "--no-owner", "--quote-all-identifiers"]

print(f"=== pg_dump {PGDUMP}", flush=True)
print(f"=== → {OUT}", flush=True)
ok = True
for name, extra in STEPS:
    dst = OUT / name
    print(f"■ {name} …", flush=True)
    r = subprocess.run(base + extra + ["-f", str(dst)], env=env,
                       capture_output=True, text=True, timeout=3600)
    size = dst.stat().st_size if dst.exists() else 0
    if r.returncode != 0 or size == 0:
        ok = False
        tail = (r.stderr or r.stdout or "").strip().splitlines()[-3:]
        print(f"   ✗ 실패(exit {r.returncode}) {' / '.join(tail)}", flush=True)
    else:
        print(f"   ✓ {size/1024:,.0f} KB", flush=True)

# ── 내용 점검 — '떴다'와 '복구된다'는 다르다 ────────────────────────────────
print("\n■ 내용 점검(복원에 꼭 필요한 것들이 실제로 들어갔나)")


def count(fname, needle):
    p = OUT / fname
    if not p.exists():
        return 0
    return p.read_text(encoding="utf-8", errors="ignore").lower().count(needle)


checks = [
    ("테이블 정의", "schema_public.sql", "create table"),
    ("인덱스", "schema_public.sql", "create index"),
    ("DB 함수(RPC)", "schema_public.sql", "create function"),
    ("트리거", "schema_public.sql", "create trigger"),
    ("RLS 정책", "schema_public.sql", "create policy"),
    ("RLS 활성화", "schema_public.sql", "enable row level security"),
    ("★ 비밀번호 해시", "data_auth_storage.sql", "encrypted_password"),
    ("★ OAuth 연동(identities)", "data_auth_storage.sql", "identities"),
    ("스토리지 버킷", "schema_auth_storage.sql", "buckets"),
]
missing = []
for label, f, needle in checks:
    n = count(f, needle)
    print(f"   {label:<24} {n:>5}  {'✓' if n else '✗ 없음!'}")
    if not n:
        missing.append(label)

total = sum((OUT / n).stat().st_size for n, _ in STEPS if (OUT / n).exists())
print(f"\n=== {'완료' if ok and not missing else '⚠ 확인 필요'} · 합계 {total/1024/1024:,.1f} MB → {OUT} ===", flush=True)
if missing:
    print("   빠진 항목:", ", ".join(missing), flush=True)
if not ok or missing:
    sys.exit(1)
