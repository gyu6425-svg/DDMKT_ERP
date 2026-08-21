# -*- coding: utf-8 -*-
"""자체호스팅 Supabase 백업 — 2026-08-19 컷오버 이후 유일한 백업 수단.

왜 새로 만드나
  클라우드일 때는 Supabase 가 알아서 백업했다. 자체호스팅은 **우리가 안 하면 백업이 없다.**
  기존 supabase_backup.py / supabase_pgdump.py 는 SUPABASE_DB_URL(=클라우드)을 본다.

무엇을 담나
  pg_dump 커스텀 포맷(-Fc) 전체 덤프 하나. public 뿐 아니라 **auth(비밀번호 해시·카카오 연동)·
  storage(버킷 정의)·RLS 정책·함수·인덱스·트리거**까지 들어간다. 이거 하나면 통째로 되살린다.
  사람이 눈으로 비교할 수 있게 스키마만 뽑은 평문 SQL 도 함께 남긴다.

왜 VM 안에서 뜨나
  · 네트워크를 안 탄다(71MB 를 터널로 끌지 않는다) · main PC 에 pg_dump 설치가 필요 없다
  · DB 비밀번호가 main PC .env 에 남지 않는다(컨테이너 안에서는 peer 인증)

어디에 남기나  ── 두 곳에 둔다. 한 곳이 죽어도 살아남게. **양쪽 다 gpg AES-256 으로 잠근다.**
  · VM     ~/backups/<날짜>/          (최근 SELF_KEEP 일)
  · main   _backup/selfhost/<날짜>/   (최근 MAIN_KEEP 일 + 일요일분은 계속)

검증 — "떴다"와 "되살릴 수 있다"는 다르다. 그래서 매번 세 가지를 확인한다.
  ① sha256 이 VM 과 main 에서 같은가(전송 중 깨짐)  ※ 암호화된 파일 기준
  ② 복호화가 되는가 + pg_restore -l 로 목차가 읽히는가(잠긴 쓰레기가 아닌지)
  ③ 임시 DB 에 **데이터까지** 실제로 복원해 테이블·RLS·auth.users·비번해시·주요 행수가 맞는가
  하나라도 실패하면 종료코드 1 — 예약작업 기록에 실패로 남는다.

실행:  python selfhost_backup.py
"""
import datetime
import hashlib
import os
import pathlib
import shutil
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
VM = os.environ.get("DDMKT_VM", "ddmkt@192.168.0.179")
KEY = os.path.expanduser(os.environ.get("DDMKT_VM_KEY", "~/.ssh/ddmkt_vm"))
CT = "supabase-db"                     # DB 컨테이너 이름
SELF_KEEP = 7                          # VM 보관 일수
MAIN_KEEP = 30                         # main PC 보관 일수(일요일분은 예외로 계속 보관)

DAY = datetime.date.today().isoformat()
OUT = ROOT / "_backup" / "selfhost" / DAY
LOGP = HERE / "selfhost_backup.log"
fails = []


