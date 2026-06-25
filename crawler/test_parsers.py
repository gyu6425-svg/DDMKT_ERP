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
    # 통합탭 = 외부 웹사이트(당근/사이트='관련문서' 묶음=웹사이트탭)·블로그 채널카드 제외, 블로그·카페 글만
    #   '화면순'으로 카운트한 위치. 2026-06-25 사용자 확정(경기광주·용산 인테리어필름: 위 웹사이트 묶음을 뺀
    #   '블로그·카페 글 영역'의 순위). → 2026-06-23 '당근 포함'(석남 3→4 등)을 반전: 웹사이트는 통합탭 아님.
    ("석남동 통합탭(웹사이트 제외)", c._rank_in_popular, "통합탭_석남동_누수탐지_2026_06_19.html", OUR, 3, "ok"),
    ("인천석남동 통합탭(웹사이트 제외)", c._rank_in_popular, "통합탭_2026_06_19.html", OUR, 1, "ok"),
    ("인천연희동 통합탭(웹사이트 제외)", c._rank_in_popular, "통합탭_인천_연희동_누수탐지_2026_06_19.html", "rlawhddls125", 2, "ok"),
    # 유리교체: 상단 블로그(windoorplus=2, 위 사이트 제외) + 하위 섹션 블로그(ist3ist3=1, kimdo3040=5).
    ("유리교체 통합탭(상단 블로그)", c._rank_in_popular, "통합탭_유리교체_2026_06_23.html", "windoorplus", 2, "ok"),
    # 섹션내 순위: ist3ist3·kimdo3040 은 urB_boR(블로그) 섹션 → 그 섹션 안 1·5위(누적 9·13 아님).
    ("유리교체 통합탭(블로그섹션 1위)", c._rank_in_popular, "통합탭_유리교체_2026_06_23.html", "ist3ist3", 1, "ok"),
    ("유리교체 통합탭(블로그섹션 5위)", c._rank_in_popular, "통합탭_유리교체_2026_06_23.html", "kimdo3040", 5, "ok"),
    ("석남동 블로그탭(순위밖)", c._rank_in_blogtab, "블로그탭B_석남동_누수탐지_2026_06_19.html", OUR, c.OUT_OF_RANK, "out"),
    # 블로그탭 순위 = 그 글의 clickLog r(=화면순위). 미유외과 7월진료 글 r=12(실제 12위). position(4) 아님.
    ("미유외과 블로그탭(r=12)", lambda h, _bid: c._rank_in_blogtab(h, "meuclinic", "224325467804"),
     "블로그탭_미유외과7월진료_2026_06_25.html", "meuclinic", 12, "ok"),
]

# 통합탭 글 단위(logNo) 매칭 — 같은 블로그 다른 글에 순위 오인 방지. likesign(간판) 실측:
#   #1=224066671070 은 web*(웹사이트/문서) 섹션에만 → 통합탭 권외(웹사이트탭=있음).
#   #2=224258926265 는 ugB_bsR(인기글) → web 제외 후 1위. 224291228962 는 미노출(권외).
PERPOST_DUMP = "통합탭_likesign_글단위_2026_06_24.html"
PERPOST_CASES = [
    ("통합탭 blogId(아무 글이나)", "likesign", "", 1, "ok"),
    ("통합탭 글단위 #1글(web섹션,권외)", "likesign", "224066671070", c.OUT_OF_RANK, "out"),
    ("통합탭 글단위 #2글", "likesign", "224258926265", 1, "ok"),
    ("통합탭 글단위 추적글(권외)", "likesign", "224291228962", c.OUT_OF_RANK, "out"),
]

# 칠곡 업소용가구(pjyysh) 실측 — 웹사이트(bmkc.co.kr·daangn 등) 제외하면 블로그는 cafeopen1004·clientkwak·
#   pjyysh 순 → 카드 대표글 5/15글(224286383537)=3위. 6/11글(224312956224)은 afterArticles(관련글)에만 → 권외.
PERPOST_DUMP2 = "통합탭_칠곡업소용가구_글단위_2026_06_24.html"
PERPOST2_CASES = [
    ("통합탭 글단위 카드대표글(5/15)", "pjyysh", "224286383537", 3, "ok"),
    ("통합탭 글단위 관련글(6/11,권외)", "pjyysh", "224312956224", c.OUT_OF_RANK, "out"),
    ("통합탭 blogId(칠곡 pjyysh)", "pjyysh", "", 3, "ok"),
]

