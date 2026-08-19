# -*- coding: utf-8 -*-
"""자체호스팅 감시 — 컷오버(2026-08-19) 이후 아무도 안 지키던 자리를 메운다.

왜 새로 만드나
  옛 supabase_guard 는 '클라우드 402(한도초과)'만 보는 물건이었다. 자체호스팅에는 402 가 없다.
  돌고는 있었지만 사실상 아무것도 안 지키고 있었다.
  더 중요한 차이 — 클라우드는 죽으면 Supabase 가 알려줬다. **자체호스팅은 우리가 안 보면 아무도 안 알려준다.**

무엇을 보나 (하나라도 무너지면 ERP·크롤·발행이 동시에 죽는 것들)
  ① 터널      db.ddmktcloud.com 이 밖에서 응답하는가 — 여기가 끊기면 전 PC 와 웹이 동시에 멈춘다
  ② 컨테이너   supabase-* 가 전부 살아있고 healthy 인가
  ③ 디스크    VM 여유. 차면 Postgres 가 쓰기를 멈춘다(조용히 죽는 유형이라 미리 봐야 한다)
  ④ 백업      최신 백업이 어제 것인가 — 예약작업이 조용히 멈춰도 여기서 잡힌다
  ⑤ DB 크기   급증 감지(참고값, 알림 조건은 아님)

설계 원칙
  · 감시 대상에 기대지 않는다 — 로그·윈도우 알림만 쓴다. DB 에 남기면 DB 가 죽을 때 알림도 같이 죽는다.
  · 상태가 바뀔 때만 알린다. 같은 경고를 매번 띄우면 사람이 무시하게 된다.
  · 일시적 네트워크 오류로 깨우지 않는다 — 연속 3회일 때만 상태로 인정한다.

실행:  python selfhost_guard.py              (기본 5분 간격)
       python selfhost_guard.py --once       (1회 점검)
       python selfhost_guard.py --sec 600
"""
import datetime
import os
import pathlib
import re
import subprocess
import sys
import threading
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import requests
import truststore

truststore.inject_into_ssl()
requests.packages.urllib3.disable_warnings()

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
for envp in (HERE / ".env", ROOT / ".env"):
    if envp.exists():
        for line in envp.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = re.match(r'^([A-Z_]+)\s*=\s*"?([^"\n\r]+)"?', line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip()

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY") or ""
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

VM = os.environ.get("DDMKT_VM", "ddmkt@192.168.0.179")
SSH_KEY = os.path.expanduser(os.environ.get("DDMKT_VM_KEY", "~/.ssh/ddmkt_vm"))
LOG = HERE / "selfhost_guard.log"
STATE = HERE / "selfhost_guard.state"
BACKUP_DIR = ROOT / "_backup" / "selfhost"

DISK_WARN = 85          # % — 넘으면 경고
DISK_CRIT = 93          # % — 넘으면 위험(곧 쓰기 실패)
BACKUP_STALE_H = 36     # 시간 — 최신 백업이 이보다 오래되면 경고(매일 03:30 이므로 여유 포함)

INTERVAL = 300
for i, a in enumerate(sys.argv):
    if a == "--sec" and i + 1 < len(sys.argv):
        INTERVAL = max(60, int(sys.argv[i + 1]))
ONCE = "--once" in sys.argv


def log(msg):
    line = f"[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] {msg}"
    print(line, flush=True)
    try:
        with LOG.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def notify(title, body):
    """윈도우 알림 — DB·터널이 죽어도 뜬다(전부 로컬).

    ★ 반드시 비동기여야 한다. MessageBoxW 는 사람이 [확인]을 누를 때까지 **호출한 스레드를 붙잡는다**.
      감시 루프에서 직접 부르면, 새벽에 VM 이 죽어 경보가 뜬 순간 감시가 그 자리에 멈춘다
      — 아침에 아무도 없으면 그 뒤로 무슨 일이 있었는지 전혀 알 수 없다.
      경보를 울리려고 만든 것이 경보 때문에 죽는 셈이라, 알림은 별도 스레드로 던지고 루프는 계속 돈다."""
    threading.Thread(target=_notify_blocking, args=(title, body), daemon=True).start()


def _notify_blocking(title, body):
    safe = lambda s: s.replace("'", "").replace("\n", " ")
    ps = (
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]"
        " | Out-Null;"
        "$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent("
        "[Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
        f"$x=$t.GetElementsByTagName('text');$x.Item(0).AppendChild($t.CreateTextNode('{safe(title)}'))|Out-Null;"
        f"$x.Item(1).AppendChild($t.CreateTextNode('{safe(body)}'))|Out-Null;"
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('DDMKT')"
        ".Show([Windows.UI.Notifications.ToastNotification]::new($t));"
    )
    try:
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                       timeout=25, capture_output=True)
    except Exception:
        pass
    try:  # 토스트가 막혀 있어도 놓치지 않게
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, body, title, 0x40 | 0x1000)   # MB_SYSTEMMODAL
    except Exception:
        pass


