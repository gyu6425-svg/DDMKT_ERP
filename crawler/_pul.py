import truststore
truststore.inject_into_ssl()
import requests
import re
import html as _html
import feedparser
import blog_rank_crawler as c

xml = requests.get("https://rss.blog.naver.com/puleenbe.xml",
                   headers={"User-Agent": c.UA}, timeout=20).text
feed = feedparser.parse(xml)
out = []
for e in feed.entries[:15]:
    title = _html.unescape(re.sub("<[^>]+>", "", e.get("title", "")))
    tags = [t.get("term", "") for t in e.get("tags", [])] if e.get("tags") else []
    link = e.get("link", "")
    derived = c.derive_keyword(title, tags)
    out.append("URL: %s" % link)
    out.append("제목: %s" % title)
    out.append("해시태그(%d): %s" % (len(tags), " | ".join(tags)))
    out.append("→ 현재 자동키워드: %r" % derived)
    out.append("")
open("_pul_out.txt", "w", encoding="utf-8").write("\n".join(out))
print("written")