# 김포 경호업체(themansystem-) 실측 — web_gen(sks303040 문서) 제외 → ugB_bsR 인기글 1위.
PERPOST_DUMP3 = "통합탭_김포경호업체_2026_06_24.html"
PERPOST3_CASES = [
    ("통합탭 더맨시스템(web제외 1위)", "themansystem-", "224299201732", 1, "ok"),
    # ugB_bsR 멀티카드 카운트 — 같은 블록 안 r=2/r=5 글이 1로 뭉개지지 않고 제 순위로(서천 limebuffet 회귀방지).
    ("통합탭 ugB 멀티카드 2위", "jhbillfallma", "224316244666", 2, "ok"),
    ("통합탭 ugB 멀티카드 5위", "gkstjeo97", "224317276845", 5, "ok"),
]

# 안산 푸르지오9차인테리어(design_do_) 실측 — urB_coR(오늘의집/부동산=웹사이트/문서) 섹션 다음
#   urB_boR(블로그) 섹션 첫 카드 → 섹션내 1위(누적이면 6위 오인).
PERPOST_DUMP4 = "통합탭_안산푸르지오9차_2026_06_24.html"
PERPOST4_CASES = [
    ("통합탭 안산 design_do_(섹션내 1위)", "design_do_", "224266735547", 1, "ok"),
]

# 경기광주 인테리어필름(vision1803) 실측 2026-06-25(사용자 확정) — 위 당근/Moons('관련문서')=웹사이트탭 제외.
#   통합탭=블로그·카페 글 영역: 6/22글(224323414074)=1위, 6/11글(224313044691)=3위, 5/11글(224281526330)=권외.
#   ※ vision1803 프로필(채널) 카드(글번호 없음)는 '웹사이트/채널'이라 통합탭 카운트 제외 — '2위'는 이 채널을
#     센 옛 오류였음. blogId(아무 글) = 첫 글 1위.
PERPOST_DUMP5 = "통합탭_경기광주인테리어필름_2026_06_25.html"
PERPOST5_CASES = [
    ("통합탭 경기광주 6/22글(1위)", "vision1803", "224323414074", 1, "ok"),
    ("통합탭 경기광주 6/11글(3위)", "vision1803", "224313044691", 3, "ok"),
    ("통합탭 경기광주 5/11글(권외)", "vision1803", "224281526330", c.OUT_OF_RANK, "out"),
    ("통합탭 경기광주 blogId(첫글 1위)", "vision1803", "", 1, "ok"),
]

# 웹사이트(문서)탭 존재 여부 — (덤프, blog_id, log_no, 기대) likesign #1글=있음, 더맨시스템=없음.
WEBSITE_CASES = [
    ("웹사이트탭 likesign #1글", PERPOST_DUMP, "likesign", "224066671070", "있음"),
    ("웹사이트탭 더맨시스템", PERPOST_DUMP3, "themansystem-", "224299201732", "없음"),
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
    # 지역이 시/구/동/사전에 없을 때 '서비스 단어 바로 앞' 단어를 지역으로. puleenbe(에어컨청소) 실측.
    ("에어컨 관리 시기를 놓치지 마세요 용원 에어컨청소", "용원 에어컨청소"),
    ("분해 후 오염을 제거해야하는 이유 진영 천장형 에어컨청소", "진영 에어컨청소"),
    ("냄새 원인 찾으려 열어봤다가 놀란 장유 에어컨청소 현장", "장유 에어컨청소"),
]

# (tags, title, expected) — 해시태그 우선 → 제목 폴백
DERIVE_CASES = [
    (["춘천유리교체", "춘천아파트유리교체", "유리교체"], "춘천 아파트 유리교체 창문이", "춘천 유리교체"),
    (["빈사무실", "사무용가구", "대형책상버리는방법"], "덕양구 사무실 집기폐기 삼송동 사무용 책상철거", "덕양구 집기폐기"),
    ([], "김포시 사무실 이사폐기물 사우동 사무가구철거", "김포시 이사폐기물"),
    # 글루 단일 해시태그(#진해스탠드에어컨청소): 제목 서비스로 끝나면 앞부분=지역(수식어 제거). puleenbe 실측.
    (["진해스탠드에어컨청소"], "완전 분해 세척으로 진해 스탠드에어컨청소 해야하는 이유", "진해 에어컨청소"),
    (["용원에어컨청소"], "에어컨 관리 시기를 놓치지 마세요 용원 에어컨청소", "용원 에어컨청소"),
    (["진영천장형에어컨청소"], "분해 후 오염을 제거해야하는 이유 진영 천장형 에어컨청소", "진영 에어컨청소"),
    (["포트폴리오"], "청라 공장 간판 빠른 시안", "청라 간판"),
    # 지역 없이 수식어만인 해시태그 → 수식어를 지역으로 오인하지 말고 제목 폴백(독립검증 지적 반영).
    (["스탠드에어컨청소"], "에어컨청소 후기", "에어컨청소"),
    (["아파트청소", "주택청소"], "엉뚱제목", "주택청소"),  # 해시태그 그대로(거짓지역 아님)
    # 업종 해시태그(폐업/매입 등 제목으론 못 잡는 업종) → 해시태그 그대로. themansystem/winnerkitchen 실측.
    (["시설물공공기관유지관리청소경비", "시설물유지관리업체", "공공기관청소경비"],
     "시설물 공공기관 유지 관리 청소 경비를 함께 운영해야 하는 이유", "공공기관청소경비"),
    (["천안식당창업", "천안식당폐업", "천안주방용품", "천안주방용품매입", "천안식당집기"],
     "천안 식당 창업에 활용되는 식당집기, 도시락 전문점 폐업 주방용품 매입 사례", "천안 식당창업"),
]

