# -*- coding: utf-8 -*-
"""블로그 저장 리스너 — blog_save_queue 를 폴링해 **임시저장까지만** 처리한다 (SUB1 상시 가동).

상태머신: pending → processing → saved | fail
  ⚠️ 카페의 posted('등록 클릭됨 — 재시도 금지')·done 은 **없다**. 발행이 없으므로 되돌릴 수 없는
     중간 상태가 존재하지 않고, 그래서 좀비 복구도 단순하다(processing 은 언제든 pending 으로 복귀 안전).

구조는 crawler/cafe_pub/publish_listener.py 를 본떴지만 **복사**했다(docs/MERGE-SAFETY.md §3.2).
카페 파일은 import 하지도, 수정하지도 않는다.

[fail-closed]
  · BLOG_IDS 미설정 → 즉시 종료(exit 1). 남의 블로그 행을 집는 사고 방지. .bat 이 30초 뒤 재시작.
  · blog_selectors.CONFIRMED_ON 미설정 → save_blog 가 저장을 거부(SELECTORS_UNCONFIRMED).
  · BLOG_SAVE_ENABLED=1 을 .env 에 명시해야 실제 저장. 기본은 dry-run(찾기만 하고 안 누름).
"""
import datetime
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_common as bc          # noqa: E402
import save_blog as sv            # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

bc.load_env()
_DATA_DIR = os.path.dirname(os.path.abspath(__file__))

POLL_SEC = 6
MIN_GAP_MIN = int(os.environ.get("BLOG_MIN_GAP_MIN", "20"))
MAX_GAP_MIN = int(os.environ.get("BLOG_MAX_GAP_MIN", str(MIN_GAP_MIN)))
# 일일 저장 상한 — '저장이니까 무제한'은 금지. 차단축은 IP·볼륨·계정이지 공개 여부가 아니다.
#   임시저장에도 서버 POST·이미지 업로드가 그대로 발생한다.
DAILY_CAP = int(os.environ.get("BLOG_DAILY_CAP", "5"))
# 미검수 저장분 상한 — 네이버 임시저장 개수에는 한도가 있어, 큐가 사람 검수보다 빠르면 오래된 게 밀린다.
PENDING_DRAFT_CAP = int(os.environ.get("BLOG_PENDING_DRAFT_CAP", "10"))
KEEPALIVE_MIN = int(os.environ.get("BLOG_KEEPALIVE_MIN", "9"))
REAP_MIN = int(os.environ.get("BLOG_REAP_MIN", "30"))
MAX_ATTEMPTS = int(os.environ.get("BLOG_MAX_ATTEMPTS", "3"))
# 실제 저장 opt-in. 기본은 dry-run — 카페(CAFE_NO_SEND 기본 발행)와 정반대로 뒤집었다.
SAVE_ENABLED = os.environ.get("BLOG_SAVE_ENABLED", "0") == "1"

_CDP_PORT = sv.DEFAULT_CDP.rsplit(":", 1)[-1].split("/")[0]
_EXPIRE_FLAG = os.path.join(_DATA_DIR, f".session_expired_{_CDP_PORT}")

# ── 블로그 소유 필터 — 이 PC/프로필이 로그인해 둔 블로그 행만 집는다. ──
OWNED_BLOGS = [b.strip() for b in os.environ.get("BLOG_IDS", "").split(",") if b.strip()]
if not OWNED_BLOGS:
    print("BLOG_IDS 미설정 — 이 PC는 저장하지 않음(fail-closed). .env 에 담당 블로그 아이디를 지정하세요.", flush=True)
    sys.exit(1)

_gap_min = [float(MIN_GAP_MIN)]
_last_save = [0.0]
_last_touch = [0.0]
_capped = [False]
_draft_capped = [False]


def _roll_gap():
    lo, hi = min(MIN_GAP_MIN, MAX_GAP_MIN), max(MIN_GAP_MIN, MAX_GAP_MIN)
    _gap_min[0] = random.uniform(lo, hi) if hi > lo else float(lo)
    return _gap_min[0]


def _owned_filter():
    ins = ",".join('"' + b.replace('"', '') + '"' for b in OWNED_BLOGS)
    return {"blog_id": f"in.({ins})"}


