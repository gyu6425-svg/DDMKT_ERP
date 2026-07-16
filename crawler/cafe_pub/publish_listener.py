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
KEEPALIVE_MIN = int(os.environ.get("CAFE_KEEPALIVE_MIN", "9"))  # 유휴 시 세션 유지 핑 간격(분)
_last_pub = [0.0]
_last_touch = [0.0]   # 크롬과 마지막 상호작용(발행/핑) 시각 — 세션 유지 판단용
_stopped = [False]    # CAFE_STOP_AT 지나 발행 중단됨(로그 1회만)
_EXPIRE_FLAG = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".session_expired")


def _keepalive():
    """유휴 중 네이버 세션 유지 — 같은 루프라 발행과 겹치지 않음. 만료면 경고+플래그(자동 재로그인 X)."""
    ok = pc.session_ping(pc.DEFAULT_CDP)
    _last_touch[0] = time.time()
    if ok is True:
        try:
            if os.path.exists(_EXPIRE_FLAG):
                os.remove(_EXPIRE_FLAG)   # 복구됨
        except Exception:
            pass
        print(f"[{datetime.datetime.now():%H:%M:%S}] 세션 유지 OK", flush=True)
    elif ok is False:
        try:
            open(_EXPIRE_FLAG, "w", encoding="utf-8").write(datetime.datetime.now().isoformat())
        except Exception:
            pass
        print(f"[{datetime.datetime.now():%H:%M:%S}] ⚠️ 네이버 세션 만료 — 크롬 9223 에서 재로그인 필요(자동 재로그인 안 함)", flush=True)
    else:
        print(f"[{datetime.datetime.now():%H:%M:%S}] (세션핑: 크롬 접속 실패 — run_chrome.bat 확인)", flush=True)


def _init_last_pub_from_db():
    """발행 간격을 DB(마지막 done_at) 기준으로 복원 — 리스너가 재시작돼도 간격이 리셋되지 않게.
    (인메모리만 쓰면 재시작 직후 곧바로 발행해 30분 간격이 깨진다.)"""
    try:
        rows = pc.sb_get("cafe_publish_queue",
                         {"status": "eq.done", "order": "done_at.desc", "limit": "1", "select": "done_at"})
        if not rows or not rows[0].get("done_at"):
            return
        # ⚠️ 이 리스너는 done_at 에 datetime.now()(KST, tz없음)를 넣는다. 컬럼이 timestamptz 라
        #    '벽시계값'이 UTC 로 라벨링돼 저장된다(2026-07-16T18:13:04+00:00 = 실제 18:13 KST).
        #    그래서 읽을 때도 tz 라벨을 버리고 '벽시계값 = 로컬(KST)'로 해석해야 맞다.
        #    (UTC 로 해석하면 9시간 미래가 돼 발행이 통째로 막힌다 — 2026-07-16 실제 사고)
        raw = rows[0]["done_at"].replace("Z", "+00:00")
        dt = datetime.datetime.fromisoformat(raw).replace(tzinfo=None)
        last = dt.timestamp()          # naive → 로컬(KST)로 해석
        now = time.time()
        if last > now + 60:            # 그래도 미래면 신뢰하지 않음(발행 막힘 방지)
            print(f"  (DB 마지막 발행 {dt:%H:%M} 이 미래 — 무시하고 즉시 발행 가능)", flush=True)
            return
        _last_pub[0] = last
        nxt = datetime.datetime.fromtimestamp(last + MIN_GAP_MIN * 60)
        print(f"  마지막 발행 {dt:%H:%M} (DB) → 다음 발행 가능 {nxt:%H:%M}", flush=True)
    except Exception as e:
        print(f"  (마지막 발행시각 복원 실패, 무시: {str(e)[:60]})", flush=True)


def _init_first_at():
    """CAFE_FIRST_AT=HH:MM 이면 첫 발행이 그 시각에 나도록 _last_pub 역산(이후엔 MIN_GAP 간격)."""
    fa = os.environ.get("CAFE_FIRST_AT", "").strip()
    if not fa:
        return
    try:
        hh, mm = (int(x) for x in fa.split(":"))
        now = datetime.datetime.now()
        target = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        _last_pub[0] = target.timestamp() - MIN_GAP_MIN * 60   # 첫 발행 = target 시각
        when = "지남 → 곧 발행" if target <= now else f"{target:%H:%M} 예정"
        print(f"  첫 발행 게이트: {fa} ({when})", flush=True)
    except Exception as e:
        print(f"  CAFE_FIRST_AT 파싱 실패({fa}): {e}", flush=True)


