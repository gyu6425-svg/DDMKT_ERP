# 독립검증 — 수동 키워드(keyword_manual)가 크롤(RSS 업서트) 후에도 보존되고, 측정에 무조건 쓰이는가.
#   핵심 가정: on_conflict 업서트 페이로드에 keyword_manual 이 '없으면' 그 컬럼은 안 건드려진다(PostgREST merge-duplicates).
#   이걸 실제 DB로 라운드트립 테스트(임시 설정→업서트→확인→원복)해서 증명한다.
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore; truststore.inject_into_ssl()
import blog_rank_crawler as c

posts = c.sb_get("blog_posts", {"select": "id,blog_account_id,post_url,title,keyword,keyword_manual,published_date", "limit": "5000"})
manual = [p for p in posts if (p.get("keyword_manual") or "").strip()]
print(f"■ 현재 수동키워드 설정된 글: {len(manual)}건")
for p in manual[:20]:
    print(f"   수동:'{p['keyword_manual']}'  (자동:'{p.get('keyword')}')  {p['title'][:24]}")

# 당일 catch-up 크롤과 충돌 피하려고 '오늘이 아닌' 글로 테스트(원복까지 안전).
TESTKW = "__검증_수동키워드__"
P = next((p for p in posts if p.get("published_date") and p["published_date"] != c.TODAY and p.get("post_url")), None)
if not P:
    print("테스트할 비-오늘 글이 없음")
    sys.exit(0)
orig_km, orig_kw = P.get("keyword_manual"), P.get("keyword")
print(f"\n[라운드트립 테스트] 글: {P['title'][:30]} (id {P['id'][:8]} · 발행 {P.get('published_date')})")
print(f"  원본 keyword_manual={orig_km!r} / keyword={orig_kw!r}")
ok = False
try:
    # 1) 임시로 수동키워드 설정(사용자가 수동 지정한 상황 재현)
    c.sb_patch("blog_posts", {"id": f"eq.{P['id']}"}, {"keyword_manual": TESTKW})
    # 2) 다음 크롤의 RSS 업서트와 '완전히 동일'하게 호출 — keyword(자동)만 새 값, keyword_manual 은 페이로드에 없음
    c.sb_insert("blog_posts", [{
        "blog_account_id": P["blog_account_id"], "post_url": P["post_url"],
        "title": P["title"], "keyword": "__자동_덮어쓰기__", "published_date": P.get("published_date"),
    }], on_conflict="blog_account_id,post_url")
    # 3) 결과 확인
    after = c.sb_get("blog_posts", {"id": f"eq.{P['id']}", "select": "keyword,keyword_manual"})[0]
    km_kept = after.get("keyword_manual") == TESTKW
    kw_overwritten = after.get("keyword") == "__자동_덮어쓰기__"
    chosen = (after.get("keyword_manual") or after.get("keyword") or "").strip()   # 크롤 측정 선택 로직과 동일
    print(f"  업서트 후 keyword_manual = {after.get('keyword_manual')!r}  → 보존 {'OK ✅' if km_kept else 'FAIL ❌'}")
    print(f"  업서트 후 keyword(자동)  = {after.get('keyword')!r}  → 자동만 덮어씀 {'OK ✅' if kw_overwritten else 'FAIL ❌'}")
    print(f"  측정에 쓸 키워드(우선순위) = {chosen!r}  → 수동값 사용 {'OK ✅' if chosen == TESTKW else 'FAIL ❌'}")
    ok = km_kept and kw_overwritten and chosen == TESTKW
finally:
    # 4) 반드시 원복
    c.sb_patch("blog_posts", {"id": f"eq.{P['id']}"}, {"keyword_manual": orig_km, "keyword": orig_kw})
    chk = c.sb_get("blog_posts", {"id": f"eq.{P['id']}", "select": "keyword,keyword_manual"})[0]
    print(f"  ↩ 원복 완료: keyword_manual={chk.get('keyword_manual')!r} / keyword={chk.get('keyword')!r}")

print(f"\n■ 결론: 수동키워드 보존+측정사용 {'독립검증 통과 ✅' if ok else '문제 발견 ❌'}")