HASHTAG_HTML_CASES = [
    ('<span class="__se-hash-tag">#진해스탠드에어컨청소</span>x<span class="__se-hash-tag">#진해에어컨청소</span><span class="__se-hash-tag">#진해스탠드에어컨청소</span>',
     ["진해스탠드에어컨청소", "진해에어컨청소"]),
    ("<p>no tags</p>", []),
    ('x var gsTagName = "천안식당창업,천안식당폐업,천안주방용품"; y', ["천안식당창업", "천안식당폐업", "천안주방용품"]),
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
    for html_in, exp in HASHTAG_HTML_CASES:
        got = c.extract_hashtags_from_html(html_in)
        ok = got == exp
        print(f"  {'PASS' if ok else 'FAIL'}  extract_hashtags: {got!r} (기대 {exp!r})")
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
    for desc, bid, lno, exp_rank, exp_status in PERPOST_CASES:
        try:
            rank, status = c._rank_in_popular(_read(PERPOST_DUMP), bid, lno)
        except FileNotFoundError:
            print(f"  SKIP  {desc}: 덤프 없음({PERPOST_DUMP})")
            continue
        ok = (rank == exp_rank and status == exp_status)
        print(f"  {'PASS' if ok else 'FAIL'}  {desc}: rank={rank} status={status} (기대 {exp_rank}/{exp_status})")
        if not ok:
            failed += 1
    for desc, bid, lno, exp_rank, exp_status in PERPOST2_CASES:
        try:
            rank, status = c._rank_in_popular(_read(PERPOST_DUMP2), bid, lno)
        except FileNotFoundError:
            print(f"  SKIP  {desc}: 덤프 없음({PERPOST_DUMP2})")
            continue
        ok = (rank == exp_rank and status == exp_status)
        print(f"  {'PASS' if ok else 'FAIL'}  {desc}: rank={rank} status={status} (기대 {exp_rank}/{exp_status})")
        if not ok:
            failed += 1
    for desc, bid, lno, exp_rank, exp_status in PERPOST3_CASES:
        try:
            rank, status = c._rank_in_popular(_read(PERPOST_DUMP3), bid, lno)
        except FileNotFoundError:
            print(f"  SKIP  {desc}: 덤프 없음({PERPOST_DUMP3})")
            continue
        ok = (rank == exp_rank and status == exp_status)
        print(f"  {'PASS' if ok else 'FAIL'}  {desc}: rank={rank} status={status} (기대 {exp_rank}/{exp_status})")
        if not ok:
            failed += 1
    for desc, bid, lno, exp_rank, exp_status in PERPOST4_CASES:
        try:
            rank, status = c._rank_in_popular(_read(PERPOST_DUMP4), bid, lno)
        except FileNotFoundError:
            print(f"  SKIP  {desc}: 덤프 없음({PERPOST_DUMP4})")
            continue
        ok = (rank == exp_rank and status == exp_status)
        print(f"  {'PASS' if ok else 'FAIL'}  {desc}: rank={rank} status={status} (기대 {exp_rank}/{exp_status})")
        if not ok:
            failed += 1
    for desc, bid, lno, exp_rank, exp_status in PERPOST5_CASES:
        try:
            rank, status = c._rank_in_popular(_read(PERPOST_DUMP5), bid, lno)
        except FileNotFoundError:
            print(f"  SKIP  {desc}: 덤프 없음({PERPOST_DUMP5})")
            continue
        ok = (rank == exp_rank and status == exp_status)
        print(f"  {'PASS' if ok else 'FAIL'}  {desc}: rank={rank} status={status} (기대 {exp_rank}/{exp_status})")
        if not ok:
            failed += 1
    for desc, dump, bid, lno, exp in WEBSITE_CASES:
        try:
            got = c._website_present(_read(dump), bid, lno)
        except FileNotFoundError:
            print(f"  SKIP  {desc}: 덤프 없음({dump})")
            continue
        ok = (got == exp)
        print(f"  {'PASS' if ok else 'FAIL'}  {desc}: {got} (기대 {exp})")
        if not ok:
            failed += 1
    if failed:
        print(f"\n[FAIL] {failed}건 실패 — 네이버 구조 변경 가능성. 재덤프 후 파서 점검 필요.")
        sys.exit(1)
    print("\n[OK] 전체 통과")


if __name__ == "__main__":
    main()
