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
import random
import sys
import time

import publish_cafe as pc

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

POLL_SEC = 6
MIN_GAP_MIN = int(os.environ.get("CAFE_MIN_GAP_MIN", "20"))  # 발행 최소 간격(분) — 계정 안전
# 최대 간격 — MIN~MAX 사이에서 매번 새로 뽑아 발행 간격을 불규칙하게 만든다(같은 간격 반복은 봇 티가 남).
#   미설정이면 MIN 과 같아 기존처럼 고정 간격으로 동작(하위호환).
MAX_GAP_MIN = int(os.environ.get("CAFE_MAX_GAP_MIN", str(MIN_GAP_MIN)))
_gap_min = [float(MIN_GAP_MIN)]   # 이번 회차에 적용할 간격(분) — 발행할 때마다 재추첨


def _roll_gap():
    """다음 발행까지 기다릴 간격을 MIN~MAX 에서 새로 뽑는다."""
    lo, hi = min(MIN_GAP_MIN, MAX_GAP_MIN), max(MIN_GAP_MIN, MAX_GAP_MIN)
    _gap_min[0] = random.uniform(lo, hi) if hi > lo else float(lo)
    return _gap_min[0]
NO_SEND = os.environ.get("CAFE_NO_SEND", "1") != "0"        # 기본 수동보조(등록 직전까지)
KEEPALIVE_MIN = int(os.environ.get("CAFE_KEEPALIVE_MIN", "9"))  # 유휴 시 세션 유지 핑 간격(분)
# 청소기: processing 인 채 이 시간(분) 넘게 방치된 행 = 죽은 프로세스가 남긴 좀비 → pending 으로 되돌림.
#   실제 작성 최악(CAFE_MAX_SECONDS 13분 + 이미지 업로드·링크 재시도·인용구/서식 패스)을 넉넉히 넘겨 30분.
REAP_MIN = int(os.environ.get("CAFE_REAP_MIN", "30"))
MAX_ATTEMPTS = int(os.environ.get("CAFE_MAX_ATTEMPTS", "3"))    # 원고결함성 재시도 상한 → 넘으면 fail
STUCK_POSTED_MIN = int(os.environ.get("CAFE_STUCK_POSTED_MIN", "20"))  # posted 로 이만큼 방치되면 사람에게 경고(자동 재발행 X)
_EXPIRE_FLAG_STR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".session_expired")

# ── 게시판 소유 필터 — 여러 PC가 같은 카페를 게시판별로 나눠 발행(작업분담·중복회피). 2026-07-21 독립검증 ──
#   CAFE_BOARDS="누수" 처럼 이 PC가 맡을 게시판 이름을 콤마로 나열 → 소유 게시판 행만 집는다.
#   미설정이면 fail-closed(발행 안 함) — 잘못 집어 오발행하느니 안 집는다. .bat 이 30초 뒤 재시작.
#   CAFE_CLAIM_NULL_BOARD=1 : board 가 비어 있는(레거시/자동) 행도 이 PC가 집는다.
#     ▶ 반드시 '한 대'에만 켠다(그 PC의 CAFE_BOARD 폴백 게시판으로 나가므로). 다PC 시 오발행 위험.
OWNED_BOARDS = [b.strip() for b in os.environ.get("CAFE_BOARDS", "").split(",") if b.strip()]
CLAIM_NULL_BOARD = os.environ.get("CAFE_CLAIM_NULL_BOARD", "0") == "1"
if not OWNED_BOARDS and not CLAIM_NULL_BOARD:
    print("CAFE_BOARDS 미설정 — 이 PC는 발행하지 않음(fail-closed). .env 에 소유 게시판을 지정하세요.", flush=True)
    sys.exit(1)


