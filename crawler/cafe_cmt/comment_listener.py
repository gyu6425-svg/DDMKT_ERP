# -*- coding: utf-8 -*-
"""
카페 댓글 리스너 — 웹/워처가 쌓은 큐(cafe_comment_queue)를 폴링해
comment_cafe 로 대상 글에 댓글을 작성한다. cafe_pub/publish_listener 구조 복제(자립).

멀티계정: 각 작업의 account 로 accounts.txt 에서 크롬 포트를 찾아 그 계정의 크롬으로 게시한다.
흐름: 웹/워처 → cafe_comment_queue(pending) → [이 리스너] comment_cafe.comment_job → done/fail
전제: 계정마다 run_chrome.bat <account> (헤드리스, 각자 포트) 실행 중.

⚠️ 계정 안전: 저빈도 작성. CAFE_CMT_MIN_GAP_MIN 로 **계정별** 간격 강제.
   기본 --no-send(수동보조): '등록' 직전까지만. 완전 자동은 CAFE_CMT_NO_SEND=0.

실행: python comment_listener.py
"""
import datetime
import os
import socket
import sys
import time

import comment_cafe as cc   # 같은 디렉터리(자립) — cafe_pub 를 import 하지 않음
import accounts as acct     # 계정 → 크롬 포트(멀티계정)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

POLL_SEC = 6
BATCH = 10                                                        # 후보를 여러 건 받아 처리 가능한 것부터
MIN_GAP_MIN = int(os.environ.get("CAFE_CMT_MIN_GAP_MIN", "20"))    # 댓글 최소 간격(분) — 계정별
NO_SEND = os.environ.get("CAFE_CMT_NO_SEND", "1") != "0"           # 기본 수동보조(등록 직전까지)
_last = {}                                                        # 계정별 마지막 게시 시각(멀티계정 처리량 확보)


def _port_open(port, timeout=1.0):
    """해당 계정의 크롬 CDP 포트가 살아있는지. 죽은 계정 작업은 건너뛰어 다른 계정이 굶지 않게 한다."""
    try:
        with socket.create_connection(("127.0.0.1", int(port)), timeout=timeout):
            return True
    except Exception:
        return False


def _fail(jid, reason):
    cc.sb_patch("cafe_comment_queue", {"id": f"eq.{jid}"}, {"status": "fail", "reason": reason})


