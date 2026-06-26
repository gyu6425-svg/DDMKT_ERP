# 블로그탭 순위 진단 — 더맨시스템/제시뷰티 글의 '문서순서 위치' vs 'clickLog r' 비교.
import sys, json, re
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore; truststore.inject_into_ssl()
import blog_rank_crawler as c
from urllib.parse import quote

# DB에서 대상 글(키워드·blog_id·logNo) 가져오기
posts = c.sb_get("blog_posts", {"select": "title,post_url,keyword,keyword_manual,blog_account_id", "limit": "9000"})
accs = {a["id"]: a for a in c.sb_get("blog_accounts", {"select": "id,name,blog_id,blog_url"})}
def find(name_kw):
    for p in posts:
        acc = accs.get(p["blog_account_id"])
        if not acc: continue
        if acc["name"] == name_kw[0] and name_kw[1] in (p.get("title") or ""):
            bid = acc.get("blog_id") or c.parse_blog_url(acc.get("blog_url",""))[0]
            return (p.get("keyword_manual") or p.get("keyword"), bid, c.extract_log_no(p.get("post_url","")), p.get("title"))
    return None

targets = [find(("더맨시스템","인천 행사 경호업체")), find(("제시뷰티","평택"))]
for t in targets:
    if not t:
        print("대상 글 못찾음"); continue
    kw, blog_id, log_no, title = t
    print(f"\n========== '{kw}' · blog_id={blog_id} · logNo={log_no}")
    print(f"  글제목: {title[:40]}")
    url = f"https://m.search.naver.com/search.naver?ssc=tab.m_blog.all&query={quote(kw)}"
    code, html_text = c._fetch_html(url)
    print(f"  HTTP {code}")
    blocks = c.extract_bootstrap_json(html_text)
    # 문서순서대로 블로그 글 수집(블록→글), dedup, r 같이 표기
    seen = set(); pos = 0
    print(f"  {'문서순':>4} {'r':>4}  blog_id/logNo            ★=대상")
    for b in blocks:
        try: j = json.loads(b)
        except: continue
        if "blog" not in (j.get("refs") or {}).get("blockId", ""):
            continue
        for r, pid, plog in c._iter_blog_posts(j):
            if (pid, plog) in seen: continue
            seen.add((pid, plog))
            pos += 1
            star = " ★대상" if (log_no and plog == log_no) or (not log_no and pid == blog_id) else ""
            mark = star or ""
            if pos <= 15 or star:
                print(f"  {pos:>4} {r:>4}  {pid}/{plog}{mark}")
    bl, st = c.measure_blogtab_real(kw, blog_id, log_no)
    print(f"  >> 현재 측정값(measure_blogtab_real): {bl if st=='ok' else st}  (= r 기반)")