def log(msg):
    line = f"{datetime.datetime.now():%m-%d %H:%M:%S}  {msg}"
    print(line, flush=True)
    with open(LOGP, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def _install_excepthook():
    """예상 못 한 예외로 죽을 때도 사람에게 알린다.

    ★ 왜: 이 스크립트는 모듈 레벨 실행이라 try/except 로 전체를 감쌀 곳이 없다.
      ssh() 의 subprocess timeout 이 터지면 TimeoutExpired 가 어디에도 안 잡혀
      traceback 만 남기고 죽는다 — 03:30 무인 실행에서는 아무도 모른다(독립검증 지적).
      알림 자체가 다시 죽지 않도록 훅 안에서도 전부 감싼다."""
    import traceback

    def hook(exc_type, exc, tb):
        try:
            head = "".join(traceback.format_exception_only(exc_type, exc)).strip()
            log(f"❌ 예기치 않은 종료: {head}")
            notify_failure([f"예기치 않은 종료: {head}",
                            "백업이 완료되지 않았습니다. 옛 백업은 그대로 있습니다."])
        except Exception:
            pass
        sys.__excepthook__(exc_type, exc, tb)

    sys.excepthook = hook


def notify_failure(reasons):
    """백업 실패를 사람에게 밀어 보낸다.

    ★ 왜 필요한가: 이 작업은 03:30 에 무인으로 돈다. 실패해도 남는 곳이 작업 스케줄러의
      LastTaskResult 뿐이라 아무도 안 본다 — 조용히 30일이 흐를 수 있다(2026-08-20 독립검증 지적).
      백업은 '없다는 걸 알게 되는 순간' 이 하필 복구가 급한 때라, 실패는 반드시 밀어야 한다.
    메일이 안 되면 윈도우 알림이라도 띄운다. 알림 실패가 백업 스크립트를 죽이지는 않는다."""
    body = ("자체호스팅 백업이 실패했습니다.\n\n  " + "\n  ".join(reasons) +
            f"\n\n로그: {LOGP}\n"
            "옛 백업은 지우지 않았습니다(실패한 날의 옛 백업이 유일한 사본일 수 있어서).\n"
            "복구 절차: docs/백업-복구절차.md\n")
    # ⚠️ 예전엔 여기서 VM 에 ssh 해 SMTP_PASS 를 읽었다. 그런데 백업이 실패하는 가장 흔한 이유가
    #   바로 'VM 이 죽었다' 라, 알려야 할 때 알릴 수단이 같이 죽는 구조였다(독립검증 지적).
    #   notify_mail 은 비밀번호를 로컬에 캐시하고 예외도 안 던진다.
    try:
        import notify_mail
        if notify_mail.send("⛔ [DDMKT] 백업 실패", body):
            log("  실패 알림 메일 발송")
            return
        log("  실패 알림 메일 실패 — 윈도우 알림으로 대체")
    except Exception as exc:
        log(f"  실패 알림 메일 실패({type(exc).__name__}) — 윈도우 알림으로 대체")
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, body, "⛔ DDMKT 백업 실패", 0x10 | 0x1000)
    except Exception:
        pass


# 훅 설치 — notify_failure 가 정의된 뒤여야 한다(훅이 그걸 부른다).
_install_excepthook()