def _owned_filter():
    """게시판 소유 PostgREST 필터. poll·claim 두 곳에 병합해 자기 게시판 행만 집게 한다.
      · or= 는 다른 top-level 필터(id=eq, status=eq)와 AND 로 결합되므로 안전."""
    if OWNED_BOARDS:
        ins = ",".join('"' + b.replace('"', '') + '"' for b in OWNED_BOARDS)
        if CLAIM_NULL_BOARD:
            return {"or": f"(board.in.({ins}),board.is.null)"}
        return {"board": f"in.({ins})"}
    return {"board": "is.null"}   # CLAIM_NULL_BOARD 만 켠 PC = board 없는 행 전담


def _now_iso():
    """done_at/claimed_at 표기 — 기존 코드와 동일한 'naive KST 벽시계' 규약.
    ⚠️ DB now()/UTC 를 쓰면 안 된다. 저장은 KST 벽시계값을 UTC 라벨로 넣고, 읽을 때 라벨을 버려 상쇄한다.
       청소기 cutoff 도 반드시 이 규약과 같아야 9시간 skew 가 상쇄된다."""
    return datetime.datetime.now().isoformat(timespec="seconds")
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
        # done 뿐 아니라 posted(등록됐으나 done 확정 전)도 '발행됨'으로 쳐서 간격을 지킨다.
        rows = pc.sb_get("cafe_publish_queue",
                         {"status": "in.(done,posted)", "order": "done_at.desc.nullslast", "limit": "1", "select": "done_at,claimed_at"})
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


def _safe_mark(jid, payload, expect=None):
    """상태 기록 — best-effort. 실패해도 예외를 던지지 않는다(원래 발행 오류를 가리지 않게).
    ⚠️ 잠금/등록직전 CAS 가 아니라 '결과 기록'용이므로 expect 없이 호출(조용히 실패 허용)."""
    try:
        pc.sb_patch("cafe_publish_queue", {"id": f"eq.{jid}"}, payload, expect=expect)
    except Exception as e:
        print(f"  (상태기록 실패 무시: {str(e)[:60]})", flush=True)


def _reap_stale():
    """processing 인 채 REAP_MIN 넘게 방치된 좀비 행을 pending 으로 되돌린다.
    불변식: processing = 등록 클릭 전. 그래서 되살려도 중복 발행이 아니다. posted/done 은 절대 건드리지 않는다.
    cutoff 는 _now_iso 와 같은 naive-KST 규약이어야 9시간 skew 가 상쇄된다."""
    try:
        cutoff = (datetime.datetime.now() - datetime.timedelta(minutes=REAP_MIN)).isoformat(timespec="seconds")
        stale = pc.sb_get("cafe_publish_queue",
                          {"status": "eq.processing", "claimed_at": f"lt.{cutoff}", "select": "id,title"})
        for r in stale or []:
            got = pc.sb_patch("cafe_publish_queue",
                              {"id": f"eq.{r['id']}", "claimed_at": f"lt.{cutoff}"},
                              {"status": "pending", "reason": "reaped(중단 감지 — 재발행 대기)"}, expect="processing")
            if got:
                print(f"  ♻ 좀비 복구(processing→pending): {(r.get('title') or '')[:40]}", flush=True)
    except Exception as e:
        print(f"  (청소기 오류 무시: {str(e)[:60]})", flush=True)


def _warn_stuck_posted():
    """posted 로 STUCK_POSTED_MIN 넘게 남은 행 경고 — 등록됐을 수 있으나 done 확정 안 됨.
    ⚠️ 절대 자동 재발행하지 않는다(중복 방지). 사람이 카페 확인 후 done/fail 로 정리해야 한다."""
    try:
        cutoff = (datetime.datetime.now() - datetime.timedelta(minutes=STUCK_POSTED_MIN)).isoformat(timespec="seconds")
        stuck = pc.sb_get("cafe_publish_queue",
                          {"status": "eq.posted", "claimed_at": f"lt.{cutoff}", "select": "id,title"})
        for r in stuck or []:
            print(f"  ⚠️ 확인 필요(posted 방치): '{(r.get('title') or '')[:40]}' — 카페 게시 여부 확인 후 done/fail 처리", flush=True)
    except Exception:
        pass


