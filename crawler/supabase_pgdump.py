# -*- coding: utf-8 -*-
"""진짜 백업 — pg_dump(roles → schema → data). JSON 백업이 못 담는 것을 담는다.

JSON 백업(supabase_backup.py)에 없는 것
  · 테이블 정의(컬럼 타입·제약·기본값) · 인덱스 · 시퀀스 현재값
  · 트리거 · DB 함수(RPC) · **RLS 정책 212개** · DB roles/권한 · auth 스키마
  이게 없으면 자체호스팅에 '데이터만' 부어도 앱이 안 돈다.

준비: .env 또는 crawler/.env 에 아래 한 줄 추가(Supabase 대시보드 →
      Project Settings → Database → Connection string → URI, 비밀번호 포함)
  SUPABASE_DB_URL=postgresql://postgres:비밀번호@db.<ref>.supabase.co:5432/postgres

실행: python supabase_pgdump.py
결과: _backup/<날짜>/pg/  (roles.sql · schema.sql · data.sql)
"""
import os
import re
import sys
import pathlib
import datetime
import subprocess

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
for envp in (HERE / ".env", ROOT / ".env"):
    if envp.exists():
        for line in envp.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = re.match(r'^([A-Z_]+)\s*=\s*"?([^"\n\r]+)"?', line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip()

DB = os.environ.get("SUPABASE_DB_URL", "").strip()
if not DB:
    print("SUPABASE_DB_URL 이 없습니다.\n"
          "  Supabase 대시보드 → Project Settings → Database → Connection string(URI)\n"
          "  비밀번호 포함한 값을 .env 에 SUPABASE_DB_URL= 로 넣어주세요.", flush=True)
    sys.exit(1)

OUT = ROOT / "_backup" / datetime.date.today().isoformat() / "pg"
OUT.mkdir(parents=True, exist_ok=True)
NPX = "npx.cmd" if os.name == "nt" else "npx"

# 순서가 중요하다 — roles → schema → data. 뒤바뀌면 소유자/권한 오류로 복원이 깨진다.
STEPS = [
    ("roles.sql", ["--role-only"]),
    ("schema.sql", []),
    ("data.sql", ["--data-only", "--use-copy"]),
]

ok = True
for name, extra in STEPS:
    dst = OUT / name
    cmd = [NPX, "supabase", "db", "dump", "--db-url", DB, "-f", str(dst)] + extra
    print(f"■ {name} …", flush=True)
    r = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, timeout=1800)
    tail = (r.stderr or r.stdout or "").strip().splitlines()[-3:]
    size = dst.stat().st_size if dst.exists() else 0
    if r.returncode != 0 or size == 0:
        ok = False
        print(f"   ✗ 실패(exit {r.returncode}) {' / '.join(tail)}", flush=True)
    else:
        print(f"   ✓ {size/1024:,.0f} KB", flush=True)

if ok:
    # 복원에 꼭 필요한 것들이 실제로 들어갔는지 눈으로 확인 — '떴다'와 '쓸 수 있다'는 다르다.
    schema = (OUT / "schema.sql").read_text(encoding="utf-8", errors="ignore")
    checks = {
        "RLS 정책(create policy)": schema.lower().count("create policy"),
        "테이블(create table)": schema.lower().count("create table"),
        "DB 함수(create function)": schema.lower().count("create function"),
        "트리거(create trigger)": schema.lower().count("create trigger"),
        "row level security 활성": schema.lower().count("enable row level security"),
    }
    print("\n■ schema.sql 내용 점검")
    for k, v in checks.items():
        print(f"   {k:<26} {v}개  {'✓' if v else '✗ 없음!'}")
print(f"\n=== {'완료' if ok else '실패 있음'} → {OUT} ===", flush=True)
