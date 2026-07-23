# -*- coding: utf-8 -*-
"""
대댓글(답글) 예약기 — 우리 계정이 단 댓글에 발행 계정이 답글을 달도록 큐에 넣는다.

[왜 별도인가] 답글은 '댓글이 실제로 달린 뒤'에만 가능하다. 그래서 워처(새 글 감지)와
  분리해, 이미 done 처리된 댓글을 보고 그중 일부에 답글을 예약한다.

[흐름] cafe_comment_queue 에서 status=done 인 우리 댓글을 글별로 모음
       → 글마다 REPLY_PER_POST 개를 골라 → 답글 작업(reply_to_body=원댓글 본문)을 큐에 적재
       → comment_listener 가 REPLY_ACCOUNT 의 크롬으로 답글 작성

[안전]
  - 같은 원댓글에 답글 두 번 달지 않음(이미 예약/완료된 reply_to_body 는 제외)
  - 답글도 계정 간 시차처럼 scheduled_at 으로 늦춰 한꺼번에 달리지 않게 함
  - 답글 계정은 발행 계정과 같은 아이디라도 '별도 프로필/포트'(accounts.txt)를 써서
    발행 중인 크롬을 절대 건드리지 않는다.

실행: python reply_scheduler.py           # 무한 루프(기본 20분 주기)
      python reply_scheduler.py --once    # 1회만
"""
import argparse
import datetime
import os
import random
import sys
import time

import accounts as acct
import comment_cafe as cc
import heartbeat as hb      # 살아있음 신호(hang 감지용)
from comment_templates import region_from_comment, classify_business
from reply_templates import build_reply, region_from_text

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

INTERVAL_MIN = int(os.environ.get("CAFE_CMT_REPLY_MIN", "20"))      # 예약기 주기(분)
REPLY_PER_POST = int(os.environ.get("CAFE_CMT_REPLY_PER_POST", "2"))  # 글당 답글 수
REPLY_ACCOUNT = os.environ.get("CAFE_CMT_REPLY_ACCOUNT", "rlawhddls25")
# 답글은 '대댓글 계정(rlawhddls25)이 작성자/회원인 카페'에서만 단다.
#   그 계정은 ddmkt2 발행 정체성이라, 남의 카페(예: thebanclean=더반클린)에 답글을 달면
#   ①회원이 아니라 실패하고 ②'작성자 응답' 톤이 안 맞는다. 여기 토큰이 URL 에 있어야만 답글.
REPLY_CAFES = {x.strip() for x in os.environ.get("CAFE_CMT_REPLY_CAFES", "ddmkt2,31754130").split(",") if x.strip()}


def _reply_allowed(url):
    u = url or ""
    return any(tok in u for tok in REPLY_CAFES)
# 답글이 댓글 직후에 바로 달리면 티가 나므로 최소 이만큼 지난 댓글에만 답글을 단다(분).
REPLY_AFTER_MIN = int(os.environ.get("CAFE_CMT_REPLY_AFTER_MIN", "20"))
# 답글끼리도 시차를 둔다(분).
REPLY_STAGGER_MIN = float(os.environ.get("CAFE_CMT_REPLY_STAGGER_MIN", "12"))
REPLY_STAGGER_JITTER = float(os.environ.get("CAFE_CMT_REPLY_STAGGER_JITTER", "6"))
# 최근 몇 건의 댓글을 살필지. 60 이면 밀린 글이 많을 때(예: 과거글 일괄 보충) 오래된 댓글이
#   조회창 밖으로 밀려 영영 답글을 못 받는다. 넉넉히 본다(조회 1회라 비용도 미미).
LOOKBACK = int(os.environ.get("CAFE_CMT_REPLY_LOOKBACK", "300"))
# 한 글에 답글이 이만큼 실패하면 그 글은 포기(삭제된 글 등) — 무한 재시도 방지.
REPLY_FAIL_GIVEUP = int(os.environ.get("CAFE_CMT_REPLY_FAIL_GIVEUP", "3"))


def _log(m):
    print(f"[reply] {datetime.datetime.now():%H:%M:%S} {m}", flush=True)


