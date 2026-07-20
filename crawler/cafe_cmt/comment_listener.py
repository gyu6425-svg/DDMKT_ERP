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
import re
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
# 후보 조회 폭. 좁으면(예전 10) 한 계정의 밀린 작업이 창을 다 차지해 다른 계정 작업이
#   아예 보이지 않는 교착이 생긴다(측정상 답글 10건이면 댓글이 통째로 굶음).
BATCH = int(os.environ.get("CAFE_CMT_BATCH", "60"))
MAX_TRY = int(os.environ.get("CAFE_CMT_MAX_TRY", "5"))            # 재시도 한도(초과 시 영구 실패)
RETRY_BACKOFF_MIN = float(os.environ.get("CAFE_CMT_RETRY_BACKOFF_MIN", "3"))
RETRY_TAG = "재시도 "                                              # reason 에 남겨 횟수를 추적
MIN_GAP_MIN = int(os.environ.get("CAFE_CMT_MIN_GAP_MIN", "20"))    # 댓글 최소 간격(분) — 계정별
# 답글 전용 계정(글 작성자)의 간격 — 자기 글 관리라 짧게 둬도 자연스럽다.
REPLY_GAP_MIN = int(os.environ.get("CAFE_CMT_REPLY_GAP_MIN", "10"))
REPLY_ACCOUNTS = {x.strip().lower() for x in
                  os.environ.get("CAFE_CMT_REPLY_ACCOUNT", "rlawhddls25").split(",") if x.strip()}
NO_SEND = os.environ.get("CAFE_CMT_NO_SEND", "1") != "0"           # 기본 수동보조(등록 직전까지)
# 작업 정지 시간대(HH:MM-HH:MM). 두 가지 이유로 둔다.
#   1) 다른 PC의 전체크롤이 평일 03:00~09:00 에 돌아, 겹치지 않게 비워둔다(docs/크롤링-운영.md).
#   2) 새벽 4시에 댓글이 달리는 것 자체가 부자연스럽다.
#   이 시간엔 게시만 멈추고 큐는 그대로 쌓인다(끝나면 이어서 처리).
QUIET = os.environ.get("CAFE_CMT_QUIET", "03:00-09:00").strip()
_last = {}                                                        # 계정별 마지막 게시 시각(멀티계정 처리량 확보)


def _port_open(port, timeout=1.0):
    """해당 계정의 크롬 CDP 포트가 살아있는지. 죽은 계정 작업은 건너뛰어 다른 계정이 굶지 않게 한다."""
    try:
        with socket.create_connection(("127.0.0.1", int(port)), timeout=timeout):
            return True
    except Exception:
        return False


def _in_quiet(now=None):
    """지금이 정지 시간대인가. 자정을 넘는 구간(예: 23:00-06:00)도 지원."""
    if not QUIET or "-" not in QUIET:
        return False
    try:
        s, e = [x.strip() for x in QUIET.split("-", 1)]
        sh, sm = [int(x) for x in s.split(":")]
        eh, em = [int(x) for x in e.split(":")]
    except Exception:
        return False
    n = now or datetime.datetime.now()
    cur = n.hour * 60 + n.minute
    a, b = sh * 60 + sm, eh * 60 + em
    return (a <= cur < b) if a <= b else (cur >= a or cur < b)


def _patch_safe(jid, payload):
    """상태 기록(치명적이지 않은 것) — 실패해도 프로세스를 죽이지 않는다.

    ⚠️ sb_patch 는 중복 게시를 막으려고 '예외를 올리도록' 바뀌었다. 그런데 processing 표시나
       실패 기록처럼 except 블록/루프 본문에서 부르는 곳까지 그대로 두면, 수파베이스가 20초만
       끊겨도 예외가 main() 밖으로 나가 **리스너가 통째로 종료**된다(bat 에 감시 루프도 없어
       재부팅 전까지 댓글이 멈춘다). 그런 자리에는 이 함수를 쓴다.
       (게시 직후 done 기록만은 sb_patch 를 그대로 써서 호출부가 알아채게 둔다)"""
    try:
        cc.sb_patch("cafe_comment_queue", {"id": f"eq.{jid}"}, payload)
        return True
    except Exception as e:
        print(f"  ❗ 상태기록 실패(계속 진행): {str(e)[:110]}", flush=True)
        return False