def ssh(cmd, timeout=60):
    """VM 셸 실행. ⚠ stdin=DEVNULL 필수 — 없으면 콘솔 없는 환경(예약작업·서비스)에서 멈춘다."""
    try:
        p = subprocess.run(["ssh", "-n", "-i", SSH_KEY, "-o", "BatchMode=yes",
                            "-o", "ConnectTimeout=15", VM, cmd],
                           stdin=subprocess.DEVNULL, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=timeout)
        return p.returncode, p.stdout.strip()
    except Exception as e:
        return -1, f"{type(e).__name__}"


def check_tunnel():
    """밖에서 보이는 경로. 이게 죽으면 웹·SUB PC 가 전부 멈춘다 — 가장 무거운 신호."""
    bad = []
    for name, u, h in (("REST", f"{URL}/rest/v1/clients?select=id&limit=1", H),
                       ("Auth", f"{URL}/auth/v1/settings", {"apikey": KEY}),
                       ("Storage", f"{URL}/storage/v1/bucket", H)):
        try:
            r = requests.get(u, headers=h, timeout=25)
            if r.status_code >= 400:
                bad.append(f"{name} {r.status_code}")
        except Exception as e:
            bad.append(f"{name} {type(e).__name__}")
    return bad


def check_vm():
    """컨테이너·디스크·DB 크기를 한 번의 접속으로 가져온다(접속 자체가 비싸다)."""
    rc, out = ssh(
        'echo "CT|$(docker ps -a --filter name=supabase --filter name=realtime '
        '--format \'{{.Names}}:{{.State}}\' | tr "\\n" " ")"; '
        'echo "DISK|$(df --output=pcent / | tail -1 | tr -dc 0-9)"; '
        'echo "DB|$(docker exec supabase-db psql -U postgres -d postgres -tAc '
        '"select pg_database_size(current_database())" 2>/dev/null)"')
    if rc != 0:
        return {"ssh": out or "접속 실패"}
    d = {}
    for line in out.splitlines():
        k, _, v = line.partition("|")
        d[k.strip()] = v.strip()
    return d


