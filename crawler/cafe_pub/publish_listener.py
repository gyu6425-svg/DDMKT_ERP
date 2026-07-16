# -*- coding: utf-8 -*-
"""
카페 발행 리스너 — 웹 '카페 발행' 버튼이 쌓은 큐(cafe_publish_queue)를 폴링해
네이버 카페(publish_cafe)로 발행한다. 카카오 send_listener 구조 복제.

흐름: 웹 버튼 → cafe_publish_queue(pending) → [이 리스너] publish_cafe.publish_job → done/fail
전제: run_chrome.bat(네이버 로그인 헤드리스 크롬, 포트 9223) 실행 중.

⚠️ 계정 안전: 저빈도 발행(간격 크게, 하루 소수). MIN_GAP_MIN 로 게시 간격 강제.
   기본 --no-send(수동보조/Phase1): '등록' 직전까지만. 완전 자동은 NO_SEND=0.

실행: python publish_listener.py
"""
import datetime
import os
import sys
import time

import publish_cafe as pc

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

POLL_SEC = 6
MIN_GAP_MIN = int(os.environ.get("CAFE_MIN_GAP_MIN", "20"))  # 발행 최소 간격(분) — 계정 안전
NO_SEND = os.environ.get("CAFE_NO_SEND", "1") != "0"        # 기본 수동보조(등록 직전까지)
_last_pub = [0.0]


def main():
    if not pc.SUPABASE_URL or not pc.SUPABASE_KEY:
        print("SUPABASE_URL / SUPABASE_SERVICE_KEY 필요(../.env)", flush=True); sys.exit(1)
    mode = "수동보조(등록 직전까지)" if NO_SEND else "완전 자동(등록 클릭)"
    print(f"[카페 발행 리스너] cafe_publish_queue 폴링 {POLL_SEC}s · 간격 {MIN_GAP_MIN}분 · {mode} — Ctrl+C 종료", flush=True)
    while True:
        try:
            reqs = pc.sb_get("cafe_publish_queue", {"status": "eq.pending", "order": "created_at.asc", "limit": "1", "select": "*"})
        except Exception as e:
            print(f"폴링 오류: {e}", flush=True); time.sleep(8); continue
        if not reqs:
            time.sleep(POLL_SEC); continue
        # 발행 간격 강제(계정 안전)
        if not NO_SEND and (time.time() - _last_pub[0]) < MIN_GAP_MIN * 60:
            time.sleep(POLL_SEC); continue

        job = reqs[0]; jid = job["id"]
        pc.sb_patch("cafe_publish_queue", {"id": f"eq.{jid}"}, {"status": "processing"})
        now = datetime.datetime.now().isoformat(timespec="seconds")
        print(f"[{datetime.datetime.now():%H:%M:%S}] 발행 처리: {job.get('title')}", flush=True)
        try:
            url = pc.publish_job(job, pc.DEFAULT_CDP, no_send=NO_SEND)
            _last_pub[0] = time.time()
            if NO_SEND:
                # 수동보조: 사람이 등록 클릭 → 다시 pending 로 두지 않고 'processing' 유지(중복 방지). 완료표시는 수동/후속.
                pc.sb_patch("cafe_publish_queue", {"id": f"eq.{jid}"}, {"status": "done", "done_at": now, "reason": "no_send(등록은 수동)"})
                print("  ✅ 채움 완료 — 브라우저에서 '등록' 눌러 발행하세요", flush=True)
            else:
                pc.sb_patch("cafe_publish_queue", {"id": f"eq.{jid}"}, {"status": "done", "done_at": now, "posted_url": url})
                print(f"  ✅ 발행 완료: {url}", flush=True)
        except Exception as e:
            reason = str(e)[:300]
            pc.sb_patch("cafe_publish_queue", {"id": f"eq.{jid}"}, {"status": "fail", "reason": reason})
            print(f"  ❌ 실패 — {reason}", flush=True)


if __name__ == "__main__":
    main()