def main():
    if not pc.SUPABASE_URL or not pc.SUPABASE_KEY:
        print("SUPABASE_URL / SUPABASE_SERVICE_KEY 필요(../.env)", flush=True); sys.exit(1)
    mode = "수동보조(등록 직전까지)" if NO_SEND else "완전 자동(등록 클릭)"
    print(f"[카페 발행 리스너] cafe_publish_queue 폴링 {POLL_SEC}s · 간격 {MIN_GAP_MIN}분 · {mode} — Ctrl+C 종료", flush=True)
    _init_last_pub_from_db()   # 재시작해도 발행 간격 유지(DB 기준)
    _init_first_at()           # CAFE_FIRST_AT 지정 시 그 시각으로 덮어씀
    while True:
        try:
            reqs = pc.sb_get("cafe_publish_queue", {"status": "eq.pending", **_owned_filter(), "order": "created_at.asc", "limit": "1", "select": "*"})
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
        gap_wait = (not NO_SEND) and (time.time() - _last_pub[0]) < _gap_min[0] * 60
        # 발행할 게 없거나(=유휴) 간격 대기 중이면 → 좀비/stuck 점검 + 세션 유지 핑(주기적)
        if not reqs or gap_wait:
            _reap_stale()          # 죽은 프로세스가 남긴 processing 좀비 복구
            _warn_stuck_posted()   # 등록됐는데 done 확정 안 된 행 경고
            if (time.time() - _last_touch[0]) >= KEEPALIVE_MIN * 60:
                try:
                    _keepalive()
                except Exception as e:
                    print(f"  (세션핑 오류 무시: {str(e)[:60]})", flush=True)
            time.sleep(POLL_SEC); continue

        _reap_stale(); _warn_stuck_posted()
        job = reqs[0]; jid = job["id"]
        # ── CAS 잠금: pending 일 때만 processing 으로. 못 이기면(다른 워커/상태변동) 이 행은 건너뛴다. ──
        try:
            claimed = pc.sb_patch("cafe_publish_queue", {"id": f"eq.{jid}", **_owned_filter()},
                                  {"status": "processing", "claimed_at": _now_iso()}, expect="pending")
        except Exception as e:
            print(f"  (claim 실패 — 8s 후 재시도: {str(e)[:60]})", flush=True); time.sleep(8); continue
        if not claimed:
            continue   # 다른 워커가 가져갔거나 이미 상태가 바뀜 → 다음 폴링

        print(f"[{datetime.datetime.now():%H:%M:%S}] 발행 처리: {job.get('title')}", flush=True)

        def _mark_posted():
            # 등록 클릭 '직전' 콜백 — processing→posted CAS. 못 이기면 raise → publish 가 클릭하지 않는다(중복 방지).
            got = pc.sb_patch("cafe_publish_queue", {"id": f"eq.{jid}"},
                              {"status": "posted", "reason": "등록 클릭 — 확인 대기"}, expect="processing")
            if not got:
                raise RuntimeError("posted 마킹 실패(상태 변동) — 등록 취소")

        try:
            url = pc.publish_job(job, pc.DEFAULT_CDP, no_send=NO_SEND,
                                 on_submit=(None if NO_SEND else _mark_posted))
            _last_pub[0] = time.time(); _last_touch[0] = time.time()
            g = _roll_gap()
            nxt = datetime.datetime.now() + datetime.timedelta(minutes=g)
            print(f"  다음 발행 간격 {g:.0f}분 → {nxt:%H:%M} 이후", flush=True)
            done_now = _now_iso()   # ⚠️ 발행 '완료' 시각으로 다시 계산(작성에 5~13분 걸리므로 시작시각을 쓰면 간격이 틀어진다)
            if NO_SEND:
                _safe_mark(jid, {"status": "done", "done_at": done_now, "reason": "no_send(등록은 수동)"})
                print("  ✅ 채움 완료 — 브라우저에서 '등록' 눌러 발행하세요", flush=True)
            else:
                _safe_mark(jid, {"status": "done", "done_at": done_now, "posted_url": url})
                print(f"  ✅ 발행 완료: {url}", flush=True)
        except pc.PostClickError as e:
            # 등록을 이미 눌렀다 → 글이 올라갔을 수 있으므로 절대 재시도하지 않는다. posted 로 두고 사람이 확인.
            _safe_mark(jid, {"status": "posted", "reason": str(e)[:300]})
            print(f"  ⚠️ 등록됐을 수 있음 — 재시도 안 함(사람 확인 필요): {str(e)[:90]}", flush=True)
        except (pc.ContentError, pc.BoardError) as e:
            # 원고/게시판 결함 — 재시도해도 소용없고 등록 전에 멈췄으므로 그냥 실패.
            _safe_mark(jid, {"status": "fail", "reason": str(e)[:300]})
            print(f"  ❌ 원고/게시판 결함 — 발행 안 함: {str(e)[:90]}", flush=True)
        except Exception as e:
            reason = str(e)
            # 환경 미비(크롬 꺼짐/로그인 만료/CDP 끊김) = 시도 횟수 안 올리고 무한 대기(복구되면 자동 재개).
            env_not_ready = any(k in reason for k in (
                "LOGIN_REQUIRED", "ECONNREFUSED", "connect_over_cdp", "browserContext", "websocket",
                "Target closed", "has been closed", "Browser closed", "Connection closed", "Protocol error", "net::ERR_",
                "CAFE_URL_MISSING"))
            # 원고성 일시오류(페이지 지연 등) = 시도 횟수 누적, MAX 넘으면 포기.
            job_transient = any(k in reason for k in (
                "Timeout", "timed out", "제목 입력칸", "에디터 영역", "posted 마킹 실패"))
            if env_not_ready:
                _safe_mark(jid, {"status": "pending", "reason": None})   # attempts 안 올림
                print(f"  ⏸ 크롬/로그인/CDP 오류 — 대기로 되돌림(복구되면 자동 발행): {reason[:90]}", flush=True)
                time.sleep(30)
            elif job_transient:
                n = int(job.get("attempts") or 0) + 1
                if n >= MAX_ATTEMPTS:
                    _safe_mark(jid, {"status": "fail", "reason": f"{n}회 재시도 실패: {reason[:200]}"})
                    print(f"  ❌ {n}회 실패 — 포기: {reason[:80]}", flush=True)
                else:
                    _safe_mark(jid, {"status": "pending", "reason": None, "attempts": n})
                    print(f"  ⏸ 일시오류({n}/{MAX_ATTEMPTS}) — 대기: {reason[:80]}", flush=True)
                    time.sleep(30)
            else:
                _safe_mark(jid, {"status": "fail", "reason": reason[:300]})
                print(f"  ❌ 실패 — {reason[:120]}", flush=True)


if __name__ == "__main__":
    # 감시 루프 — main() 이 예외로 빠져나가도 프로세스가 죽지 않고 되살아난다.
    #   (2026-07-20 사고: publish_cafe._on_dialog 가 'No dialog is showing' 으로 크래시 →
    #    리스너가 통째로 죽었는데 감시 장치가 없어 ~16시간 방치됐다. _on_dialog 자체는
    #    이후 try/except 로 막혔지만, '다른 이유로 죽어도 살아나는' 안전망은 여기서 보장한다.
    #    run_cafe_listener.bat 의 :loop 는 프로세스가 통째로 사라졌을 때의 2차 방어선이다.)
    while True:
        try:
            main()
        except KeyboardInterrupt:
            print("종료합니다.", flush=True); break
        except SystemExit:
            raise                      # 자격증명 누락 등 '정상 종료'는 되살리지 않는다
        except Exception as e:
            print(f"[치명적] 발행 리스너 예외 — 20초 뒤 재시작: {str(e)[:200]}", flush=True)
            time.sleep(20)
