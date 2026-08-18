# -*- coding: utf-8 -*-
"""Supabase 제한(402) 감시 — 걸리는 순간 바로 알린다.

왜 필요한가 (2026-08-18)
  Supabase 가 '유예 3일(8/9까지), 이후 업그레이드 전까지 402' 라고 통지했다.
  기한은 이미 지났고 아직 집행은 안 됐지만, 예고 없이 걸릴 수 있다.
  걸리면 ERP·크롤·발행이 동시에 죽는데, 알림을 DB에 의존하면 그 알림도 같이 죽는다.
  → 이 감시는 로컬에서만 돌고, 알림도 윈도우 토스트/로그로 낸다.

무엇을 보나
  REST · Storage · Auth 세 경로. 402 면 '제한', 그 외 실패면 '이상'.
  상태가 바뀔 때만 알린다(정상->제한, 제한->정상). 같은 상태 반복 알림 없음.

실행: python supabase_guard.py            (기본 5분 간격, 계속)
      python supabase_guard.py --once     (1회 점검 후 종료)
      python supabase_guard.py --sec 600  (간격 변경)
"""
import os
import re
import sys
import time
import pathlib
import datetime
import subprocess

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

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY") or ""
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
LOG = HERE / "supabase_guard.log"
STATE = HERE / "supabase_guard.state"

INTERVAL = 300
for i, a in enumerate(sys.argv):
    if a == "--sec" and i + 1 < len(sys.argv):
        INTERVAL = max(60, int(sys.argv[i + 1]))
ONCE = "--once" in sys.argv

CHECKS = [
    ("REST", f"{URL}/rest/v1/cafe_accounts?select=id&limit=1", H),
    ("Storage", f"{URL}/storage/v1/bucket", H),
    ("Auth", f"{URL}/auth/v1/settings", {"apikey": KEY}),
]


def log(msg):
    line = f"[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] {msg}"
    print(line, flush=True)
    try:
        with LOG.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def toast(title, body):
    """윈도우 알림 — Supabase 가 죽어도 뜬다(로컬). 실패해도 감시는 계속한다."""
    ps = (
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]"
        " | Out-Null;"
        "$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent("
        "[Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
        f"$x=$t.GetElementsByTagName('text');$x.Item(0).AppendChild($t.CreateTextNode('{title}'))|Out-Null;"
        f"$x.Item(1).AppendChild($t.CreateTextNode('{body}'))|Out-Null;"
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('DDMKT')"
        ".Show([Windows.UI.Notifications.ToastNotification]::new($t));"
    )
    try:
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                       timeout=25, capture_output=True)
    except Exception:
        pass
    # 토스트가 막혀 있어도 놓치지 않게 메시지 박스도 한 번 띄운다(있으면 보인다).
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, body, title, 0x40 | 0x1000)   # MB_SYSTEMMODAL
    except Exception:
        pass


def probe():
    """(상태, 설명). 상태 = ok | limited | error"""
    bad = []
    for name, u, h in CHECKS:
        try:
            r = requests.get(u, headers=h, timeout=25)
            if r.status_code == 402:
                return "limited", f"{name} 402 — Supabase 제한 적용됨"
            if r.status_code >= 400:
                bad.append(f"{name} {r.status_code}")
        except Exception as e:
            bad.append(f"{name} {type(e).__name__}")
    if bad:
        return "error", " · ".join(bad)
    return "ok", "정상"


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
    log(f"=== Supabase 감시 시작 · {INTERVAL}초 간격 ===")
    prev = load_state()
    fail_streak = 0
    while True:
        state, detail = probe()
        # 일시적 네트워크 오류로 오탐하지 않게 — error 는 3회 연속일 때만 상태로 인정.
        if state == "error":
            fail_streak += 1
            if fail_streak < 3:
                log(f"일시 오류({fail_streak}/3): {detail}")
                if ONCE:
                    return
                time.sleep(INTERVAL)
                continue
        else:
            fail_streak = 0

        if state != prev:
            log(f"상태 변화: {prev or '(최초)'} → {state} · {detail}")
            if state == "limited":
                toast("⛔ Supabase 제한(402)",
                      "ERP·크롤·발행이 멈춥니다. Supabase 대시보드에서 Pro 업그레이드가 필요합니다.")
            elif state == "error":
                toast("⚠️ Supabase 접속 이상", f"{detail} — 확인이 필요합니다.")
            elif prev:
                toast("✅ Supabase 정상 복구", "다시 정상 응답합니다.")
            save_state(state)
            prev = state
        else:
            log(f"{state} · {detail}")
        if ONCE:
            return
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
