"""순위 파서 회귀 테스트 (네트워크 불필요 — dumps/ 고정 픽스처로 검증).

실행:  python test_parsers.py
네이버 구조가 바뀌면 여기서 먼저 깨지므로, 운영 측정이 조용히 오염되는 걸 막는다.
실측 골든값(2026-06-19, 사용자 화면 확인):
  - 석남동 누수탐지   → 통합탭 ti=3, 블로그탭 bl=순위밖
  - 인천 석남동 누수탐지 → 통합탭 ti=1
"""
import os
import sys

import blog_rank_crawler as c

HERE = os.path.dirname(os.path.abspath(__file__))
OUR = "st7al_i_byid-"


def _read(name):
    return open(os.path.join(HERE, "dumps", name), encoding="utf-8").read()


CASES = [
    # (설명, 파서, 덤프파일, 기대 rank, 기대 status)
    ("석남동 통합탭(인기글)", c._rank_in_popular, "통합탭_석남동_누수탐지_2026_06_19.html", 3, "ok"),
    ("인천석남동 통합탭(인기글)", c._rank_in_popular, "통합탭_2026_06_19.html", 1, "ok"),
    ("석남동 블로그탭(순위밖)", c._rank_in_blogtab, "블로그탭B_석남동_누수탐지_2026_06_19.html", c.OUT_OF_RANK, "out"),
]


def main():
    failed = 0
    for desc, fn, dump, exp_rank, exp_status in CASES:
        try:
            rank, status = fn(_read(dump), OUR)
        except FileNotFoundError:
            print(f"  SKIP  {desc}: 덤프 없음({dump})")
            continue
        ok = (rank == exp_rank and status == exp_status)
        print(f"  {'PASS' if ok else 'FAIL'}  {desc}: rank={rank} status={status} (기대 {exp_rank}/{exp_status})")
        if not ok:
            failed += 1
    if failed:
        print(f"\n[FAIL] {failed}건 실패 — 네이버 구조 변경 가능성. 재덤프 후 파서 점검 필요.")
        sys.exit(1)
    print("\n[OK] 전체 통과")


if __name__ == "__main__":
    main()