def probe():
    """(상태, 요약). 상태 = ok | warn | down"""
    problems, warns, info = [], [], []

    bad = check_tunnel()
    if bad:
        problems.append("터널/API " + " · ".join(bad))

    vm = check_vm()
    if "ssh" in vm:
        problems.append(f"VM 접속 불가({vm['ssh']})")
    else:
        # 컨테이너 — running 이 아닌 것이 있으면 즉시 문제
        cts = [c for c in (vm.get("CT") or "").split() if ":" in c]
        dead = [c for c in cts if not c.endswith(":running")]
        if not cts:
            problems.append("컨테이너 목록 없음")
        elif dead:
            problems.append("컨테이너 이상: " + " ".join(dead))
        else:
            info.append(f"컨테이너 {len(cts)}개 정상")

        pc = vm.get("DISK") or ""
        if pc.isdigit():
            pct = int(pc)
            info.append(f"디스크 {pct}%")
            if pct >= DISK_CRIT:
                problems.append(f"디스크 {pct}% — 곧 쓰기 실패")
            elif pct >= DISK_WARN:
                warns.append(f"디스크 {pct}%")

        db = vm.get("DB") or ""
        if db.isdigit():
            info.append(f"DB {int(db)/1048576:.0f}MB")

    # 크롤 멈춤 감지 — 예약작업은 크롤 실패를 절대 못 본다.
    #   run_crawler.bat 이 `start /min` 으로 별도 콘솔에 띄우고 즉시 끝나므로, 작업 스케줄러에는
    #   언제나 '성공(0)' 으로 기록된다(실측: 오늘 01:00 도 LastResult=0). RestartCount 도 0 이다.
    #   그래서 새벽 3시에 크롤이 죽어도 아무도 모르고 다음 실행은 24시간 뒤다.
    #   → crawl_status 가 '진행 중(running=true)' 인데 갱신이 끊긴 것을 멈춤으로 본다.
    #     크롤은 글마다 상태를 갱신하므로, 60분간 갱신이 없으면 정상 진행일 수 없다.
    #     (차단예방 휴식이 가장 길어야 수십 초라 오탐 여지가 없다)
    try:
        r = requests.get(f"{URL}/rest/v1/crawl_status", headers=H,
                         params={"select": "running,phase,done,total,updated_at"}, timeout=25)
        rows = r.json() if r.ok else []
        if rows:
            st = rows[0]
            import datetime as _dt
            upd = _dt.datetime.fromisoformat((st.get("updated_at") or "").replace("Z", "+00:00"))
            age_m = (_dt.datetime.now(_dt.timezone.utc) - upd).total_seconds() / 60
            if st.get("running") and age_m > 60:
                problems.append(f"크롤 멈춤 — '{st.get('phase')}' {st.get('done')}/{st.get('total')} 에서 "
                                f"{age_m:.0f}분째 갱신 없음")
            elif st.get("running"):
                info.append(f"크롤 진행 {st.get('done')}/{st.get('total')}")
    except Exception:
        pass                                   # 크롤 상태 조회 실패는 터널 점검에서 이미 잡힌다

    # 백업 신선도 — 예약작업이 조용히 멈춰도 여기서 잡힌다.
    newest, age_h = None, None
    if BACKUP_DIR.exists():
        days = sorted([d for d in BACKUP_DIR.glob("20*") if d.is_dir()])
        if days:
            newest = days[-1].name
            dumps = list(days[-1].glob("*.dump"))
            if dumps:
                age_h = (time.time() - max(f.stat().st_mtime for f in dumps)) / 3600
    if age_h is None:
        warns.append("백업 없음")
    else:
        info.append(f"백업 {newest}({age_h:.0f}h 전)")
        if age_h > BACKUP_STALE_H:
            warns.append(f"백업 {age_h:.0f}시간째 갱신 없음")

    if problems:
        return "down", " / ".join(problems)
    if warns:
        return "warn", " / ".join(warns) + "  [" + " · ".join(info) + "]"
    return "ok", " · ".join(info)


def load_state():
    try:
        return STATE.read_text(encoding="utf-8").strip()
    except Exception:
        return ""


def save_state(s):
    try:
        STATE.write_text(s, encoding="utf-8")
    except Exception:
        pass


def main():
    if not URL or not KEY:
        log("SUPABASE_URL/KEY 없음 — 감시 불가")
        return
    log(f"=== 자체호스팅 감시 시작 · {URL} · {INTERVAL}초 간격 ===")
    prev = load_state()
    streak = 0
    while True:
        state, detail = probe()
        # 일시적 네트워크 흔들림으로 깨우지 않는다 — down 은 3회 연속일 때만 인정.
        if state == "down":
            streak += 1
            if streak < 3:
                log(f"일시 이상({streak}/3): {detail}")
                if ONCE:
                    return
                time.sleep(min(60, INTERVAL))
                continue
        else:
            streak = 0

        if state != prev:
            log(f"상태 변화: {prev or '(최초)'} → {state} · {detail}")
            if state == "down":
                notify("⛔ 자체호스팅 이상", f"{detail}\nERP·크롤·발행이 멈출 수 있습니다. VM 확인 필요.")
            elif state == "warn":
                notify("⚠️ 자체호스팅 경고", detail)
            elif prev:
                notify("✅ 자체호스팅 정상 복구", detail)
            save_state(state)
            prev = state
        else:
            log(f"{state} · {detail}")
        if ONCE:
            return
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
