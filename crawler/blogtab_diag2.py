# 블로그탭 전체 구조 덤프 — 모든 블록(blockId/area)과 그 안 모든 글링크(r·필드·logNo)를 문서순서로.
#   _iter_blog_posts 가 못 보는 항목(인기글/광고/인플루언서/다른 필드 링크)을 찾기 위함.
import sys, json, re
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore; truststore.inject_into_ssl()
import blog_rank_crawler as c
from urllib.parse import quote

BLOG_RE = re.compile(r"blog\.naver\.com/([^/?#\"\\]+)/?(\d{6,})?")
NAV_FIELDS = ("contentHref", "titleHref", "href", "url", "outsideUrl")

def node_r(d):
    cl = d.get("clickLog")
    if isinstance(cl, dict):
        for k in ("content", "title", "image"):
            ct = cl.get(k)
            if isinstance(ct, dict) and isinstance(ct.get("r"), (int, float)):
                return ct["r"]
    return None

for kw, tgt_blog, tgt_log in [("인천 행사 경호업체", "themansystem-", "224325803455"),
                              ("평택반영구 눈썹", "761105ej", "224326947764")]:
    url = f"https://m.search.naver.com/search.naver?ssc=tab.m_blog.all&query={quote(kw)}"
    code, html_text = c._fetch_html(url)
    print(f"\n========== '{kw}'  HTTP {code}")
    blocks = c.extract_bootstrap_json(html_text)
    print(f"  블록 {len(blocks)}개")
    for bi, b in enumerate(blocks):
        try: j = json.loads(b)
        except: continue
        blk = (j.get("refs") or {}).get("blockId", "") or (j.get("meta") or {}).get("area", "")
        is_ad = "ader.naver.com" in b
        # 이 블록 안의 모든 글링크를 문서순서로
        found = []
        def walk(o, field=None):
            if isinstance(o, dict):
                r = node_r(o)
                for f in NAV_FIELDS:
                    v = o.get(f)
                    if isinstance(v, str) and "blog.naver.com" in v:
                        m = BLOG_RE.search(v)
                        if m:
                            found.append((r, f, m.group(1), m.group(2) or ""))
                for k, v in o.items():
                    walk(v, k)
            elif isinstance(o, list):
                for x in o: walk(x, field)
        walk(j)
        if not found and not is_ad:
            continue
        tag = " [광고]" if is_ad else ""
        print(f"  ── 블록#{bi} blockId='{blk}'{tag}  글링크 {len(found)}")
        seen=set()
        for (r, f, bid, lno) in found:
            key=(bid,lno)
            dup = " (중복)" if key in seen else ""
            seen.add(key)
            star = " ★대상" if (lno==tgt_log or (not lno and bid==tgt_blog)) else ""
            print(f"       r={str(r):>4} [{f:11}] {bid}/{lno}{dup}{star}")
