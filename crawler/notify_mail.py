# -*- coding: utf-8 -*-
"""공용 메일 알림 — 감시 대상(VM)이 죽어도 보낼 수 있어야 한다.

왜 따로 만들었나 (독립검증 2026-08-21)
  기존 crawl_report_mail.send() 는 보낼 때마다 VM(192.168.0.179) 에 ssh 해서
  SMTP 비밀번호를 읽었다. "이 PC 에 사본을 남기지 않는다"는 의도였는데,
  그 결과 **VM 이 죽으면 'VM 이 죽었다'는 메일을 보낼 수 없다.**
  알림 채널이 감시 대상에 의존하면, 정작 알려야 할 때 침묵한다.

  이 PC 는 2026-08-21 에 BitLocker 전체 암호화(100%·보호 On)를 마쳤다.
  꺼진 디스크를 떼어 가도 못 읽는다. 그래서 지금은
  '로컬 사본의 위험' < '알림이 안 가는 위험' 이다. 캐시로 바꾼다.

  캐시가 없으면 VM 에서 한 번 가져와 만든다(그때는 VM 이 살아 있다는 뜻).
  캐시가 있으면 VM 을 아예 안 본다 — ssh 가 느려 60초를 넘겨 알림이 통째로
  죽던 경로(TimeoutExpired)도 같이 사라진다.

쓰는 법
  import notify_mail
  notify_mail.send("[DDMKT] 제목", "본문")        # 실패해도 예외를 던지지 않는다
"""
import os
import re
import time
import smtplib
import datetime
import subprocess
import pathlib
from email.message import EmailMessage
from email.utils import formatdate

# ★ Windows 인증서 저장소를 쓴다. Avast 의 HTTPS 검사가 TLS 를 가로채 자체 CA 로 다시 서명하는데,
#   파이썬 기본 번들에는 그 CA 가 없어 CERTIFICATE_VERIFY_FAILED 로 메일이 통째로 실패한다
#   (실측 2026-08-21). truststore 를 끼우면 Windows 가 신뢰하는 CA 를 그대로 쓴다.
try:
    import truststore
    truststore.inject_into_ssl()
except Exception:
    pass

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / ".smtp_pass"          # .gitignore 대상 — 저장소에 올라가면 안 된다
LOG = HERE / "notify_mail.log"

# 발신 = Works 계정(rlawhddls), 수신 = 사장님(dog6425).
#   ⚠ 둘을 같게 두면 535 인증실패다 — SMTP_PASS 는 rlawhddls 계정의 앱 비밀번호다.
FROM = "rlawhddls@ddmkt.com"
TO = "dog6425@ddmkt.com"
HOST, PORT = "smtp.worksmobile.com", 587
VM = "ddmkt@192.168.0.179"
KEY = os.path.expanduser("~/.ssh/ddmkt_vm")


def log(msg):
    line = f"[{datetime.datetime.now():%m-%d %H:%M:%S}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def _from_vm():
    """VM 의 .env 에서 SMTP_PASS 를 읽어온다. 실패하면 None — 예외는 안 던진다.
       ★ ssh 는 -n 필수. 콘솔 없는 데(예약작업)서 stdin 을 물고 영원히 멈춘 적이 있다."""
    try:
        p = subprocess.run(
            ["ssh", "-n", "-i", KEY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
             VM, "grep -E '^SMTP_PASS=' ~/ddmkt-db/.env"],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=45)
        m = re.search(r"^SMTP_PASS=(.+)$", (p.stdout or "").strip(), re.M)
        return m.group(1).strip() if m else None
    except Exception as e:
        log(f"VM 에서 SMTP_PASS 못 읽음: {type(e).__name__}")
        return None


def smtp_pass(refresh=False):
    """캐시 우선. 없으면 VM 에서 가져와 캐시한다."""
    if not refresh:
        try:
            if CACHE.exists():
                v = CACHE.read_text(encoding="utf-8").strip()
                if v:
                    return v
        except Exception:
            pass
    pw = _from_vm()
    if pw:
        try:
            CACHE.write_text(pw, encoding="utf-8")
        except Exception as e:
            log(f"캐시 저장 실패(계속 진행): {type(e).__name__}")
    return pw


def send(subject, body, _retry_refresh=True):
    """메일 1통. 성공 True / 실패 False. **어떤 경우에도 예외를 던지지 않는다** —
       알림을 보내다 죽으면 부르는 쪽(가드·백업·보고)이 같이 죽는다."""
    try:
        pw = smtp_pass()
        if not pw:
            log(f"메일 실패 — 비밀번호 없음 (제목: {subject})")
            return False
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = f"든든한마케팅 <{FROM}>"
        msg["To"] = TO
        msg["Date"] = formatdate(localtime=True)
        msg.set_content(body)
        last = ""
        for attempt in (1, 2, 3):
            try:
                s = smtplib.SMTP(HOST, PORT, timeout=30)
                s.ehlo()
                s.starttls()
                s.ehlo()
                s.login(FROM, pw)
                s.send_message(msg)
                s.quit()
                log(f"메일 발송 ✅ {subject}")
                return True
            except smtplib.SMTPAuthenticationError as e:
                last = f"인증실패 {str(e)[:60]}"
                # 비밀번호가 바뀌었을 수 있다 — 캐시를 버리고 VM 에서 한 번만 다시 받아 재시도.
                if _retry_refresh:
                    log("인증 실패 — 캐시 갱신 후 1회 재시도")
                    if smtp_pass(refresh=True):
                        return send(subject, body, _retry_refresh=False)
                break
            except Exception as e:
                last = f"{type(e).__name__}: {str(e)[:60]}"
                log(f"메일 실패({attempt}/3) {last}")
                time.sleep(15)
        log(f"메일 최종 실패 — {last} (제목: {subject})")
        return False
    except Exception as e:
        log(f"메일 실패(예외 삼킴) {type(e).__name__}: {str(e)[:80]}")
        return False


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ok = send("[DDMKT] 알림 경로 점검",
              "notify_mail 모듈 점검용입니다.\n"
              f"  캐시 사용: {CACHE.exists()}\n"
              f"  보낸 시각: {datetime.datetime.now():%Y-%m-%d %H:%M:%S}\n")
    print("결과:", ok)
    sys.exit(0 if ok else 1)
