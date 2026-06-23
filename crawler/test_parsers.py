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
    # (설명, 파서, 덤프파일, blog_id, 기대 rank, 기대 status)
    # 통합탭 = 당근/광고만 제외, 사이트+카페+블로그 전부 r순(화면 실측 일치)
    ("석남동 통합탭", c._rank_in_popular, "통합탭_석남동_누수탐지_2026_06_19.html", OUR, 3, "ok"),
    ("인천석남동 통합탭", c._rank_in_popular, "통합탭_2026_06_19.html", OUR, 2, "ok"),
    ("인천연희동 통합탭(사이트 포함)", c._rank_in_popular, "통합탭_인천_연희동_누수탐지_2026_06_19.html", "rlawhddls125", 5, "ok"),
    ("석남동 블로그탭(순위밖)", c._rank_in_blogtab, "블로그탭B_석남동_누수탐지_2026_06_19.html", OUR, c.OUT_OF_RANK, "out"),
]


KEYWORD_CASES = [
    # 실제 블로그(band14371) — 사용자 확정값. 지역=시>구>동, 서비스=지역 뒤 첫 서비스 단어.
    ("덕양구 사무실 집기폐기 삼송동 사무용 책상철거 사무실비우기 사무가구폐기", "덕양구 집기폐기"),
    ("김포시 사무실 이사폐기물 사우동 사무가구철거 빈사무실만들기", "김포시 이사폐기물"),
    ("춘천 아파트 유리교체 창문이 깨졌을 때 가장 먼저 확인해야 할 것", "춘천 유리교체"),
    ("진해 스탠드에어컨 청소 왜 필요할까? 분해 후 확인한 오염 상태", "진해 에어컨청소"),
    ("여름 위례 에어컨청소 왜 필요할까", "위례 에어컨청소"),
    ("무더위 송파 에어컨 청소 추천", "송파 에어컨청소"),
    ("인천 석남동 누수탐지 욕조 보수 믿을 수 있는 탐지 사례", "석남동 누수탐지"),
    ("인천서구 누수탐지 석남동 가좌동 빌라누수", "인천서구 누수탐지"),
    ("남양주누수탐지, 수동면 세탁실 바닥 배수구 누수원인과 복구과정", "남양주누수탐지"),
    ("용인누수탐지 세탁실 바닥 배수구", "용인누수탐지"),
    ("남양주 누수탐지 PPC관 교체 시공", "남양주 누수탐지"),
    ("가정동 누수탐지 빌라", "가정동 누수탐지"),
]

# (tags, title, expected) — 해시태그 우선 → 제목 폴백
DERIVE_CASES = [
    (["춘천유리교체", "춘천아파트유리교체", "유리교체"], "춘천 아파트 유리교체 창문이", "춘천 유리교체"),
    (["빈사무실", "사무용가구", "대형책상버리는방법"], "덕양구 사무실 집기폐기 삼송동 사무용 책상철거", "덕양구 집기폐기"),
    ([], "김포시 사무실 이사폐기물 사우동 사무가구철거", "김포시 이사폐기물"),
]


def main():
    failed = 0
    for title, exp in KEYWORD_CASES:
        got = c.extract_keyword(title)
        ok = got == exp
        print(f"  {'PASS' if ok else 'FAIL'}  extract_keyword: {got!r} (기대 {exp!r})")
        if not ok:
            failed += 1
    for tags, title, exp in DERIVE_CASES:
        got = c.derive_keyword(title, tags)
        ok = got == exp
        print(f"  {'PASS' if ok else 'FAIL'}  derive_keyword: {got!r} (기대 {exp!r})")
        if not ok:
            failed += 1
    for desc, fn, dump, blog_id, exp_rank, exp_status in CASES:
        try:
            rank, status = fn(_read(dump), blog_id)
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
