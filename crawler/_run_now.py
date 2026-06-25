"""지금 즉시 전체 블로그 최신글(최신 5개) 크롤링 — 차단 예방 설정. 끝나면 삭제."""
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore
truststore.inject_into_ssl()
import blog_rank_crawler as c

c.REQUEST_DELAY = 3.0          # 요청 간격(+지터)
c.MAX_POSTS_PER_BLOG = 5       # 최신글 위주(블로그당 최신 5개)
c.BLOCK_REST_EVERY = 8         # 8블로그마다
c.BLOCK_REST_SEC = 25          # 휴식(초, +지터)
c.run()
