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
from reply_templates import build_reply, region_from_text

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

INTERVAL_MIN = int(os.environ.get("CAFE_CMT_REPLY_MIN", "20"))      # 예약기 주기(분)
REPLY_PER_POST = int(os.environ.get("CAFE_CMT_REPLY_PER_POST", "2"))  # 글당 답글 수
REPLY_ACCOUNT = os.environ.get("CAFE_CMT_REPLY_ACCOUNT", "rlawhddls25")
# 답글이 댓글 직후에 바로 달리면 티가 나므로 최소 이만큼 지난 댓글에만 답글을 단다(분).
REPLY_AFTER_MIN = int(os.environ.get("CAFE_CMT_REPLY_AFTER_MIN", "20"))
# 답글끼리도 시차를 둔다(분).
REPLY_STAGGER_MIN = float(os.environ.get("CAFE_CMT_REPLY_STAGGER_MIN", "12"))
REPLY_STAGGER_JITTER = float(os.environ.get("CAFE_CMT_REPLY_STAGGER_JITTER", "6"))
LOOKBACK = int(os.environ.get("CAFE_CMT_REPLY_LOOKBACK", "60"))     # 최근 몇 건의 댓글을 살필지


def _log(m):
    print(f"[reply] {datetime.datetime.now():%H:%M:%S} {m}", flush=True)


def _watch_settings():
    """감시 카페의 지역/키워드(답글 문구 생성에 사용). 카페별로 매핑."""
    out = {}
    try:
        for w in cc.sb_get("cafe_comment_watch", {"select": "cafe_url,region,keyword"}):
            out[cc.article_key(w.get("cafe_url", "")) or w.get("cafe_url", "")] = w
    except Exception:
        pass
    return out


def run_once():
    a = acct.find_account(REPLY_ACCOUNT)
    if a is None:
        _log(f"❌ 답글 계정 '{REPLY_ACCOUNT}' 가 accounts.txt 에 없음 — 등록 후 로그인 필요")
        return
    try:
        rows = cc.sb_get("cafe_comment_queue", {
            "select": "id,account,article_url,body,status,reply_to_body,done_at,created_at",
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
    cutoff = datetime.datetime.now() - datetime.timedelta(minutes=REPLY_AFTER_MIN)
    by_article = {}
    for r in rows:
        if r.get("reply_to_body"):          # 답글 자체는 대상 아님
            continue
        if r.get("status") != "done":       # 실제로 달린 댓글만
            continue
        body = (r.get("body") or "").strip()
        if not body or body in replied:
            continue
        ts = (r.get("done_at") or r.get("created_at") or "")[:19]
        try:
            if ts and datetime.datetime.fromisoformat(ts) > cutoff:
                continue                     # 너무 최근 댓글 — 조금 묵혔다가
        except Exception:
            pass
        by_article.setdefault(cc.article_key(r.get("article_url", "")), []).append(r)

    if not by_article:
        return
    watches = _watch_settings()
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
        picks = random.sample(cands, min(need, len(cands)))
        for i, r in enumerate(picks):
            # 답글 문구의 지역 — 원댓글에 이미 '<지역> <키워드>' 가 들어 있으므로 거기서 뽑는다.
            #   region_from_text 는 키워드 '바로 앞에 붙은' 한글만 취해, 앞 문장 끝("~갑니다.")이
            #   지역으로 잘못 잡히던 문제를 막는다.
            w = next(iter(watches.values()), {}) if watches else {}
            keyword = (w.get("keyword") or "누수탐지")
            region = region_from_text(r.get("body", ""), keyword, (w.get("region") or ""))
            text = build_reply(region, keyword, avoid=last_body)
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
        try:
            run_once()
        except Exception as e:
            _log(f"루프 오류: {str(e)[:100]}")
        time.sleep(INTERVAL_MIN * 60)


if __name__ == "__main__":
    main()