def ssh(cmd, timeout=900):
    """VM 에서 셸 명령 실행. (rc, stdout, stderr)

    ⚠ stdin=DEVNULL 은 필수다. 안 주면 부모의 stdin 을 물려받는데, 예약작업에는 콘솔이 없어
      ssh 가 입력을 기다리며 영원히 멈춘다(실측 2026-08-19: 손으로 돌리면 되는데 예약작업만 Running 고착).
      -n 도 같은 목적이라 함께 준다."""
    p = subprocess.run(["ssh", "-n", "-i", KEY, "-o", "BatchMode=yes", "-o", "ServerAliveInterval=30", VM, cmd],
                       stdin=subprocess.DEVNULL, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=timeout)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def psql(query, db="postgres"):
    """DB 에 한 줄 질의. ⚠ SQL 은 ssh → sh → docker → psql 로 네 겹을 지나므로 따옴표를 인라인으로
       넘기면 반드시 깨진다(실측: 빈 문자열이 돌아와 검증이 거짓 실패). 파일로 넘긴다."""
    p = subprocess.run(
        ["ssh", "-i", KEY, "-o", "BatchMode=yes", VM,
         f"docker exec -i {CT} psql -U postgres -d {db} -tA -f -"],
        input=query, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
    return p.stdout.strip() if p.returncode == 0 else None


log("=" * 62)
log(f"자체호스팅 백업 시작 — {DAY}")

# ── ① VM 안에서 덤프 → 즉시 암호화 ──────────────────────────────
#   ★ 평문 덤프는 VM 밖으로 나가지 않는다. 만든 자리에서 바로 잠그고, 잠긴 것만 전송한다.
#     백업에는 비밀번호 해시 100개·고객 네이버 계정 비밀번호·개인정보가 들어 있다.
#     디스크 미암호화 PC 에 평문으로 1.4GB 쌓아두는 것이 지금까지의 가장 큰 노출이었다.
#   암호는 VM 의 ~/.backup-pass (600) 에 있다 — 백업 파일과 다른 곳에 둔다.
#     ⚠ 이 PC 를 통째로 도난당하면 SSH 키로 VM 에 붙을 수 있으므로, 로컬 도난까지 막으려면
#       디스크 암호화(BitLocker)가 함께 있어야 한다. 암호화만으로 다 막힌다고 착각하지 말 것.
#   gpg 대칭키(AES-256)를 쓰는 이유: 우리 스크립트가 없어져도 사람이
#     `gpg --decrypt` 한 줄로 열 수 있다. 복구 수단이 특정 코드에 묶이면 안 된다.
base = f"ddmkt-{DAY}"
rc, out, err = ssh(f"""set -e
test -s ~/.backup-pass || {{ echo 'NO_PASSPHRASE'; exit 9; }}
mkdir -p ~/backups/{DAY}
docker exec {CT} sh -c 'pg_dump -U postgres -d postgres -Fc --no-owner --no-privileges -f /tmp/{base}.dump'
docker exec {CT} sh -c 'pg_dump -U postgres -d postgres --schema-only --no-owner --no-privileges -f /tmp/{base}.schema.sql'
docker cp {CT}:/tmp/{base}.dump      ~/backups/{DAY}/{base}.dump
docker cp {CT}:/tmp/{base}.schema.sql ~/backups/{DAY}/{base}.schema.sql
docker exec {CT} sh -c 'rm -f /tmp/{base}.dump /tmp/{base}.schema.sql'
gzip -f ~/backups/{DAY}/{base}.schema.sql
cd ~/backups/{DAY}
> SHA256
for f in {base}.dump {base}.schema.sql.gz; do
  # ★ 평문 지문은 **지우기 전에** 뜬다. 암호화한 뒤 복호화해서 뜨면 자기참조라,
  #   암호화 도중 잘리거나 깨져도 그 손상본의 해시가 그대로 '정상' 으로 기록된다
  #   (2026-08-20 독립검증 지적 — 원래 그렇게 돼 있었다).
  PLAIN=$(sha256sum "$f" | cut -d' ' -f1)

  gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \\
      --passphrase-file ~/.backup-pass -o "$f.gpg" "$f"
  test -s "$f.gpg"

  # ★ 왕복 확인: 방금 잠근 것을 풀어 원본과 같은지 본다. 여기서 같아야만 평문을 지운다.
  #   `set -e` 는 파이프라인 끝(cut)의 종료코드만 보므로 gpg 실패를 놓친다(실측) →
  #   중간 파일로 받아 종료코드를 직접 확인한다.
  gpg --batch --quiet --decrypt --passphrase-file ~/.backup-pass -o "$f.rt" "$f.gpg"
  RT=$(sha256sum "$f.rt" | cut -d' ' -f1)
  rm -f "$f.rt"
  if [ "$PLAIN" != "$RT" ]; then
    echo "ROUNDTRIP_MISMATCH $f"; exit 8
  fi

  rm -f "$f"                      # 왕복이 맞을 때만 평문 제거
  sha256sum "$f.gpg" >> SHA256    # 암호문 해시 — 전송이 깨졌는지(scp 바이트 동일성)
  # 평문 해시 — 진짜 '내용' 지문. gpg 대칭암호는 매번 난수 솔트를 써서 다시 잠그면
  #   암호문 해시가 달라진다. 암호문 해시만 적어두면 재암호화한 사본을 '손상' 으로 오판한다
  #   (QA 실측: 멀쩡한 백업이 FAILED 로 나왔다).
  echo "$PLAIN  $f  (평문)" >> SHA256
done
stat -c '%n %s' *""")
if rc == 9 or "NO_PASSPHRASE" in (out or "") + (err or ""):
    log("❌ VM 에 ~/.backup-pass 가 없습니다 — 암호 없이는 백업하지 않습니다")
    notify_failure(["VM 에 ~/.backup-pass 없음"])
    sys.exit(1)
if rc == 8 or "ROUNDTRIP_MISMATCH" in (out or ""):
    # 암호화한 것을 풀었더니 원본과 다르다 = 잠긴 쓰레기. 평문은 아직 안 지웠다.
    log(f"❌ 암호화 왕복 불일치 — 평문은 보존했습니다: {out[:200]}")
    notify_failure(["암호화 왕복 불일치(잠근 파일이 원본과 다름)"])
    sys.exit(1)
if rc != 0:
    # ★ 여기가 가장 흔한 실패다(VM 다운·docker 이상·pg_dump 오류). 예전엔 로그만 남기고 끝나
    #   03:30 무인 실행에서 아무도 몰랐다. 반드시 밀어 보낸다.
    log(f"❌ 덤프 실패: {err[:300]}")
    notify_failure([f"덤프 실패(rc={rc}) — VM/도커/pg_dump 확인", (err or "")[:200]])
    sys.exit(1)
for line in out.splitlines():
    log(f"  생성  {line}")
vm_sha = {}
rc, shaout, _ = ssh(f"cat ~/backups/{DAY}/SHA256")
for line in shaout.splitlines():
    if "(평문)" in line:          # 평문 지문은 전송 대조 대상이 아니다(파일로 존재하지 않는다)
        continue
    h, _, n = line.partition("  ")
    if h.strip() and n.strip():
        vm_sha[n.strip()] = h.strip()

# ── ② main PC 로 가져오기 ───────────────────────────────────────
OUT.mkdir(parents=True, exist_ok=True)
p = subprocess.run(["scp", "-i", KEY, "-o", "BatchMode=yes", "-q",
                    f"{VM}:~/backups/{DAY}/*", str(OUT)],
                   stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800)
if p.returncode != 0:
    # 덤프는 됐는데 이 PC 로 못 가져온 경우 — VM 에는 사본이 남지만 로컬엔 없다. 알려야 한다.
    log(f"❌ 전송 실패: {p.stderr[:300]}")
    notify_failure([f"scp 전송 실패(rc={p.returncode}) — 네트워크/VM 확인", (p.stderr or "")[:200]])
    sys.exit(1)

# ── 검증 ① sha256 대조 ─────────────────────────────────────────
for name, want in vm_sha.items():
    f = OUT / name
    if not f.exists():
        fails.append(f"{name} 전송 안 됨")
        continue
    h = hashlib.sha256()
    with open(f, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    got = h.hexdigest()
    ok = got == want
    log(f"  sha256 {'일치 ✅' if ok else '불일치 ❌'}  {name}  ({f.stat().st_size:,} bytes)")
    if not ok:
        fails.append(f"{name} sha256 불일치")

# ── 검증 ② 덤프 목차가 읽히는가 ─────────────────────────────────
#   ★ 복호화부터 한다 — 이 한 줄 덕분에 '암호가 실제로 풀린다'가 매일 밤 증명된다.
#     암호화한 백업은 복호화를 안 해보면 잠긴 쓰레기인지 알 수가 없고, 알게 되는 시점이
#     하필 복구가 급한 때다. 그래서 검증을 복호화에서 시작한다.
rc, toc, err = ssh(f"set -e\n"
                   f"gpg --batch --yes --quiet --decrypt --passphrase-file ~/.backup-pass "
                   f"-o /tmp/v.dump ~/backups/{DAY}/{base}.dump.gpg\n"
                   f"test -s /tmp/v.dump\n"
                   f"docker cp /tmp/v.dump {CT}:/tmp/v.dump >/dev/null\n"
                   f"rm -f /tmp/v.dump\n"
                   f"docker exec {CT} sh -c 'pg_restore -l /tmp/v.dump | grep -c \"^[0-9]\"'")
if rc != 0:
    log(f"❌ 복호화 실패 — 백업을 열 수 없습니다: {err[:200]}")
    fails.append("복호화 실패")
n_toc = int(toc) if rc == 0 and toc.isdigit() else -1
log(f"  목차 항목 {n_toc}개  {'✅' if n_toc > 100 else '❌ 너무 적음'}")
if n_toc <= 100:
    fails.append(f"pg_restore 목차 {n_toc}개")

# ── 검증 ③ 임시 DB 에 실제로 복원해 본다 ────────────────────────
#   ★ 스키마만 복원해 보는 것으로는 부족하다 — 표가 제대로 서는 것과 그 안에 데이터가 있는 것은
#     다른 문제다. 특히 auth.users 의 비밀번호 해시가 빠지면 백업이 있어도 아무도 로그인 못 한다.
#     그래서 **데이터까지 통째로** 복원해 살아있는 DB 와 행수를 맞춰 본다(71MB 라 20초면 끝난다).
COUNTS = """select (select count(*) from pg_tables where schemaname='public')::text
  || '|' || (select count(*) from pg_policies where schemaname='public')::text
  || '|' || (select count(*) from auth.users)::text
  || '|' || (select count(*) from auth.users where coalesce(encrypted_password,'') <> '')::text
  || '|' || (select count(*) from public.profiles)::text
  || '|' || (select count(*) from public.cafe_kw_targets)::text
  || '|' || (select count(*) from public.blog_posts)::text"""
LBL = ["테이블", "RLS", "auth.users", "비번해시", "profiles", "cafe_kw_targets", "blog_posts"]
live = (psql(COUNTS) or "").split("|")

psql("drop database if exists bkverify;")
psql("create database bkverify;")
# 역할·확장 관련 잡음은 무시(--no-owner). 데이터가 들어갔는지는 아래 행수로 판정한다.
ssh(f"docker exec {CT} pg_restore -U postgres -d bkverify --no-owner --no-privileges /tmp/v.dump || true", timeout=1800)
got = (psql(COUNTS, db="bkverify") or "").split("|")

ok3 = len(got) == len(live) == len(LBL) and got == live
log("  전체복원 검증 " + ("✅" if ok3 else "❌"))
for i, name in enumerate(LBL):
    a = live[i] if i < len(live) else "?"
    b = got[i] if i < len(got) else "?"
    log(f"      {name:<18} 살아있는DB {a:>7}  /  백업복원 {b:>7}  {'✅' if a == b else '❌'}")
if not ok3:
    fails.append("전체복원 행수 불일치")
ssh(f"docker exec {CT} sh -c 'psql -U postgres -d postgres -c \"drop database if exists bkverify\" >/dev/null 2>&1; rm -f /tmp/v.dump'")

# ── 검증에 실패했으면 여기서 끝낸다 — 정리보다 먼저 ──────────────
#   ★ 순서가 핵심이다. 예전엔 fails 판정이 정리 코드 뒤에 있어서, **오늘 백업이 깨져도
#     어제 것을 지웠다.** 실패가 7일 이어지면 VM 사본이 전멸한다.
#     백업이 실패한 날은 옛 백업이 유일한 생명줄이므로, 그때야말로 아무것도 지우면 안 된다.
#     (2026-08-20 독립검증 지적)
if fails:
    log("❌ 백업 실패 — " + " / ".join(fails))
    log("   ⚠ 옛 백업은 지우지 않았습니다(실패한 날의 옛 백업이 유일한 사본일 수 있습니다)")
    notify_failure(fails)
    sys.exit(1)

# ── 오래된 백업 정리 ────────────────────────────────────────────
ssh(f"cd ~/backups && ls -1d 20* 2>/dev/null | sort | head -n -{SELF_KEEP} | xargs -r rm -rf")
rc, left, _ = ssh("ls -1d ~/backups/20* 2>/dev/null | wc -l")
log(f"  VM 보관 {left.strip()}일분(최근 {SELF_KEEP}일 유지)")

root = ROOT / "_backup" / "selfhost"
cutoff = datetime.date.today() - datetime.timedelta(days=MAIN_KEEP)
removed = 0
for d in sorted(root.glob("20*")):
    try:
        dt = datetime.date.fromisoformat(d.name)
    except ValueError:
        continue
    if dt < cutoff and dt.weekday() != 6:      # 일요일(6)분은 오래돼도 남긴다
        shutil.rmtree(d, ignore_errors=True)
        removed += 1
kept = len(list(root.glob("20*")))
log(f"  main 보관 {kept}일분(최근 {MAIN_KEEP}일 + 일요일분, {removed}개 정리)")

log(f"✅ 백업 정상 — {OUT}")
