# -*- coding: utf-8 -*-
"""새벽 크롤 진행 보고 메일 — 시작 · 중간(블로그 완료) · 마무리(카페 완료).

왜 필요한가 (2026-08-19)
  01:00 무인 크롤은 아무도 안 본다. 그리고 예약작업은 크롤 실패를 **원리상 못 본다** —
  run_crawler.bat 이 `start /min` 으로 띄우고 즉시 끝나 언제나 '성공(0)' 으로 기록되기 때문이다.
  자체호스팅으로 옮긴 뒤로는 더 알아야 한다. 그래서 진행 상황을 메일로 밀어 보낸다.

무엇을 보고 판단하나
  crawl_status(단일행) 의 running/phase/done/total/ok/fail 과 recent_runs 목록.
  블로그 단계가 끝나면 recent_runs 에 '전체크롤' 항목이, 카페 단계가 끝나면 '카페순위' 항목이 붙는다.
  그 두 항목이 새로 생기는 순간을 각각 '중간'·'마무리' 로 본다.

  ★ 침묵도 보고한다. 시작을 못 봤거나 중간에 멈추면 그것 자체가 가장 중요한 소식이다 —
    '아무 메일도 안 왔다' 를 사람이 알아채길 기대하면 안 된다.

실행: python crawl_report_mail.py            (기본: 지금부터 09:40 까지 감시)
      python crawl_report_mail.py --test     (즉시 현재 상태로 1통 보내고 종료 — 발송 점검용)
"""
import datetime
import os
import re
import smtplib
import subprocess
import sys
import time
from email.message import EmailMessage
from email.utils import formatdate

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore

truststore.inject_into_ssl()
import requests

requests.packages.urllib3.disable_warnings()

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

def _env(path, key):
    try:
        m = re.search(rf"^{key}\s*=\s*(.+)$", open(path, encoding="utf-8", errors="ignore").read(), re.M)
        return m.group(1).strip() if m else None
    except Exception:
        return None

URL = _env(os.path.join(HERE, ".env"), "SUPABASE_URL")
KEY = _env(os.path.join(HERE, ".env"), "SUPABASE_SERVICE_KEY")
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

TO = "dog6425@ddmkt.com"
FROM = "rlawhddls@ddmkt.com"
LOG = os.path.join(HERE, "crawl_report_mail.log")
STOP_AT = datetime.time(9, 40)       # 이 시각까지만 감시(카페 하드스톱 09:00 이후 여유)
POLL = 60
STALL_MIN = 60                        # 진행 중인데 이만큼 갱신이 없으면 멈춤으로 본다


def log(msg):
    line = f"[{datetime.datetime.now():%m-%d %H:%M:%S}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def smtp_pass():
    """앱 비밀번호는 VM 의 .env 에서 그때그때 읽는다 — 이 PC 에 사본을 남기지 않는다."""
    key = os.path.expanduser("~/.ssh/ddmkt_vm")
    p = subprocess.run(["ssh", "-n", "-i", key, "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
                        "ddmkt@192.168.0.179", "grep -E '^SMTP_PASS=' ~/ddmkt-db/.env"],
                       stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60)
    m = re.search(r"^SMTP_PASS=(.+)$", p.stdout.strip(), re.M)
    return m.group(1).strip() if m else None


def send(subject, body):
    pw = smtp_pass()
    if not pw:
        log("메일 실패 — VM 에서 SMTP_PASS 를 못 읽음")
        return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"든든한마케팅 <{FROM}>"
    msg["To"] = TO
    msg["Date"] = formatdate(localtime=True)
    msg.set_content(body)
    for attempt in (1, 2, 3):          # 메일 한 통 때문에 보고가 통째로 사라지지 않게
        try:
            s = smtplib.SMTP("smtp.worksmobile.com", 587, timeout=30)
            s.ehlo(); s.starttls(); s.ehlo()
            s.login(FROM, pw)
            s.send_message(msg)
            s.quit()
            log(f"메일 발송 ✅ {subject}")
            return True
        except Exception as e:
            log(f"메일 실패({attempt}/3) {type(e).__name__}: {str(e)[:80]}")
            time.sleep(20)
    return False


def status():
    r = requests.get(f"{URL}/rest/v1/crawl_status", headers=H, timeout=30,
                     params={"select": "running,phase,done,total,ok,fail,current_blog,updated_at,recent_runs"})
    return (r.json() or [{}])[0] if r.ok else {}


def runs_of(st, kind):
    return [x for x in (st.get("recent_runs") or []) if x.get("kind") == kind]


def age_min(st):
    try:
        u = datetime.datetime.fromisoformat((st.get("updated_at") or "").replace("Z", "+00:00"))
        return (datetime.datetime.now(datetime.timezone.utc) - u).total_seconds() / 60
    except Exception:
        return -1


