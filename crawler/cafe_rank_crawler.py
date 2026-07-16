# -*- coding: utf-8 -*-
"""카페 순위 크롤 — cafe_rank_posts 의 글들을 통합탭에서 측정해 measurements 에 누적.
   blog_rank_crawler 의 측정·차단회피·양보(_pause) 로직 그대로 재사용. crawl_bydate 미러.

실행: python cafe_rank_crawler.py            (전체)
      python cafe_rank_crawler.py --today    (오늘 발행분만)
전제: ../.env 의 SUPABASE_SERVICE_KEY (service_role, RLS 우회).
"""
import sys
import datetime
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore
truststore.inject_into_ssl()
import blog_rank_crawler as c

TODAY = c.TODAY


def main():
    c.need_config()
    today_only = "--today" in sys.argv
    params = {"excluded": "eq.false", "select": "*", "order": "published_date.desc"}
    if today_only:
        params["published_date"] = f"eq.{TODAY}"
    posts = c.sb_get("cafe_rank_posts", params)
    print(f"=== 카페 순위 크롤 {TODAY} · 대상 {len(posts)}글{' (오늘분)' if today_only else ''} ===", flush=True)
    ok = fail = 0
    for p in posts:
        kw = (p.get("keyword_manual") or p.get("keyword") or "").strip()
        cafe_name = (p.get("cafe_name") or "").strip()
        article_id = str(p.get("article_id") or "").strip()
        if not kw or not article_id:
            print(f"  [스킵] 키워드/글번호 없음: {p.get('title', '')[:20]}", flush=True)
            continue
        ti, ti_s = c.measure_cafe_rank(kw, cafe_name, article_id)
        recs = [r for r in (p.get("measurements") or []) if r.get("date") != TODAY]
        recs.append({"date": TODAY, "ti": ti, "ti_status": ti_s})
        try:
            c.sb_patch("cafe_rank_posts", {"id": f"eq.{p['id']}"}, {"measurements": recs})
        except Exception as exc:
            print(f"  [저장실패] {cafe_name}/{article_id}: {exc}", flush=True)
        bad = (ti_s == "fail")
        ok += 0 if bad else 1
        fail += 1 if bad else 0
        tg = f"{ti}위" if ti_s == "ok" else ("권외" if ti_s == "out" else "실패")
        print(f"  [{p.get('published_date')}] {cafe_name}/{article_id} · '{kw}' → 통합 {tg}", flush=True)
        c._pause(c.REQUEST_DELAY)   # 차단회피 + 즉시검색 양보
    print(f"=== 완료: {len(posts)}글 측정 (ok {ok} / fail {fail}) ===", flush=True)
    try:
        c.log_crawl_run("카페순위", ok + fail, fail)
    except Exception:
        pass


if __name__ == "__main__":
    main()
