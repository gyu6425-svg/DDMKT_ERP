# 날짜 우선순위 크롤 — 오늘(26)에 올라온 글 전부 먼저 → 전날(25) → 전전날(24) 순으로 측정.
# 라운드로빈(블로그별 최신순)과 달리, "당일 발행글"을 모든 업체에서 가장 먼저 확보한다.
# blog_rank_crawler 의 함수/측정 로직을 그대로 재사용(1:1) — 측정 정의는 동일.
import sys, time, random, datetime
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore; truststore.inject_into_ssl()
import blog_rank_crawler as c

c.MAX_POSTS_PER_BLOG = 12          # RSS 더 넉넉히 받아서 24/25/26 글 누락 방지(날짜로 거른다)
TODAY = c.TODAY
d0 = datetime.date.fromisoformat(TODAY)
# 우선순위: 오늘 → 어제 → 그제 (기본 3일, 인자로 일수 조절 가능)
NDAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 3
TARGET = [(d0 - datetime.timedelta(days=k)).isoformat() for k in range(NDAYS)]
RANK = {d: i for i, d in enumerate(TARGET)}   # 작을수록 먼저(26=0,25=1,24=2)

c.need_config()
accounts = c.sb_get("blog_accounts", {"is_active": "eq.true", "select": "*"})
print(f"=== 날짜우선 크롤 시작 {TODAY} · 대상 {TARGET} (오늘→어제→그제) ===", flush=True)

# ── 1) RSS 수집 → 대상 날짜 글만 추림 → upsert ──
c.set_crawl_status(running=True, phase="rss", done=0, total=len(accounts), ok=0, fail=0, current_blog="당일 발행글 수집")
items = []  # {acc, blog_id, row, url, title, rss_tags, pub}
for idx, acc in enumerate(accounts):
    blog_id = acc.get("blog_id") or c.parse_blog_url(acc.get("blog_url", ""))[0] or ""
    if not blog_id:
        continue
    try:
        entries = c._rss_entries_light(blog_id)
    except Exception as exc:
        print(f"  RSS 실패 {acc.get('name')}: {exc}", flush=True)
        entries = []
    entries = [e for e in entries if e.get("published_date") in RANK]   # 24/25/26 글만
    rows = [{"blog_account_id": acc["id"], "post_url": e["url"], "title": e["title"],
             "keyword": c.derive_keyword(e["title"], e["rss_tags"]), "published_date": e["published_date"], "published_at": e.get("published_at")}
            for e in entries if e["url"]]
    upserted = c.sb_insert("blog_posts", rows, on_conflict="blog_account_id,post_url") if rows else []
    by_url = {p["post_url"]: p for p in upserted}
    for e in entries:
        row = by_url.get(e["url"])
        if row and not row.get("excluded"):  # 트래커에서 삭제한 글은 측정·재등록 대상에서 제외
            items.append({"acc": acc, "blog_id": blog_id, "row": row, "url": e["url"],
                          "title": e["title"], "rss_tags": e["rss_tags"], "pub": e["published_date"]})
    c.set_crawl_status(running=True, phase="rss", done=idx + 1, total=len(accounts), current_blog=acc.get("name", ""))
    c._pause(c.REQUEST_DELAY)

# ── 2) 날짜 우선순위 정렬(26 먼저 → 25 → 24) 후 측정 ──
items.sort(key=lambda x: RANK[x["pub"]])
total = len(items)
by_day = {}
for it in items:
    by_day[it["pub"]] = by_day.get(it["pub"], 0) + 1
print(f"=== 측정 시작: 총 {total}글 / 날짜별 {dict(sorted(by_day.items(), reverse=True))} ===", flush=True)
c.set_crawl_status(running=True, phase="crawl", done=0, total=total, ok=0, fail=0, current_blog="")

done = ok = fail = 0
cur_day = None
for it in items:
    acc, blog_id, row, pub = it["acc"], it["blog_id"], it["row"], it["pub"]
    if pub != cur_day:
        cur_day = pub
        print(f"--- {pub} 글 측정 시작 ---", flush=True)
    # 글 번호 없는 URL(블로그 대문 주소 등)은 개별 글 특정 불가 → 최신글로 오배정되므로 측정하지 않음.
    if not c.extract_log_no(it.get("url", "")):
        done += 1
        continue
    kw = (row.get("keyword_manual") or "").strip()
    if not kw:
        kw = c._keyword_from_hashtags(it["title"], it["url"], it["rss_tags"])
        if kw and kw != row.get("keyword"):
            try:
                c.sb_patch("blog_posts", {"id": f"eq.{row['id']}"}, {"keyword": kw})
            except Exception:
                pass
    if not kw:
        done += 1
        continue
    ti, bl, ti_s, bl_s, ws = c.measure_rank(kw, blog_id, it["url"])
    recs = [r for r in (row.get("measurements") or []) if r.get("date") != TODAY]
    recs.append({"date": TODAY, "ti": ti, "bl": bl, "ti_status": ti_s, "bl_status": bl_s, "ws": ws})
    c.sb_patch("blog_posts", {"id": f"eq.{row['id']}"}, {"measurements": recs})
    done += 1
    bad = (ti_s == "fail" or bl_s == "fail")
    ok += 0 if bad else 1
    fail += 1 if bad else 0
    mmdd = pub[5:].replace("-", "/")
    c.set_crawl_status(running=True, phase="crawl", done=done, total=total, ok=ok, fail=fail,
                       current_blog=f"{mmdd}일분 · {acc.get('name','')}")
    if c.BLOCK_REST_EVERY > 0 and done % c.BLOCK_REST_EVERY == 0 and done < total:
        rest = c.BLOCK_REST_SEC + random.uniform(0, c.BLOCK_REST_SEC * 0.5)
        print(f"  …{done}/{total} · 차단 예방 휴식 {rest:.0f}초", flush=True)
        c.set_crawl_status(running=True, phase="rest", done=done, total=total, ok=ok, fail=fail, current_blog="휴식 중")
        time.sleep(rest)

c.set_crawl_status(running=False, phase="done", done=total, total=total, ok=ok, fail=fail, current_blog="")
c.log_crawl_run("당일글", done, fail)
print(f"=== 완료: {done}글 측정(ok {ok} / fail {fail}) · 날짜우선 26→25→24 ===", flush=True)
