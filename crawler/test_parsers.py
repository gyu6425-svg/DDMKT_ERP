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
    # 통합탭 = 광고(ader)만 제외, 보이는 결과 전부 '문서(화면)순' 카운트. (2026-06-23 전 섹션으로 확장)
    #   기존 누수탐지 픽스처(상단 섹션 노출)는 값 불변(4/3/5). JS naverRank.test.mjs 와 동일 기대값.
    ("석남동 통합탭", c._rank_in_popular, "통합탭_석남동_누수탐지_2026_06_19.html", OUR, 4, "ok"),
    ("인천석남동 통합탭", c._rank_in_popular, "통합탭_2026_06_19.html", OUR, 3, "ok"),
    ("인천연희동 통합탭(사이트 포함)", c._rank_in_popular, "통합탭_인천_연희동_누수탐지_2026_06_19.html", "rlawhddls125", 5, "ok"),
    # 유리교체: 상단 블로그(windoorplus=3) + 하위 섹션 블로그(ist3ist3=9, kimdo3040=13) 모두 잡혀야 함.
    ("유리교체 통합탭(상단 블로그)", c._rank_in_popular, "통합탭_유리교체_2026_06_23.html", "windoorplus", 3, "ok"),
    ("유리교체 통합탭(하위섹션 블로그)", c._rank_in_popular, "통합탭_유리교체_2026_06_23.html", "ist3ist3", 9, "ok"),
    ("유리교체 통합탭(하위섹션 끝블로그)", c._rank_in_popular, "통합탭_유리교체_2026_06_23.html", "kimdo3040", 13, "ok"),
    ("석남동 블로그탭(순위밖)", c._rank_in_blogtab, "블로그탭B_석남동_누수탐지_2026_06_19.html", OUR, c.OUT_OF_RANK, "out"),
]


KEYWORD_CASES = [
    # 실제 블로그(band14371) — 사용자 확정값. 지역=시>구>동, 서비스=지역 뒤 첫 서비스 단어.
    ("덕양구 사무실 집기폐기 삼송동 사무용 책상철거 사무실비우기 사무가구폐기", "덕양구 집기폐기"),
    ("김포시 사무실 이사폐기물 사우동 사무가구철거 빈사무실만들기", "김포시 이사폐기물"),
    ("춘천 아파트 유리교체 창문이 깨졌을 때 가장 먼저 확인해야 할 것", "춘천 유리교체"),
    ("진해 스탠드에어컨 청소 왜 필요할까? 분해 후 확인한 오염 상태", "진해 에어컨청소"),
    ("여름 위례 에어컨청소 왜 필요할까", "위례 에어컨청소"),
    ("에어컨청소 위례 추천하는 이유", "위례 에어컨청소"),
    ("무더위 송파 에어컨 청소 추천", "송파 에어컨청소"),
    ("일산서구 거실 책장철거 가좌동 안쓰는 가구버리기 폐가구처리 집정리", "일산서구 책장철거"),
    ("송파 화장실 변기막힘 뚫는 법", "송파 변기막힘"),
    ("부산 구리 배관 누수탐지", "부산 누수탐지"),
    # 광역시(인천)가 동 앞에 별도 토큰이면 함께(사용자 확정: '인천 논현동 간판' 류).
    ("인천 석남동 누수탐지 욕조 보수 믿을 수 있는 탐지 사례", "인천 석남동 누수탐지"),
    ("인천서구 누수탐지 석남동 가좌동 빌라누수", "인천서구 누수탐지"),
    ("남양주누수탐지, 수동면 세탁실 바닥 배수구 누수원인과 복구과정", "남양주누수탐지"),
    ("용인누수탐지 세탁실 바닥 배수구", "용인누수탐지"),
    ("남양주 누수탐지 PPC관 교체 시공", "남양주 누수탐지"),
    ("가정동 누수탐지 빌라", "가정동 누수탐지"),
    # 간판=서비스 추가 + 공장/매장=업종수식어 + 광역시 접두. likesign 블로그 실측.
    ("청라 공장 간판 빠른 시안, 빠른 시공으로", "청라 간판"),
    ("인천 용현동 간판 인하대역 간판잘하는 업체", "인천 용현동 간판"),
    ("논현동 상가 간판 오피스텔 상가 간판 추천", "논현동 간판"),
    ("부천 신중동 간판 먹자골목에 딱 맞는 디자인", "신중동 간판"),
    ("가정동간판 루원시티 간판은 라이크 사인이 가장 빨라요", "가정동간판"),
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
