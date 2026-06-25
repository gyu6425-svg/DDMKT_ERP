"""라이브 QA — 실제 네이버(PC IP)로 측정해 '화면에서 본 값'과 파서 결과가 맞는지 검증한다.

두 가지를 한다:
  1) CURATED  : 사용자가 화면에서 직접 확인한 확정 케이스를 하드 검증(불일치=실패). 새 버그 잡으면 여기 추가.
  2) --sample N: DB(blog_posts)에서 최근 글 N개를 골라 '저장값 vs 라이브값' 드리프트를 점검(경고만).
                네이버 통합탭은 시시각각 바뀌어 차이가 정상일 수 있어 실패로 치지 않고 표로 보여준다.

실행:
  python qa_live.py                # CURATED 만(빠름, 차단위험 낮음)
  python qa_live.py --sample 15    # CURATED + DB 최근글 15개 드리프트 점검

차단 방지를 위해 측정마다 간격(REQUEST_DELAY)을 둔다. 오프라인 회귀는 test_parsers.py 가 담당.
"""
import sys
import time
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore; truststore.inject_into_ssl()
import blog_rank_crawler as c

# (설명, 키워드, blog_id, log_no, 기대 통합ti, 기대 블로그bl 또는 None=검사안함)
#   화면에서 직접 확인한 값만 넣는다. None 은 '이 탭은 검증 생략'.
CURATED = [
    # 2026-06-25 사용자 확인: 당근=1위라 vision1803 은 통합 2위(프로필 카드). 블로그탭은 미확인(생략).
    ("경기광주 인테리어필름 vision1803", "경기광주 인테리어필름", "vision1803", "224323414074", 2, None),
]


def _check_curated():
    print("── CURATED 라이브 검증 ──────────────────────")
    failed = 0
    for desc, kw, bid, lno, exp_ti, exp_bl in CURATED:
        try:
            ti, ti_s, _ws = c.measure_integrated_popular(kw, bid, lno)
        except Exception as exc:
            print(f"  ERROR {desc}: 통합 측정 실패 {exc}")
            failed += 1
            continue
        ok_ti = (ti == exp_ti)
        line = f"  {'PASS' if ok_ti else 'FAIL'}  {desc}: 통합={ti}({ti_s}) 기대 {exp_ti}"
        if exp_bl is not None:
            c._pause(c.REQUEST_DELAY)
            bl, bl_s = c.measure_blogtab_real(kw, bid, lno)
            ok_bl = (bl == exp_bl)
            line += f" · 블로그={bl}({bl_s}) 기대 {exp_bl}"
            if not ok_bl:
                ok_ti = False
        if not ok_ti:
            failed += 1
        print(line)
        c._pause(c.REQUEST_DELAY)
    return failed


def _check_sample(n):
    print(f"\n── DB 최근글 {n}개 드리프트 점검(경고만) ──────")
    try:
        posts = c.sb_get("blog_posts", {
            "select": "post_url,keyword,keyword_manual,measurements,blog_account_id",
            "order": "published_date.desc", "limit": str(n),
        })
    except Exception as exc:
        print(f"  DB 조회 실패: {exc}")
        return
    # blog_id 매핑
    accs = {a["id"]: a for a in c.sb_get("blog_accounts", {"select": "id,blog_id,blog_url,name"})}
    drift = 0
    for p in posts:
        acc = accs.get(p.get("blog_account_id")) or {}
        bid = (acc.get("blog_id") or "").strip()
        kw = (p.get("keyword_manual") or p.get("keyword") or "").strip()
        lno = c.extract_log_no(p.get("post_url") or "")
        if not (kw and bid):
            continue
        ms = p.get("measurements") or []
        last = ms[-1] if ms else {}
        stored_ti = last.get("ti")
        try:
            ti, ti_s, _ws = c.measure_integrated_popular(kw, bid, lno)
        except Exception as exc:
            print(f"  · {acc.get('name','?')} '{kw}': 측정실패 {exc}")
            continue
        mark = "" if (stored_ti == ti) else "  <<< 드리프트"
        if mark:
            drift += 1
        print(f"  {acc.get('name','?')[:10]:10s} '{kw[:18]:18s}' 저장ti={stored_ti} 라이브ti={ti}({ti_s}){mark}")
        c._pause(c.REQUEST_DELAY)
    print(f"  → 드리프트 {drift}건(네이버 변동일 수도, 재현되면 파서 점검).")


def main():
    n = 0
    if "--sample" in sys.argv:
        i = sys.argv.index("--sample")
        if i + 1 < len(sys.argv):
            n = int(sys.argv[i + 1])
    failed = _check_curated()
    if n:
        _check_sample(n)
    if failed:
        print(f"\n[FAIL] CURATED {failed}건 불일치 — 파서/화면 재확인 필요.")
        sys.exit(1)
    print("\n[OK] CURATED 전체 일치")


if __name__ == "__main__":
    main()
