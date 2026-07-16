# -*- coding: utf-8 -*-
"""
카페 댓글 리스너 — 웹 '댓글 예약'이 쌓은 큐(cafe_comment_queue)를 폴링해
comment_cafe 로 대상 글에 댓글을 작성한다. cafe_pub/publish_listener 구조 복제(자립).

흐름: 웹 → cafe_comment_queue(pending) → [이 리스너] comment_cafe.comment_job → done/fail
전제: run_chrome.bat(네이버 로그인 헤드리스 크롬, 포트 9224) 실행 중.

⚠️ 계정 안전: 저빈도 작성(간격 크게, 하루 소수). CAFE_CMT_MIN_GAP_MIN 로 간격 강제.
   기본 --no-send(수동보조): '등록' 직전까지만. 완전 자동은 CAFE_CMT_NO_SEND=0.

실행: python comment_listener.py
"""
import datetime
import os
import sys
import time

import comment_cafe as cc   # 같은 디렉터리(자립) — cafe_pub 를 import 하지 않음

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

POLL_SEC = 6
MIN_GAP_MIN = int(os.environ.get("CAFE_CMT_MIN_GAP_MIN", "20"))   # 댓글 최소 간격(분) — 계정 안전
NO_SEND = os.environ.get("CAFE_CMT_NO_SEND", "1") != "0"          # 기본 수동보조(등록 직전까지)
_last = [0.0]


def main():
    if not cc.SUPABASE_URL or not cc.SUPABASE_KEY:
        print("SUPABASE_URL / SUPABASE_SERVICE_KEY 필요(../.env)", flush=True); sys.exit(1)
    mode = "수동보조(등록 직전까지)" if NO_SEND else "완전 자동(등록 클릭)"
    print(f"[카페 댓글 리스너] cafe_comment_queue 폴링 {POLL_SEC}s · 간격 {MIN_GAP_MIN}분 · {mode} — Ctrl+C 종료", flush=True)
    while True:
        try:
            reqs = cc.sb_get("cafe_comment_queue", {"status": "eq.pending", "order": "created_at.asc", "limit": "1", "select": "*"})
        except Exception as e:
            print(f"폴링 오류: {e}", flush=True); time.sleep(8); continue
        if not reqs:
            time.sleep(POLL_SEC); continue
        # 간격 강제(계정 안전)
        if not NO_SEND and (time.time() - _last[0]) < MIN_GAP_MIN * 60:
            time.sleep(POLL_SEC); continue

        job = reqs[0]; jid = job["id"]
        # 중복 방지 — 같은 글(글번호 기준)에 이미 댓글(완료/처리중)이 있으면 게시하지 않고 건너뜀.
        if cc.already_commented(job.get("article_url"), exclude_id=jid):
            cc.sb_patch("cafe_comment_queue", {"id": f"eq.{jid}"},
                        {"status": "fail", "reason": "중복 방지: 이 글에 이미 댓글 있음"})
            print(f"[{datetime.datetime.now():%H:%M:%S}] ⏭ 이미 댓글 단 글 — 건너뜀: {(job.get('article_url') or '')[:50]}", flush=True)
            continue
        cc.sb_patch("cafe_comment_queue", {"id": f"eq.{jid}"}, {"status": "processing"})
        now = datetime.datetime.now().isoformat(timespec="seconds")
        print(f"[{datetime.datetime.now():%H:%M:%S}] 댓글 처리: {(job.get('article_url') or '')[:50]}", flush=True)
        try:
            url = cc.comment_job(job, cc.DEFAULT_CDP, no_send=NO_SEND)
            _last[0] = time.time()
            if NO_SEND:
                cc.sb_patch("cafe_comment_queue", {"id": f"eq.{jid}"}, {"status": "done", "done_at": now, "reason": "no_send(등록은 수동)"})
                print("  ✅ 입력 완료 — 브라우저에서 '등록' 눌러 게시하세요", flush=True)
            else:
                cc.sb_patch("cafe_comment_queue", {"id": f"eq.{jid}"}, {"status": "done", "done_at": now, "posted_url": url})
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
                cc.sb_patch("cafe_comment_queue", {"id": f"eq.{jid}"}, {"status": "fail", "reason": reason})
                print(f"  ❌ 실패 — {reason}", flush=True)


if __name__ == "__main__":
    main()