def _now_iso():
    """saved_at/claimed_at 표기 — 카페와 같은 'naive KST 벽시계' 규약.
    ⚠️ 컬럼이 timestamptz 라 벽시계값이 UTC 로 라벨링돼 저장된다. 읽을 때 라벨을 버려 상쇄한다.
       청소기 cutoff 도 반드시 같은 규약이어야 9시간 skew 가 생기지 않는다(카페 2026-07-16 사고)."""
    return datetime.datetime.now().isoformat(timespec="seconds")


def _saved_today():
    if DAILY_CAP <= 0:
        return 0
    today0 = datetime.datetime.now().strftime("%Y-%m-%dT00:00:00")
    try:
        rows = bc.sb_get("blog_save_queue",
                         {"status": "eq.saved", **_owned_filter(),
                          "saved_at": f"gte.{today0}", "select": "id"})
        return len(rows)
    except Exception:
        return 0


def _unreviewed_drafts():
    """아직 사람이 발행하지 않은 저장분 수(=saved 상태 누적). 네이버 임시저장 한도 보호용.
    ⚠️ 근사치다 — 사람이 발행해도 여기서는 알 수 없다(발행을 추적하지 않기로 한 설계의 대가).
       사람이 검수 후 이 행들을 UI 에서 정리하면 카운트가 준다."""
    try:
        rows = bc.sb_get("blog_save_queue", {"status": "eq.saved", **_owned_filter(), "select": "id"})
        return len(rows)
    except Exception:
        return 0


def _keepalive():
    ok = sv.session_ping(sv.DEFAULT_CDP)
    _last_touch[0] = time.time()
    if ok is True:
        try:
            if os.path.exists(_EXPIRE_FLAG):
                os.remove(_EXPIRE_FLAG)
        except Exception:
            pass
        print(f"[{datetime.datetime.now():%H:%M:%S}] 세션 유지 OK", flush=True)
    elif ok is False:
        try:
            open(_EXPIRE_FLAG, "w", encoding="utf-8").write(datetime.datetime.now().isoformat())
        except Exception:
            pass
        print(f"[{datetime.datetime.now():%H:%M:%S}] ⚠️ 네이버 세션 만료 — 크롬({_CDP_PORT})에서 재로그인 필요"
              f"(자동 재로그인 안 함: 캡차/2FA/계정잠금 위험)", flush=True)
    else:
        print(f"[{datetime.datetime.now():%H:%M:%S}] (세션핑: 크롬 접속 실패 — run_chrome_blog.bat 확인)", flush=True)


def _init_last_save_from_db():
    """저장 간격을 DB(마지막 saved_at) 기준으로 복원 — 재시작해도 간격이 리셋되지 않게."""
    try:
        rows = bc.sb_get("blog_save_queue",
                         {"status": "eq.saved", **_owned_filter(),
                          "order": "saved_at.desc.nullslast", "limit": "1", "select": "saved_at"})
        if not rows or not rows[0].get("saved_at"):
            return
        raw = rows[0]["saved_at"].replace("Z", "+00:00")
        dt = datetime.datetime.fromisoformat(raw).replace(tzinfo=None)   # tz 라벨 버림 = 벽시계 KST
        last = dt.timestamp()
        if last > time.time() + 60:
            print(f"  (DB 마지막 저장 {dt:%H:%M} 이 미래 — 무시)", flush=True)
            return
        _last_save[0] = last
        nxt = datetime.datetime.fromtimestamp(last + MIN_GAP_MIN * 60)
        print(f"  마지막 저장 {dt:%H:%M} (DB) → 다음 저장 가능 {nxt:%H:%M}", flush=True)
    except Exception as e:
        print(f"  (마지막 저장시각 복원 실패, 무시: {str(e)[:60]})", flush=True)


def _safe_mark(jid, payload):
    """결과 기록 — best-effort. 실패해도 예외를 던지지 않는다(원래 오류를 가리지 않게)."""
    try:
        bc.sb_patch("blog_save_queue", {"id": f"eq.{jid}"}, payload)
    except Exception as e:
        print(f"  (상태기록 실패 무시: {str(e)[:60]})", flush=True)


