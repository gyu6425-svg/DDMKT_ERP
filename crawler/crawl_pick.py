# 특정 업체만 골라 당일+전날 글 재크롤. 사용: python crawl_pick.py "제시뷰티" "꽃들애"
#   날짜우선(오늘→어제), 수동키워드 우선(keyword_manual). crawl_bydate 와 동일 로직.
import sys, datetime
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore; truststore.inject_into_ssl()
import blog_rank_crawler as c

NAMES = [a for a in sys.argv[1:] if not a.isdigit()]
if not NAMES:
    print("업체명을 인자로 주세요."); sys.exit(1)
c.MAX_POSTS_PER_BLOG = 15
TODAY = c.TODAY
d0 = datetime.date.fromisoformat(TODAY)
TARGET = [(d0 - datetime.timedelta(days=k)).isoformat() for k in range(2)]  # 오늘, 어제
RANK = {d: i for i, d in enumerate(TARGET)}

c.need_config()
accounts = c.sb_get("blog_accounts", {"is_active": "eq.true", "select": "*"})
picked = [a for a in accounts if a.get("name") in NAMES]
print(f"=== 타깃 재크롤: {[a['name'] for a in picked]} · 날짜 {TARGET} ===", flush=True)
if not picked:
    print("일치 업체 없음. 활성 업체명을 확인하세요."); sys.exit(1)

items = []
for acc in picked:
    blog_id = acc.get("blog_id") or c.parse_blog_url(acc.get("blog_url", ""))[0] or ""
    if not blog_id:
        continue
    entries = c._rss_entries_light(blog_id)
    entries = [e for e in entries if e.get("published_date") in RANK]
    rows = [{"blog_account_id": acc["id"], "post_url": e["url"], "title": e["title"],
             "keyword": c.derive_keyword(e["title"], e["rss_tags"]), "published_date": e["published_date"]}
            for e in entries if e["url"]]
    upserted = c.sb_insert("blog_posts", rows, on_conflict="blog_account_id,post_url") if rows else []
    by_url = {p["post_url"]: p for p in upserted}
    for e in entries:
        row = by_url.get(e["url"])
        if row:
            items.append({"acc": acc, "blog_id": blog_id, "row": row, "url": e["url"],
                          "title": e["title"], "rss_tags": e["rss_tags"], "pub": e["published_date"]})

items.sort(key=lambda x: RANK[x["pub"]])
print(f"측정 대상 {len(items)}글", flush=True)
for it in items:
    acc, blog_id, row, pub = it["acc"], it["blog_id"], it["row"], it["pub"]
    kw = (row.get("keyword_manual") or "").strip()          # 수동키워드 우선
    src = "수동" if kw else "자동"
    if not kw:
        kw = c._keyword_from_hashtags(it["title"], it["url"], it["rss_tags"])
        if kw and kw != row.get("keyword"):
            try:
                c.sb_patch("blog_posts", {"id": f"eq.{row['id']}"}, {"keyword": kw})
            except Exception:
                pass
    if not kw:
        print(f"  [{pub}] {acc['name']} 키워드없음 스킵"); continue
    ti, bl, ti_s, bl_s, ws = c.measure_rank(kw, blog_id, it["url"])
    recs = [r for r in (row.get("measurements") or []) if r.get("date") != TODAY]
    recs.append({"date": TODAY, "ti": ti, "bl": bl, "ti_status": ti_s, "bl_status": bl_s, "ws": ws})
    c.sb_patch("blog_posts", {"id": f"eq.{row['id']}"}, {"measurements": recs})
    tg = ti if ti_s == "ok" else ti_s
    bg = bl if bl_s == "ok" else bl_s
    print(f"  [{pub}] {acc['name']} · '{kw}'({src}) → 통합 {tg} / 블로그 {bg} / 웹 {ws}", flush=True)
    c._pause(c.REQUEST_DELAY)

print("=== 완료 ===", flush=True)
