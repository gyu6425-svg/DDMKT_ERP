# -*- coding: utf-8 -*-
"""
카페 새 글 감시 워처 — 등록된 카페(cafe_comment_watch)를 주기적으로 크롤링해
새 글이 올라오면 cafe_comment_queue 에 템플릿 댓글을 자동 예약한다.

[흐름] 웹에서 카페 등록 → [이 워처] 로그인 크롬(9224)으로 카페 최신글 스크랩
       → 새 글(마지막 본 글번호 초과) 발견 → build_comment 로 댓글 생성 → 큐 적재
       → comment_listener 가 게시(중복방지 적용). cafe_pub/comment_cafe 를 import 하지 않음(자립).

[안전] 첫 실행은 기존 글을 '기준선'으로만 잡고 댓글 안 달기 → 이후 새 글에만.
       별도 탭(#watch 마커)으로 스크랩 → 리스너/keep-alive 작업탭 보존. 읽기전용 크롤.

[사용]
  python watch_new_posts.py            # 무한 루프(기본 CAFE_CMT_WATCH_MIN 분, 기본 5)
  python watch_new_posts.py --once     # 1회만
  옵션: --cdp http://127.0.0.1:9224
"""
import argparse
import datetime
import os
import sys
import time

from playwright.sync_api import sync_playwright

import comment_cafe as cc
from comment_templates import build_comment

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

INTERVAL_MIN = int(os.environ.get("CAFE_CMT_WATCH_MIN", "5"))   # 크롤 주기(분)
MAX_NEW_PER_RUN = int(os.environ.get("CAFE_CMT_WATCH_MAX", "5"))  # 한 번에 예약할 새 글 상한(폭주 방지)


def _log(m):
    print(f"[watch] {datetime.datetime.now():%H:%M:%S} {m}", flush=True)


def scrape_articles(page, cafe_url):
    """카페 홈을 새 탭에서 열어 최신글 (article_id, url, title) 목록을 수집. 로그인 필요 시 예외."""
    url = cafe_url.rstrip("/") + "#watch"    # #watch 마커 → 리스너 _connect 가 이 탭을 안 잡음
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    if "nid.naver.com" in (page.url or "") or "nidlogin" in (page.url or ""):
        raise RuntimeError("LOGIN_REQUIRED: 네이버 로그인 필요(크롬 9224)")
    js = """() => {
      const as=[...document.querySelectorAll('a[href*="/articles/"], a[href*="ArticleRead"], a[href*="articleid="]')];
      const seen=new Set(); const out=[];
      for(const a of as){ const h=a.href; const m=h.match(/articles\\/(\\d+)|articleid=?(\\d+)/); const id=m?(m[1]||m[2]):null;
        if(!id||seen.has(id))continue; seen.add(id); out.push({id:parseInt(id,10), url:h, title:(a.innerText||'').trim().slice(0,60)}); }
      return out;
    }"""
    found = {}
    for fr in page.frames:
        try:
            for r in fr.evaluate(js):
                aid = r["id"]
                # 제목 있는 항목 우선(사이드바 중복 링크 정리)
                if aid not in found or (r["title"] and not found[aid]["title"]):
                    found[aid] = r
        except Exception:
            continue
    return sorted(found.values(), key=lambda r: r["id"])


def process_watch(page, w):
    """감시 카페 1건 처리 — 새 글 감지 후 큐 적재. (예약 건수 반환)"""
    cafe_url = w.get("cafe_url") or ""
    region = w.get("region") or ""
    keyword = w.get("keyword") or ""
    last_seen = w.get("last_seen_article_id")
    arts = scrape_articles(page, cafe_url)
    if not arts:
        _log(f"  글 목록 비어있음(스크랩 실패?): {cafe_url}")
        return 0
    max_id = max(a["id"] for a in arts)

    now = datetime.datetime.now().isoformat(timespec="seconds")
    # 첫 실행 → 기준선만 잡고 댓글 안 달기(기존 글 폭주 방지)
    if last_seen is None:
        cc.sb_patch("cafe_comment_watch", {"id": f"eq.{w['id']}"},
                    {"last_seen_article_id": max_id, "updated_at": now})
        _log(f"  기준선 설정(첫 실행): 최신 #{max_id} 까지 '이미 봄' 처리 — 댓글 안 달림. {cafe_url}")
        return 0

    news = [a for a in arts if a["id"] > last_seen]
    if not news:
        return 0
    news = news[:MAX_NEW_PER_RUN]   # 폭주 방지 상한
    queued = 0
    last_body = None
    for a in news:
        if cc.already_commented(a["url"]):
            continue
        body = build_comment(region, keyword, avoid=last_body)
        last_body = body
        try:
            cc.sb_insert("cafe_comment_queue", {
                "article_url": a["url"], "body": body, "status": "pending",
            })
            queued += 1
            _log(f"  ✅ 예약: #{a['id']} '{a['title'][:20]}' → \"{body[:24]}...\"")
        except Exception as e:
            _log(f"  ! 예약 실패 #{a['id']}: {str(e)[:80]}")
    # 마지막 본 글번호 갱신
    cc.sb_patch("cafe_comment_watch", {"id": f"eq.{w['id']}"},
                {"last_seen_article_id": max_id, "updated_at": now})
    return queued


def run_once(cdp_url):
    try:
        watches = cc.sb_get("cafe_comment_watch", {"enabled": "eq.true", "select": "*"})
    except Exception as e:
        _log(f"감시목록 조회 실패: {str(e)[:100]}"); return
    if not watches:
        _log("등록된 감시 카페 없음"); return
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(cdp_url)
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        page = ctx.new_page()   # 별도 탭(리스너 작업탭 보존)
        try:
            total = 0
            for w in watches:
                try:
                    total += process_watch(page, w)
                except Exception as e:
                    _log(f"  카페 처리 오류({w.get('cafe_url')}): {str(e)[:100]}")
            if total:
                _log(f"이번 크롤: 새 글 {total}건 예약")
        finally:
            try:
                page.close()
            except Exception:
                pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--cdp", default=cc.DEFAULT_CDP)
    args = ap.parse_args()
    if not cc.SUPABASE_URL or not cc.SUPABASE_KEY:
        print("SUPABASE_URL / SUPABASE_SERVICE_KEY 필요(../.env)", flush=True); sys.exit(1)
    if args.once:
        run_once(args.cdp); return
    _log(f"카페 새글 감시 시작 — 주기 {INTERVAL_MIN}분 — Ctrl+C 종료")
    while True:
        try:
            run_once(args.cdp)
        except Exception as e:
            _log(f"루프 오류: {str(e)[:100]}")
        time.sleep(INTERVAL_MIN * 60)


if __name__ == "__main__":
    main()
