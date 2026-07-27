# -*- coding: utf-8 -*-
"""top5 실적 자동집계 개시 전 1회 실행 — 과거 이력에서 '한 번이라도 ≤5위(ok)'였던 글을
   top5_seeded=true 로 표시(= 수동 베이스라인에 이미 반영된 것으로 보고 자동 카운트 제외).
   그리고 게시판별 (수동 done_count) vs (seed 수) 대조를 출력해 눈으로 확인하게 한다.
실행: python cafe_top5_seed.py
"""
import sys
import collections
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore
truststore.inject_into_ssl()
import blog_rank_crawler as c


def ever_top5(ms):
    for m in (ms or []):
        if m.get("ti_status") == "ok" and isinstance(m.get("ti"), (int, float)) and not isinstance(m.get("ti"), bool) and m.get("ti") <= 5:
            return True
    return False


def main():
    c.need_config()
    posts = c.sb_get("cafe_rank_posts", {"excluded": "eq.false", "select": "id,board,measurements,top5_seeded,cafe_account_id"})
    accounts = c.sb_get("cafe_accounts", {"select": "id,board_short,display_name,done_count"})
    acc_by_id = {a["id"]: a for a in accounts}

    seeded = 0
    per = collections.Counter()
    for p in posts:
        if ever_top5(p.get("measurements")):
            per[p.get("board")] += 1
            if not p.get("top5_seeded"):
                c.sb_patch("cafe_rank_posts", {"id": f"eq.{p['id']}"}, {"top5_seeded": True})
                seeded += 1
    print(f"=== seed 완료: {seeded}글 top5_seeded 설정 ===", flush=True)
    print("\n게시판별 (수동 done_count) vs (과거 ≤5 seed 수) 대조:")
    for a in accounts:
        b = a["board_short"]
        print(f"  {a['display_name']:8} 수동실적 {a.get('done_count')} · seed(과거≤5) {per.get(b, 0)}")


if __name__ == "__main__":
    main()