def fmt(st):
    return (f"  진행     {st.get('phase')} · {st.get('done')}/{st.get('total')}"
            f" (성공 {st.get('ok')} / 실패 {st.get('fail')})\n"
            f"  현재     {st.get('current_blog') or '-'}\n"
            f"  마지막 갱신 {age_min(st):.0f}분 전\n")


def main():
    if not URL or not KEY:
        log("SUPABASE_URL/KEY 없음"); return 1
    if "--test" in sys.argv:
        st = status()
        send("[DDMKT] 크롤 보고 발송 점검", "발송 경로 점검용 메일입니다.\n\n" + fmt(st))
        return 0

    log("=== 새벽 크롤 보고 감시 시작 ===")
    st0 = status()
    base_blog = len(runs_of(st0, "전체크롤"))
    base_cafe = len(runs_of(st0, "카페순위"))
    sent_start = sent_mid = sent_end = sent_stall = False
    t_start = None

    while datetime.datetime.now().time() < STOP_AT:
        try:
            st = status()
        except Exception as e:
            log(f"상태 조회 실패: {type(e).__name__}")
            time.sleep(POLL); continue

        # ── 시작 ──
        if not sent_start and st.get("running"):
            t_start = datetime.datetime.now()
            send("[DDMKT] 새벽 크롤 시작",
                 f"새벽 크롤이 시작됐습니다.\n\n"
                 f"  시작     {t_start:%m-%d %H:%M}\n{fmt(st)}\n"
                 f"  블로그 마감 07:30 · 카페 하드스톱 09:00\n"
                 f"  진행 상황은 블로그 단계가 끝날 때 다시 보내드립니다.\n")
            sent_start = True

        # ── 중간: 블로그 단계 완료(recent_runs 에 '전체크롤' 이 하나 늘어남) ──
        if sent_start and not sent_mid and len(runs_of(st, "전체크롤")) > base_blog:
            r = runs_of(st, "전체크롤")[0]
            send("[DDMKT] 크롤 중간 보고 — 블로그 완료",
                 f"블로그 단계가 끝나고 카페 단계로 넘어갑니다.\n\n"
                 f"  블로그   {r.get('at')} 종료 · {r.get('measured')}글 · 실패 {r.get('fail')}\n"
                 f"  다음     카페 순위 측정 (하드스톱 09:00)\n\n"
                 f"  참고: 어제는 블로그 06:54 종료 · 카페 08:33 종료로 09:00 까지 27분 여유였습니다.\n")
            sent_mid = True

        # ── 마무리: 카페 단계 완료 ──
        if not sent_end and len(runs_of(st, "카페순위")) > base_cafe:
            rc = runs_of(st, "카페순위")[0]
            rb = (runs_of(st, "전체크롤") or [{}])[0]
            send("[DDMKT] 새벽 크롤 완료",
                 f"새벽 크롤이 모두 끝났습니다.\n\n"
                 f"  블로그   {rb.get('at','-')} 종료 · {rb.get('measured','?')}글 · 실패 {rb.get('fail','?')}\n"
                 f"  카페     {rc.get('at','-')} 종료 · {rc.get('measured','?')}글 · 실패 {rc.get('fail','?')}\n\n"
                 f"  09:00 하드스톱까지 여유가 있었는지 '카페 종료' 시각으로 확인하세요.\n"
                 f"  08:30 이후면 글이 늘어 여유가 줄고 있다는 신호입니다.\n")
            sent_end = True
            break

        # ── 멈춤: 진행 중인데 갱신이 끊겼다 ──
        if sent_start and not sent_end and not sent_stall and st.get("running") and age_min(st) > STALL_MIN:
            send("⛔ [DDMKT] 크롤 멈춤 의심",
                 f"크롤이 진행 중으로 표시돼 있는데 {age_min(st):.0f}분째 갱신이 없습니다.\n\n{fmt(st)}\n"
                 f"  자동 재실행은 없습니다. 아침에 손으로 다시 돌리면 이미 잰 글은 건너뜁니다.\n")
            sent_stall = True

        time.sleep(POLL)

    # ── 침묵도 보고한다 ──
    if not sent_start:
        send("⛔ [DDMKT] 새벽 크롤이 시작되지 않았습니다",
             "01:00 크롤이 시작된 흔적이 없습니다(감시 종료 시각까지 running 이 한 번도 켜지지 않음).\n"
             "예약작업 DDMKT-Crawl-Full 과 PC 전원/로그온 상태를 확인하세요.\n")
    elif not sent_end:
        send("⚠ [DDMKT] 크롤이 끝나지 않은 채 감시가 종료됐습니다",
             f"카페 단계 완료를 못 봤습니다.\n\n{fmt(status())}\n"
             f"크롤현황 화면에서 실제 상태를 확인하세요.\n")
    log("=== 감시 종료 ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