def main():
    if not cc.SUPABASE_URL or not cc.SUPABASE_KEY:
        print("SUPABASE_URL / SUPABASE_SERVICE_KEY 필요(../.env)", flush=True); sys.exit(1)
    mode = "수동보조(등록 직전까지)" if NO_SEND else "완전 자동(등록 클릭)"
    names = ", ".join(f"{a['name']}:{a['port']}" for a in acct.load_accounts())
    print(f"[카페 댓글 리스너] 폴링 {POLL_SEC}s · 계정별 간격 {MIN_GAP_MIN}분 · {mode} · 중복범위 {cc.DEDUP_SCOPE}", flush=True)
    print(f"  계정: {names} — Ctrl+C 종료", flush=True)

    while True:
        try:
            reqs = cc.sb_get("cafe_comment_queue", {
                "status": "eq.pending", "order": "created_at.asc", "limit": str(BATCH), "select": "*",
            })
        except Exception as e:
            print(f"폴링 오류: {e}", flush=True); time.sleep(8); continue
        if not reqs:
            time.sleep(POLL_SEC); continue

        picked = None
        now_dt = datetime.datetime.now().astimezone()   # 타임존 인식(로컬)
        for job in reqs:
            jid = job["id"]
            # 예약시각(scheduled_at)이 아직 안 됐으면 건너뜀 — 계정 간 시차를 지켜
            #   같은 글에 여러 계정 댓글이 동시에 달리지 않게 한다.
            #   DB 는 timestamptz(UTC 로 돌려줌)라 문자열이 아니라 시각으로 비교해야 정확하다.
            sched = (job.get("scheduled_at") or "").strip()
            if sched:
                try:
                    sdt = datetime.datetime.fromisoformat(sched.replace("Z", "+00:00"))
                    if sdt.tzinfo is None:
                        sdt = sdt.astimezone()
                    if sdt > now_dt:
                        continue
                except Exception:
                    pass   # 파싱 실패 시 예약 무시하고 진행
            a = acct.find_account(job.get("account"))
            # B1: 이름이 있는데 accounts.txt 에 없으면 기본 계정으로 폴백하지 않고 실패 처리
            #     (폴백하면 엉뚱한 네이버 아이디로 댓글이 달린다)
            if a is None:
                _fail(jid, f"계정 미등록: '{job.get('account')}' — accounts.txt 에 추가 후 재예약")
                print(f"  ❌ 계정 미등록으로 실패 처리: {job.get('account')}", flush=True)
                continue
            # 계정별 간격(완전 자동일 때만)
            if not NO_SEND and (time.time() - _last.get(a["name"], 0.0)) < MIN_GAP_MIN * 60:
                continue
            # 해당 계정 크롬이 죽어있으면 건너뛰고 다른 계정 작업을 처리(머리 막힘 방지)
            if not _port_open(a["port"]):
                continue
            picked = (job, jid, a)
            break

        if not picked:
            time.sleep(POLL_SEC); continue
        job, jid, a = picked

        # 중복 방지 — 조회 자체가 실패하면(마이그레이션 전 등) 게시하지 않고 다음 기회로 미룬다.
        #   ⚠️ 답글(reply_to_body 있음)에는 이 판정을 적용하지 않는다. 여기 판정은
        #   '이 계정이 이 글에 댓글을 달았나'라서, 같은 글에 댓글을 단 계정은 답글도 못 달게 된다.
        #   답글의 중복 방지는 예약기(reply_scheduler)가 '그 원댓글에 이미 답글했나'로 처리한다.
        is_reply = bool((job.get("reply_to_body") or "").strip())
        if is_reply:
            dup = False
        else:
            try:
                dup = cc.already_commented(job.get("article_url"), exclude_id=jid, account=a["name"])
            except Exception as e:
                print(f"  ⏸ 중복확인 실패 — 게시 보류(대기 유지): {str(e)[:110]}", flush=True)
                time.sleep(15); continue
        if dup:
            _fail(jid, "중복 방지: 이 글에 이미 댓글 있음")
            print(f"[{datetime.datetime.now():%H:%M:%S}] ⏭ 이미 댓글 단 글 — 건너뜀: {(job.get('article_url') or '')[:46]}", flush=True)
            continue

        cc.sb_patch("cafe_comment_queue", {"id": f"eq.{jid}"}, {"status": "processing"})
        now = datetime.datetime.now().isoformat(timespec="seconds")
        print(f"[{datetime.datetime.now():%H:%M:%S}] 댓글 처리[{a['name']}:{a['port']}]: {(job.get('article_url') or '')[:44]}", flush=True)
        try:
            url = cc.comment_job(job, f"http://127.0.0.1:{a['port']}", no_send=NO_SEND)
            _last[a["name"]] = time.time()
            if NO_SEND:
                cc.sb_patch("cafe_comment_queue", {"id": f"eq.{jid}"},
                            {"status": "done", "done_at": now, "reason": "no_send(등록은 수동)"})
                print("  ✅ 입력 완료 — 브라우저에서 '등록' 눌러 게시하세요", flush=True)
            else:
                cc.sb_patch("cafe_comment_queue", {"id": f"eq.{jid}"},
                            {"status": "done", "done_at": now, "posted_url": url})
                print(f"  ✅ 댓글 완료: {url}", flush=True)
        except Exception as e:
            reason = str(e)[:300]
            # 로그인 만료·크롬 꺼짐·일시 오류는 재시도 대상 → pending 으로 되돌려 복구 후 자동 재개.
            retryable = any(k in reason for k in (
                "LOGIN_REQUIRED", "ECONNREFUSED", "connect_over_cdp", "댓글 입력창", "댓글 등록 버튼",
                "Timeout", "Target closed", "browserContext", "websocket",
            ))
            if retryable:
                cc.sb_patch("cafe_comment_queue", {"id": f"eq.{jid}"}, {"status": "pending", "reason": None})
                print(f"  ⏸ 크롬/로그인/일시오류 — 대기로 되돌림(복구되면 자동): {reason[:90]}", flush=True)
                time.sleep(30)
            else:
                _fail(jid, reason)
                print(f"  ❌ 실패 — {reason}", flush=True)


if __name__ == "__main__":
    main()
