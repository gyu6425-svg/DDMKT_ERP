"""김다영 담당 블로그만, 최신글 N개 위주로, 차단 최소화(순차+넉넉한 간격) 강제 재측정.
새 로직(웹사이트탭 web섹션 제외·afterArticles 순위전염 차단·ws 존재여부) 반영용. 끝나면 삭제."""
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore
truststore.inject_into_ssl()
import blog_rank_crawler as c

MANAGER = "김다영"
N_RECENT = 5          # 블로그당 최신글 몇 개만(최신글 위주)
c.REQUEST_DELAY = 3.0  # 차단 방지: 요청 간격 넉넉히(기본 2.0 → 3.0)

accounts = c.sb_get("blog_accounts", {"select": "*", "is_active": "eq.true"})
targets = [a for a in accounts if (a.get("manager") or "").strip() == MANAGER]
print(f"=== {MANAGER} 담당 활성 블로그 {len(targets)}개 · 블로그당 최신 {N_RECENT}글 · 간격 {c.REQUEST_DELAY}s ===\n", flush=True)

tot_posts = ok = fail = 0
for i, acc in enumerate(targets, 1):
    name = acc.get("name", "?")
    blog_id = acc.get("blog_id") or c.parse_blog_url(acc.get("blog_url", ""))[0] or ""
    if not blog_id:
        print(f"[{i}/{len(targets)}] {name}: blog_id 없음 skip", flush=True)
        continue
    # 최신글 동기화(RSS) → 최신 N글만 강제 측정
    try:
        rss = c.fetch_rss_posts(blog_id)
    except Exception as exc:
        print(f"[{i}/{len(targets)}] {name}: RSS 실패 {exc}", flush=True)
        rss = []
    rss = [p for p in rss if not p.get("published_date") or p["published_date"] >= c.OLDEST_DATE]
    rows = [{"blog_account_id": acc["id"], "post_url": p["url"], "title": p["title"],
             "keyword": c.derive_keyword(p["title"], p.get("tags") or []),
             "published_date": p["published_date"]} for p in rss if p["url"]]
    upserted = c.sb_insert("blog_posts", rows, on_conflict="blog_account_id,post_url") if rows else []
    upserted.sort(key=lambda p: p.get("published_date") or "", reverse=True)
    recent = upserted[:N_RECENT]
    print(f"[{i}/{len(targets)}] {name} ({blog_id}) · 측정 {len(recent)}글", flush=True)
    for post in recent:
        kw = post.get("keyword_manual") or post.get("keyword") or ""
        if not kw:
            continue
        url = post.get("post_url", "")
        ti, bl, ti_s, bl_s, ws = c.measure_rank(kw, blog_id, url)
        recs = [r for r in (post.get("measurements") or []) if r.get("date") != c.TODAY]
        recs.append({"date": c.TODAY, "ti": ti, "bl": bl, "ti_status": ti_s, "bl_status": bl_s, "ws": ws})
        c.sb_patch("blog_posts", {"id": f"eq.{post['id']}"}, {"measurements": recs})
        tot_posts += 1
        if ti_s == "fail" or bl_s == "fail":
            fail += 1
        else:
            ok += 1
        print(f"     · {post.get('published_date')} '{kw}': ti={ti}({ti_s}) bl={bl}({bl_s}) 웹탭={ws}", flush=True)

print(f"\n=== 완료: 글 {tot_posts}건 (정상 {ok} / 실패 {fail}) ===", flush=True)