def main():
    if not pc.SUPABASE_URL or not pc.SUPABASE_KEY:
        print("SUPABASE_URL / SUPABASE_SERVICE_KEY 필요(../.env)", flush=True); sys.exit(1)
    mode = "수동보조(등록 직전까지)" if NO_SEND else "완전 자동(등록 클릭)"
    print(f"[카페 발행 리스너] cafe_publish_queue 폴링 {POLL_SEC}s · 간격 {MIN_GAP_MIN}분 · {mode} — Ctrl+C 종료", flush=True)
    _init_last_pub_from_db()   # 재시작해도 발행 간격 유지(DB 기준)
    _init_first_at()           # CAFE_FIRST_AT 지정 시 그 시각으로 덮어씀
    while True:
        try:
            reqs = pc.sb_get("cafe_publish_queue", {"status": "eq.pending", "order": "created_at.asc", "limit": "1", "select": "*"})
        except Exception as e:
            print(f"폴링 오류: {e}", flush=True); time.sleep(8); continue
        # 발행 종료 시각(CAFE_STOP_AT=HH:MM) 지나면 더 이상 발행하지 않음(세션 유지 핑만).
        stop_at = os.environ.get("CAFE_STOP_AT", "").strip()
        if stop_at and reqs:
            try:
                sh, sm = (int(x) for x in stop_at.split(":"))
                now_dt = datetime.datetime.now()
                if (now_dt.hour, now_dt.minute) >= (sh, sm):
                    if not _stopped[0]:
                        print(f"[{now_dt:%H:%M:%S}] ⏹ 발행 종료 시각({stop_at}) 지남 — 남은 {len(reqs)}건은 발행하지 않고 대기", flush=True)
                        _stopped[0] = True
                    time.sleep(POLL_SEC); continue
            except Exception:
                pass
        gap_wait = (not NO_SEND) and (time.time() - _last_pub[0]) < MIN_GAP_MIN * 60
        # 발행할 게 없거나(=유휴) 간격 대기 중이면 → 세션 유지 핑(주기적)
        if not reqs or gap_wait:
            if (time.time() - _last_touch[0]) >= KEEPALIVE_MIN * 60:
                _keepalive()
            time.sleep(POLL_SEC); continue

        job = reqs[0]; jid = job["id"]
        pc.sb_patch("cafe_publish_queue", {"id": f"eq.{jid}"}, {"status": "processing"})
        now = datetime.datetime.now().isoformat(timespec="seconds")
        print(f"[{datetime.datetime.now():%H:%M:%S}] 발행 처리: {job.get('title')}", flush=True)
        try:
            url = pc.publish_job(job, pc.DEFAULT_CDP, no_send=NO_SEND)
            _last_pub[0] = time.time(); _last_touch[0] = time.time()
            if NO_SEND:
                # 수동보조: 사람이 등록 클릭 → 다시 pending 로 두지 않고 'processing' 유지(중복 방지). 완료표시는 수동/후속.
                pc.sb_patch("cafe_publish_queue", {"id": f"eq.{jid}"}, {"status": "done", "done_at": now, "reason": "no_send(등록은 수동)"})
                print("  ✅ 채움 완료 — 브라우저에서 '등록' 눌러 발행하세요", flush=True)
            else:
                pc.sb_patch("cafe_publish_queue", {"id": f"eq.{jid}"}, {"status": "done", "done_at": now, "posted_url": url})
                print(f"  ✅ 발행 완료: {url}", flush=True)
        except Exception as e:
            reason = str(e)[:300]
            # 로그인 만료·크롬 꺼짐·일시적 페이지 지연은 '영구 실패'가 아니라 재시도 대상 →
            #   상태를 pending 으로 되돌려 두고(발행 요청 보존), 크롬/로그인 복구되면 자동 재개.
            retryable = any(k in reason for k in (
                "LOGIN_REQUIRED", "ECONNREFUSED", "connect_over_cdp", "제목 입력칸", "에디터 영역",
                "Timeout", "Target closed", "browserContext", "websocket",
            ))
            if retryable:
                pc.sb_patch("cafe_publish_queue", {"id": f"eq.{jid}"}, {"status": "pending", "reason": None})
                print(f"  ⏸ 크롬/로그인/일시오류 — 대기로 되돌림(복구되면 자동 발행): {reason[:90]}", flush=True)
                time.sleep(30)   # 백오프(복구 전까지 과도한 재시도 방지)
            else:
                pc.sb_patch("cafe_publish_queue", {"id": f"eq.{jid}"}, {"status": "fail", "reason": reason})
                print(f"  ❌ 실패 — {reason}", flush=True)


if __name__ == "__main__":
    main()
