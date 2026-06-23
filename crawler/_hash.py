import truststore
truststore.inject_into_ssl()
import requests
import re
import blog_rank_crawler as c

TAG_RE = re.compile(r'class="__se-hash-tag">#([^<]+)</span>')
posts = [
    ("224319609799", "진해 스탠드에어컨청소"),
    ("224309416716", "용원 에어컨청소(제목=에어컨…)"),
    ("224297670294", "진영 천장형 에어컨청소"),
    ("224292220345", "장유 에어컨청소(제목=냄새…)"),
    ("224262278248", "가음정동 에어컨청소"),
]
out = []
for logno, note in posts:
    html = requests.get("https://m.blog.naver.com/puleenbe/" + logno,
                        headers={"User-Agent": c.UA}, timeout=20).text
    tags = TAG_RE.findall(html)
    out.append("[%s] %s" % (logno, note))
    out.append("  해시태그(%d): %s" % (len(tags), " / ".join(tags)))
    out.append("  pickMain → %r" % c.pick_main_hashtag_keyword(tags))
    out.append("")
open("_hash_out.txt", "w", encoding="utf-8").write("\n".join(out))
print("written")