def _reap_stale():
    """processing 인 채 REAP_MIN 넘게 방치된 좀비를 pending 으로 되돌린다.
    불변식: processing 은 저장 완료 전 상태다. 임시저장은 되돌릴 수 있으므로 되살려도 안전하다.
    (같은 제목이 실제로 두 번 저장돼도 사람이 검수 단계에서 지운다 — 발행처럼 되돌릴 수 없지 않다.)"""
    try:
        cutoff = (datetime.datetime.now() - datetime.timedelta(minutes=REAP_MIN)).isoformat(timespec="seconds")
        stale = bc.sb_get("blog_save_queue",
                          {"status": "eq.processing", "claimed_at": f"lt.{cutoff}",
                           **_owned_filter(), "select": "id,title"})
        for r in stale or []:
            got = bc.sb_patch("blog_save_queue",
                              {"id": f"eq.{r['id']}", "claimed_at": f"lt.{cutoff}"},
                              {"status": "pending", "reason": "reaped(중단 감지 — 재저장 대기)"},
                              expect="processing")
            if got:
                print(f"  ♻ 좀비 복구(processing→pending): {(r.get('title') or '')[:40]}", flush=True)
    except Exception as e:
        print(f"  (청소기 오류 무시: {str(e)[:60]})", flush=True)