def _fail(jid, reason):
    _patch_safe(jid, {"status": "fail", "reason": reason})


def _try_count(job):
    """이 작업이 지금까지 몇 번 재시도됐는지 — reason 에 남긴 '재시도 N/M' 을 읽는다.
    (별도 컬럼을 추가하지 않으려고 reason 을 그대로 쓴다)"""
    m = re.match(RETRY_TAG + r"(\d+)/", (job.get("reason") or ""))
    return int(m.group(1)) if m else 0


def main():
    if not cc.SUPABASE_URL or not cc.SUPABASE_KEY:
        print("SUPABASE_URL / SUPABASE_SERVICE_KEY 필요(../.env)", flush=True); sys.exit(1)
    mode = "수동보조(등록 직전까지)" if NO_SEND else "완전 자동(등록 클릭)"
    names = ", ".join(f"{a['name']}:{a['port']}" for a in acct.load_accounts())
    print(f"[카페 댓글 리스너] 폴링 {POLL_SEC}s · 계정별 간격 {MIN_GAP_MIN}분 · {mode} · 중복범위 {cc.DEDUP_SCOPE}", flush=True)
    print(f"  계정: {names} — Ctrl+C 종료", flush=True)

    quiet_logged = False
    while True:
        if _in_quiet():
            if not quiet_logged:
                print(f"[{datetime.datetime.now():%H:%M}] ⏸ 정지 시간대({QUIET}) — 게시 보류(큐는 유지). "
                      f"다른 PC 전체크롤과 겹치지 않게 비워둡니다.", flush=True)
                quiet_logged = True
            time.sleep(60)
            continue
        if quiet_logged:
            print(f"[{datetime.datetime.now():%H:%M}] ▶ 정지 시간대 종료 — 작업 재개", flush=True)
            quiet_logged = False
        try:
            # 예약시각이 아직 안 된 작업은 '서버에서' 빼고 가져온다. 클라이언트에서만 건너뛰면
            #   뒤로 미뤄둔 작업들이 (created_at 이 옛날이라) 조회창 앞자리를 계속 차지해
            #   BATCH 를 60 으로 늘려도 새 작업이 안 보이는 구간이 남는다.
            reqs = cc.sb_get("cafe_comment_queue", {
                "status": "eq.pending",
                "or": f"(scheduled_at.is.null,scheduled_at.lte.{datetime.datetime.now().astimezone().isoformat(timespec='seconds')})",
                "order": "scheduled_at.asc.nullsfirst,created_at.asc",
                "limit": str(BATCH), "select": "*",
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
            # 계정별 간격(완전 자동일 때만).
            #   답글 전용 계정(글 작성자)은 자기 글에 답하는 것이라 빈도 제약이 덜해 간격을 짧게 둔다.
            #   안 그러면 답글 생성(글당 2개)이 처리량(20분당 1건)을 넘어 백로그가 무한히 쌓인다.
            gap = REPLY_GAP_MIN if a["name"].lower() in REPLY_ACCOUNTS else MIN_GAP_MIN
            if not NO_SEND and (time.time() - _last.get(a["name"], 0.0)) < gap * 60:
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

        _patch_safe(jid, {"status": "processing"})
        # astimezone(): 오프셋을 붙여야 DB(timestamptz)가 UTC 로 오해하지 않는다.
        #   예전엔 done_at 이 9시간 과거로 저장돼, 답글 예약기의 '댓글 후 20분 묵힘'이 무력화됐다.
        now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
        posted = False
        print(f"[{datetime.datetime.now():%H:%M:%S}] 댓글 처리[{a['name']}:{a['port']}]: {(job.get('article_url') or '')[:44]}", flush=True)
        try:
            url = cc.comment_job(job, f"http://127.0.0.1:{a['port']}", no_send=NO_SEND)
            _last[a["name"]] = time.time()
            # 여기부터는 '이미 게시됨' — 아래 기록이 실패해도 재시도하면 안 된다.
            #   no_send 는 입력만 하고 등록을 안 누르므로 게시된 게 아니다(재시도해도 안전).
            posted = not NO_SEND
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
            # 게시는 됐는데 기록만 실패한 경우 — 절대 재시도하면 안 된다(같은 댓글 2번 게시).
            if posted:
                print(f"  ⚠️ 게시는 완료됐으나 상태기록 실패 — 중복 방지 위해 done 처리: {reason[:80]}", flush=True)
                try:
                    cc.sb_patch("cafe_comment_queue", {"id": f"eq.{jid}"},
                                {"status": "done", "done_at": now, "reason": "기록 지연(게시는 완료)"})
                except Exception:
                    print("  ❗ done 기록 재시도도 실패 — 수동 확인 필요", flush=True)
                continue
            n_try = _try_count(job) + 1
            # 로그인 만료·크롬 꺼짐·일시 오류는 재시도 대상 → pending 으로 되돌려 복구 후 자동 재개.
            # ⚠️ 답글 경로의 오류 문구는 전부 '답글~' 이라, 예전엔 이 목록에 하나도 안 걸려
            #   일시적 오류(댓글이 아직 렌더 안 됨 등)까지 영구 실패로 죽었다.
            retryable = any(k in reason for k in (
                "LOGIN_REQUIRED", "ECONNREFUSED", "connect_over_cdp",
                "댓글 입력창", "댓글 등록 버튼", "댓글 등록 확인",
                "답글쓰기 버튼", "대상 댓글 못 찾음", "답글 입력창", "답글 등록 버튼", "답글 등록 확인",
                # 크롬이 죽거나 CDP 가 끊긴 경우 — 실제 Playwright 문구에 맞춰야 한다.
                #   ("Target closed"/"browserContext" 는 요즘 문구와 안 맞아 헛돌았다)
                "Timeout", "websocket", "has been closed", "Browser closed",
                "Connection closed", "Protocol error", "net::ERR_", "Target closed",
            ))
            if retryable and n_try < MAX_TRY:
                # 재시도는 '지금 당장'이 아니라 뒤로 미룬다. 안 그러면 이 작업이 큐의 머리를
                #   계속 차지해(가장 오래됨) 다른 작업이 영영 처리되지 않고, 30초마다 재시도가
                #   반복돼 네이버 요청량도 폭증한다(측정상 9배).
                back = RETRY_BACKOFF_MIN * (2 ** (n_try - 1))     # 3, 6, 12, 24분…
                nxt = datetime.datetime.now().astimezone() + datetime.timedelta(minutes=back)
                _patch_safe(jid, {
                    "status": "pending",
                    "reason": f"{RETRY_TAG}{n_try}/{MAX_TRY}: {reason[:160]}",
                    "scheduled_at": nxt.isoformat(timespec="seconds"),
                })
                print(f"  ⏸ 일시오류 {n_try}/{MAX_TRY} — {back}분 뒤 재시도: {reason[:80]}", flush=True)
            elif retryable:
                _fail(jid, f"재시도 {MAX_TRY}회 초과: {reason[:200]}")
                print(f"  ❌ 재시도 한도 초과 — {reason[:80]}", flush=True)
            else:
                _fail(jid, reason)
                print(f"  ❌ 실패 — {reason}", flush=True)


if __name__ == "__main__":
    # 감시 루프 — 예상 못 한 예외로 리스너가 조용히 죽는 일을 막는다.
    #   (start_all.bat 은 죽은 프로세스를 되살리지 않아, 재부팅 전까지 댓글이 멈춰버린다)
    while True:
        try:
            main()
        except KeyboardInterrupt:
            print("종료합니다.", flush=True); break
        except SystemExit:
            raise
        except Exception as e:
            print(f"[치명적] 리스너 예외 — 20초 뒤 재시작: {str(e)[:200]}", flush=True)
            time.sleep(20)
