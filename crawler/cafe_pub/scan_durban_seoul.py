# [main 전용] 더반클린 — 서울 자치구×동 '입주청소' 인기탭 스캔. ⛔ sub에서 실행 금지(네이버 차단).
#   {구}구 {동} 입주청소 / {동} 입주청소 두 형태로 인기탭(리뷰/카페 인기글 섹션) 유무를 확인.
#   통과분만 dong_durban_seoul.json + 콘솔 목록 출력 → sub2가 그 (구·동·형태)로 더반 발행 큐 생성.
import os, sys, json, time, random
from urllib.parse import quote
# 검증된 카페 인기탭 탐지(모바일 m.search 부트스트랩) 재사용 — PC검색+리뷰부트스트랩은 입주청소에서 안 잡힘.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import blog_rank_crawler as c
from scan_common import cafe_popular as pop_count   # 카페 카드 ≥3 기준(블로그위주 섹션 오탐 방지)

BUSINESS = '입주청소'   # 업종어. 누수탐지로 바꾸려면 이 한 줄만 수정.


def has_pop(kw):
    return pop_count(kw)[0]


# 서울 자치구 × 실재 동(주거 밀집 위주). 인기탭 없는 동은 자동 탈락하므로 넉넉히 포함.
SEOUL = {
    '강남구': ['역삼동', '삼성동', '대치동', '논현동', '청담동', '압구정동', '개포동', '수서동', '일원동', '도곡동'],
    '서초구': ['서초동', '반포동', '잠원동', '방배동', '양재동', '우면동'],
    '송파구': ['잠실동', '가락동', '문정동', '장지동', '방이동', '오금동', '석촌동', '송파동', '마천동', '거여동'],
    '강동구': ['천호동', '성내동', '길동', '둔촌동', '암사동', '명일동', '고덕동', '상일동'],
    '광진구': ['자양동', '구의동', '광장동', '화양동', '중곡동', '군자동'],
    '동대문구': ['전농동', '답십리동', '장안동', '청량리동', '회기동', '이문동', '휘경동', '제기동'],
    '중랑구': ['면목동', '상봉동', '중화동', '묵동', '망우동', '신내동'],
    '성동구': ['성수동', '금호동', '옥수동', '행당동', '응봉동', '마장동', '용답동', '하왕십리동'],
    '용산구': ['이태원동', '한남동', '후암동', '청파동', '효창동', '용문동', '보광동', '이촌동'],
    '성북구': ['정릉동', '길음동', '돈암동', '삼선동', '안암동', '종암동', '석관동', '장위동', '하월곡동'],
    '강북구': ['미아동', '수유동', '번동', '우이동'],
    '도봉구': ['창동', '방학동', '쌍문동', '도봉동'],
    '노원구': ['상계동', '중계동', '하계동', '월계동', '공릉동'],
    '은평구': ['응암동', '역촌동', '불광동', '갈현동', '구산동', '대조동', '증산동', '수색동', '진관동'],
    '서대문구': ['홍제동', '홍은동', '남가좌동', '북가좌동', '연희동', '대현동', '창천동'],
    '마포구': ['망원동', '합정동', '서교동', '연남동', '성산동', '상암동', '공덕동', '아현동', '도화동', '대흥동'],
    '양천구': ['목동', '신정동', '신월동'],
    '강서구': ['화곡동', '등촌동', '가양동', '염창동', '방화동', '공항동', '마곡동', '내발산동'],
    '구로구': ['구로동', '신도림동', '개봉동', '오류동', '고척동', '가리봉동'],
    '금천구': ['가산동', '독산동', '시흥동'],
    '영등포구': ['영등포동', '여의도동', '당산동', '문래동', '양평동', '신길동', '대림동', '도림동'],
    '동작구': ['노량진동', '상도동', '사당동', '대방동', '신대방동', '흑석동'],
    '관악구': ['봉천동', '신림동', '남현동'],
    '중구': ['신당동', '황학동', '중림동', '약수동', '다산동'],
}


# 이미 통과·발행한 서울 5동(재발굴 제외)
EXCLUDE = {'길동', '번동', '창동', '목동', '등촌동'}


def main():
    # gu_dong 형태는 0건 확정 → 제거, dong 단독형만. 서울은 이미 스캔완료(5동) → 경기·인천 METRO_DONG 확장.
    import cafe_auto_publish_ddclean as D
    metro = getattr(D, 'METRO_DONG', {})
    cands = []
    seen = set()
    for city, dongs in metro.items():
        for dong in dongs:
            if dong in EXCLUDE or dong in seen:
                continue
            seen.add(dong)
            cands.append((city, dong, 'dong', f'{dong} {BUSINESS}'))
    total = len(cands)
    print(f'[더반 METRO 동 스캔] 업종={BUSINESS} · 경기/인천 후보 {total}개 (약 {total*3//60}분) · 서울 5동은 기존 통과분', flush=True)
    hits = []
    for i, (city, dong, form, kw) in enumerate(cands, 1):
        ok, n = pop_count(kw)
        print(f'{i:>3}/{total} {"O" if ok else "x"} {kw}' + (f' 상위{n}' if ok else ''), flush=True)
        if ok:
            hits.append({'city': city, 'dong': dong, 'form': 'dong', 'keyword': kw, 'top': n})
        time.sleep(random.uniform(2.5, 4.0))
    # 기존 서울 5동 + 신규 METRO 통과분 병합 저장
    seoul5 = [{'city': '서울', 'dong': d, 'form': 'dong', 'keyword': f'{d} 입주청소', 'top': None}
              for d in ['길동', '번동', '창동', '목동', '등촌동']]
    allhits = seoul5 + hits
    with open('dong_durban_metro.json', 'w', encoding='utf-8') as f:
        json.dump(allhits, f, ensure_ascii=False, indent=2)
    print('\n===== METRO 인기탭 통과(신규) =====', flush=True)
    for h in hits:
        print(f'  [{h["city"]}] {h["keyword"]} (상위{h["top"]})', flush=True)
    print(f'\n신규 통과 {len(hits)}/{total} · 서울 기존 5동 포함 총 {len(allhits)} · dong_durban_metro.json 저장', flush=True)


if __name__ == '__main__':
    main()