def main():
    if not bc.auth_ready():
        print("Supabase 인증 미비 — SUPABASE_URL + (SUPABASE_SERVICE_KEY 또는 "
              "SUPABASE_PUBLISHABLE_KEY+SUPABASE_AUTH_EMAIL+SUPABASE_AUTH_PASSWORD) 필요", flush=True)
        sys.exit(1)
    mode = "실제 임시저장" if SAVE_ENABLED else "DRY-RUN(저장 버튼 안 누름)"
    print(f"[블로그 저장 리스너] blog_save_queue 폴링 {POLL_SEC}s · 간격 {MIN_GAP_MIN}분 · "
          f"일일상한 {DAILY_CAP} · 담당 {OWNED_BLOGS} · {mode} — Ctrl+C 종료", flush=True)
    if not SAVE_ENABLED:
        print("  ⓘ 실제 저장하려면 .env 에 BLOG_SAVE_ENABLED=1 을 명시하세요(기본은 안전한 dry-run).", flush=True)
    _init_last_save_from_db()

    while True:
        try:
            reqs = bc.sb_get("blog_save_queue",
                             {"status": "eq.pending", **_owned_filter(),
                              "order": "created_at.asc", "limit": "1", "select": "*"})
        except Exception as e:
            print(f"폴링 오류: {e}", flush=True)
            time.sleep(8)
            continue

        # 실행 시간대 — main PC 의 크롤 윈도우(01:00~09:45)와 겹치지 않게 기본 10:00~23:00.
        #   같은 사무실=같은 공인 IP 라 크롤과 쓰기 트래픽이 겹치면 계정 리스크가 커진다.
        start_at = os.environ.get("BLOG_START_AT", "10:00").strip()
        stop_at = os.environ.get("BLOG_STOP_AT", "23:00").strip()
        if reqs and (start_at or stop_at):
            now_dt = datetime.datetime.now()
            try:
                if start_at:
                    th, tm = (int(x) for x in start_at.split(":"))
                    if (now_dt.hour, now_dt.minute) < (th, tm):
                        time.sleep(POLL_SEC)
                        continue
                if stop_at:
                    sh, sm = (int(x) for x in stop_at.split(":"))
                    if (now_dt.hour, now_dt.minute) >= (sh, sm):
                        time.sleep(POLL_SEC)
                        continue
            except Exception:
                pass

        if reqs and DAILY_CAP > 0 and _saved_today() >= DAILY_CAP:
            if not _capped[0]:
                print(f"[{datetime.datetime.now():%H:%M:%S}] ⏸ 오늘 저장 상한({DAILY_CAP}건) 도달 — 남은 {len(reqs)}건 내일", flush=True)
                _capped[0] = True
            time.sleep(POLL_SEC)
            continue
        _capped[0] = False

        if reqs and PENDING_DRAFT_CAP > 0 and _unreviewed_drafts() >= PENDING_DRAFT_CAP:
            if not _draft_capped[0]:
                print(f"[{datetime.datetime.now():%H:%M:%S}] ⏸ 미검수 저장분 {PENDING_DRAFT_CAP}건 누적 — "
                      f"네이버 임시저장 한도 보호를 위해 대기합니다. 검수 후 UI 에서 정리하세요.", flush=True)
                _draft_capped[0] = True
            time.sleep(POLL_SEC)
            continue
        _draft_capped[0] = False

        gap_wait = SAVE_ENABLED and (time.time() - _last_save[0]) < _gap_min[0] * 60
        if not reqs or gap_wait:
            _reap_stale()
            if (time.time() - _last_touch[0]) >= KEEPALIVE_MIN * 60:
                try:
                    _keepalive()
                except Exception as e:
                    print(f"  (세션핑 오류 무시: {str(e)[:60]})", flush=True)
            time.sleep(POLL_SEC)
            continue

        _reap_stale()
        job = reqs[0]
        jid = job["id"]
        try:
            claimed = bc.sb_patch("blog_save_queue", {"id": f"eq.{jid}", **_owned_filter()},
                                  {"status": "processing", "claimed_at": _now_iso()}, expect="pending")
        except Exception as e:
            print(f"  (claim 실패 — 8s 후 재시도: {str(e)[:60]})", flush=True)
            time.sleep(8)
            continue
        if not claimed:
            continue

        print(f"[{datetime.datetime.now():%H:%M:%S}] 저장 처리: {job.get('title')}", flush=True)
        try:
            seq = sv.save_job(job, sv.DEFAULT_CDP, dry_run=not SAVE_ENABLED)
            _last_save[0] = time.time()
            _last_touch[0] = time.time()
            g = _roll_gap()
            print(f"  다음 저장 간격 {g:.0f}분 → {datetime.datetime.now() + datetime.timedelta(minutes=g):%H:%M} 이후", flush=True)
            if SAVE_ENABLED:
                _safe_mark(jid, {"status": "saved", "saved_at": _now_iso(), "draft_seq": seq, "reason": None})
                print(f"  ✅ 임시저장 완료(저장 {seq}) — 블로그 임시저장함에서 검수 후 사람이 발행하세요", flush=True)
            else:
                _safe_mark(jid, {"status": "fail", "reason": "dry_run(저장 안 함) — BLOG_SAVE_ENABLED=1 필요"})
                print("  ⓘ DRY-RUN: 저장 버튼을 찾기만 하고 누르지 않았습니다.", flush=True)
        except bc.GuardTripped as e:
            # 발행 가드가 실제로 발동 = 어딘가에 발행 경로가 생겼다는 뜻. 조용히 넘기면 안 된다.
            _safe_mark(jid, {"status": "fail", "reason": f"🔴 {str(e)[:280]}"})
            print(f"  🔴🔴 발행 가드 발동 — 즉시 코드 점검 필요: {str(e)[:150]}", flush=True)
        except bc.ContentError as e:
            _safe_mark(jid, {"status": "fail", "reason": str(e)[:300]})
            print(f"  ❌ 원고 결함 — 저장 안 함: {str(e)[:90]}", flush=True)
        except Exception as e:
            reason = str(e)
            # 환경 미비(크롬 꺼짐/로그인 만료/셀렉터 미확정) = attempts 안 올리고 대기 → 고치면 자동 재개.
            env_not_ready = any(k in reason for k in (
                "LOGIN_REQUIRED", "ECONNREFUSED", "connect_over_cdp", "browserContext", "websocket",
                "Target closed", "has been closed", "Browser closed", "Connection closed", "Protocol error",
                "net::ERR_", "BLOG_URL_MISSING", "SELECTORS_UNCONFIRMED", "BLOG_ID_MISMATCH"))
            # RESTORE_POPUP: 복원 팝업을 못 닫음. 새 goto 로 다시 뜬 팝업이 잡힐 수 있으니
            #   재시도 대상(상한 넘으면 fail 로 떨어져 사람이 본다).
            job_transient = any(k in reason for k in (
                "Timeout", "timed out", "제목 입력칸", "에디터 영역", "저장 확인 실패",
                "에디터를 비우지", "RESTORE_POPUP"))
            if env_not_ready:
                _safe_mark(jid, {"status": "pending", "reason": None})
                print(f"  ⏸ 환경/설정 오류 — 대기로 되돌림(고치면 자동 재개): {reason[:110]}", flush=True)
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
    #   (카페 2026-07-20: 대화상자 핸들러 예외로 리스너가 통째로 죽어 ~16시간 방치된 사고)
    while True:
        try:
            main()
        except KeyboardInterrupt:
            print("종료합니다.", flush=True)
            break
        except SystemExit:
            raise                      # 자격증명/BLOG_IDS 누락 등 '정상 종료'는 되살리지 않는다
        except Exception as e:
            print(f"[치명적] 저장 리스너 예외 — 20초 뒤 재시작: {str(e)[:200]}", flush=True)
            time.sleep(20)
