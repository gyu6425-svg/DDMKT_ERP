# -*- coding: utf-8 -*-
"""발행된 카페 글(cafe_publish_queue done) → cafe_rank_posts 자동 등록.
   posted_url 파싱(clubid/articleid) + 제목에서 키워드 도출 + clubid→vanity 매핑.
   전제: docs/cafe-rank-tables.sql 실행됨. service_role 로 RLS 우회.

실행: python register_published_cafe.py
"""
import re
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore
truststore.inject_into_ssl()
import blog_rank_crawler as c

# 우리가 아는 clubid → vanity(SERP 매칭키) 매핑. 새 카페 생기면 여기 추가.
CLUB_TO_VANITY = {"31754130": "ddmkt2"}


def keyword_from_title(title):
    """제목 앞 '지역 업종' 2토큰을 측정 키워드로. 예: '과천 누수탐지 후기…' → '과천 누수탐지'."""
    t = re.sub(r"[,\-–—:·|].*$", "", (title or "")).strip()
    toks = t.split()
    return " ".join(toks[:2]) if len(toks) >= 2 else t


def main():
    c.need_config()
    rows = c.sb_get("cafe_publish_queue", {"status": "eq.done", "select": "id,title,posted_url,manifest", "order": "created_at.desc"})
    done = [r for r in rows if r.get("posted_url")]
    print(f"발행 완료 글 {len(done)}건 등록 시도", flush=True)
    n = 0
    for r in done:
        club, vanity, art = c.parse_cafe_url(r.get("posted_url", ""))
        if not art:
            print(f"  스킵(URL 파싱 실패): {r.get('posted_url')}"); continue
        cafe_name = vanity or CLUB_TO_VANITY.get(club or "", "")
        kw = keyword_from_title(r.get("title"))
        payload = {
            "club_id": club, "cafe_name": cafe_name or None, "article_id": art,
            "post_url": r.get("posted_url"), "title": r.get("title"), "keyword": kw,
        }
        try:
            c.sb_insert("cafe_rank_posts", [payload], on_conflict="cafe_name,article_id")
            n += 1
            print(f"  ✓ {cafe_name}/{art} · '{kw}' — {(r.get('title') or '')[:24]}", flush=True)
        except Exception as e:
            print(f"  ✗ {cafe_name}/{art}: {str(e)[:100]}", flush=True)
    print(f"=== 등록 {n}건 완료. 이제 python cafe_rank_crawler.py 로 측정하세요. ===", flush=True)


if __name__ == "__main__":
    main()