def _watch_settings():
    """감시행 목록(지역/키워드 — 답글 문구 생성에 사용)."""
    try:
        return cc.sb_get("cafe_comment_watch", {"select": "cafe_url,region,keyword"})
    except Exception:
        return []


def _match_watch(body, watches):
    """이 원댓글이 '어느 업종 글'에 달린 것인지 판별한다.

    ⚠️ 예전엔 감시행 중 아무거나(next(iter(...))) 집었다. 카페 하나에 업종이 하나일 때만
       맞는 얘기고, 같은 카페에 누수/보안 감시행이 같이 있으면 보안 글 댓글에 누수 답글이
       달린다. 우리 댓글은 항상 '<지역> <키워드>' 를 포함하므로 그 키워드로 되짚는다.
       (키워드가 서로 포함관계면 더 긴 쪽이 정확하다)
    """
    best = None
    for w in watches:
        k = (w.get("keyword") or "").strip()
        if k and k in (body or ""):
            if best is None or len(k) > len((best.get("keyword") or "")):
                best = w
    return best


def run_once():
    a = acct.find_account(REPLY_ACCOUNT)
    if a is None:
        _log(f"❌ 답글 계정 '{REPLY_ACCOUNT}' 가 accounts.txt 에 없음 — 등록 후 로그인 필요")
        return
    try:
        rows = cc.sb_get("cafe_comment_queue", {
            "select": "id,account,article_url,body,status,reply_to_body,done_at,created_at,reason",
            "order": "created_at.desc", "limit": str(LOOKBACK),
        })
    except Exception as e:
        _log(f"큐 조회 실패: {str(e)[:90]}")
        return

    # 이미 답글이 예약/완료된 원댓글 본문 — 중복 답글 방지.
    #   실패(fail)한 답글은 제외해야 다음 회차에 다시 시도된다(안 그러면 영영 답글 없이 남는다).
    replied = {(r.get("reply_to_body") or "").strip()
               for r in rows if r.get("reply_to_body") and r.get("status") != "fail"}
    # 답글 대상 후보: 우리가 단 '일반 댓글' 중 done 인 것 (답글 자신은 제외)
    # 타임존 인식으로 비교한다. 예전엔 done_at 문자열을 [:19] 로 잘라 오프셋을 버리는 바람에
    #   'UTC 시각'을 '로컬 시각'으로 착각해 KST 기준 9시간 과거로 보였고, 결과적으로 이 게이트가
    #   항상 통과돼(=댓글 직후 바로 답글) 아무 역할도 못 했다.
    cutoff = datetime.datetime.now().astimezone() - datetime.timedelta(minutes=REPLY_AFTER_MIN)
    by_article = {}
    for r in rows:
        if r.get("reply_to_body"):          # 답글 자체는 대상 아님
            continue
        if r.get("status") != "done":       # 실제로 달린 댓글만
            continue
        if not _reply_allowed(r.get("article_url", "")):
            continue                        # 대댓글 계정이 회원/작성자인 카페에서만(thebanclean 등 제외)
        body = (r.get("body") or "").strip()
        if not body or body in replied:
            continue
        ts = (r.get("done_at") or r.get("created_at") or "").strip()
        try:
            if ts:
                dt = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
                if dt.tzinfo is None:        # 오프셋 없는 옛 데이터는 로컬로 간주
                    dt = dt.astimezone()
                if dt > cutoff:
                    continue                 # 너무 최근 댓글 — 조금 묵혔다가
        except Exception:
            pass
        by_article.setdefault(cc.article_key(r.get("article_url", "")), []).append(r)

    if not by_article:
        return
    queued = 0
    last_body = None
    for akey, cands in by_article.items():
        # 이 글에 이미 달린 답글 수 만큼 빼서 목표치를 채운다
        # 실패한 답글은 할당량에서 빼야 한다. 예전엔 fail 도 세서, 두 번 실패하면
        #   그 글은 have=2 가 되어 다시는 답글을 못 받았다(replied 집합과 판정이 어긋났음).
        have = sum(1 for r in rows
                   if r.get("reply_to_body") and r.get("status") != "fail"
                   and cc.article_key(r.get("article_url", "")) == akey)
        need = REPLY_PER_POST - have
        if need <= 0:
            continue
        # 답글이 계속 실패하는 글 = 글이 삭제됐거나(답글쓰기 버튼 없음) 구조 문제.
        #   그만 시도한다 — 안 그러면 매 주기 새 답글을 만들어 무한 실패한다
        #   (2026-07-21 삭제된 #38 에 매시간 답글 시도가 쌓이던 실제 사고).
        # 삭제/비공개 글은 즉시 포기(한 번이라도 '글 없음' 이 뜨면 그 글은 사라진 것).
        if any(("글 없음" in (r.get("reason") or "") or "삭제" in (r.get("reason") or ""))
               and cc.article_key(r.get("article_url", "")) == akey for r in rows):
            continue
        fails = sum(1 for r in rows
                    if r.get("reply_to_body") and r.get("status") == "fail"
                    and cc.article_key(r.get("article_url", "")) == akey)
        if fails >= REPLY_FAIL_GIVEUP:
            continue
        picks = random.sample(cands, min(need, len(cands)))
        for i, r in enumerate(picks):
            # 답글 문구의 지역 — 원댓글에 이미 '<지역> <키워드>' 가 들어 있으므로 거기서 뽑는다.
            #   region_from_text 는 키워드 '바로 앞에 붙은' 한글만 취해, 앞 문장 끝("~갑니다.")이
            #   지역으로 잘못 잡히던 문제를 막는다.
            # 업종은 '원댓글 문구'에서 직접 판별한다 — 우리 댓글엔 항상 '누수탐지'나 '보안(업체)'
            #   같은 업종어가 들어있어, 감시행 설정에 기대지 않아도 정확하다(게시판 전체잡기 대응).
            cbody = r.get("body", "")
            keyword = classify_business(cbody)
            if keyword is None:
                _log(f"  ⏭ 업종 판별 불가 — 답글 건너뜀: \"{cbody[:24]}\"")
                continue
            # 1순위: 템플릿 역매칭(정확). 2순위: 정규식 추출(옛 데이터·수동 댓글).
            region = region_from_comment(cbody, keyword,
                                         region_from_text(cbody, keyword, ""))
            try:
                text = build_reply(region, keyword, avoid=last_body)
            except Exception as e:
                _log(f"  ⏭ {str(e)[:90]}")
                continue
            last_body = text
            delay = i * REPLY_STAGGER_MIN + random.uniform(0, REPLY_STAGGER_JITTER)
            # astimezone(): 오프셋을 붙여 저장(DB timestamptz 가 UTC 로 오해하는 것 방지)
            when = datetime.datetime.now().astimezone() + datetime.timedelta(minutes=delay)
            try:
                cc.sb_insert("cafe_comment_queue", {
                    "article_url": r["article_url"], "body": text, "status": "pending",
                    "account": a["name"], "reply_to_body": r["body"],
                    "scheduled_at": when.isoformat(timespec="seconds"),
                })
                queued += 1
                _log(f"  ✅ 답글예약[{a['name']}] 글#{akey} {when:%H:%M} → \"{text[:26]}...\"")
            except Exception as e:
                _log(f"  ⏸ 답글예약 실패: {str(e)[:80]}")
    if queued:
        _log(f"이번 회차: 답글 {queued}건 예약")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()
    if not cc.SUPABASE_URL or not cc.SUPABASE_KEY:
        print("SUPABASE_URL / SUPABASE_SERVICE_KEY 필요(../.env)", flush=True); sys.exit(1)
    if args.once:
        run_once(); return
    _log(f"답글 예약기 시작 — 주기 {INTERVAL_MIN}분 · 글당 {REPLY_PER_POST}개 · 계정 {REPLY_ACCOUNT} — Ctrl+C 종료")
    while True:
        hb.beat("reply")   # 살아있음 신호(멈추면 워치독이 되살림)
        try:
            run_once()
        except Exception as e:
            _log(f"루프 오류: {str(e)[:100]}")
        hb.sleep_beating("reply", INTERVAL_MIN * 60)   # 대기 중에도 60초마다 신호


if __name__ == "__main__":
    main()
