# [main 전용] 더반 — top 청소 변형(이사청소·청소업체·준공청소·거주청소) 수도권 전지역 확대.
#   판정=PC 통합검색(scan_common). ⛔ sub 실행금지.
import os, sys, json, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan_common import cafe_popular as pop

VARIANTS = ['이사청소', '청소업체', '준공청소', '거주청소']

SEOUL_GU = ['종로', '중구', '용산', '성동', '광진', '동대문', '중랑', '성북', '강북', '도봉',
            '노원', '은평', '서대문', '마포', '양천', '강서', '구로', '금천', '영등포', '동작',
            '관악', '서초', '강남', '송파', '강동']
GYEONGGI = ['수원', '성남', '고양', '용인', '부천', '안산', '안양', '평택', '시흥', '파주',
            '김포', '광명', '의정부', '남양주', '화성', '군포', '의왕', '오산', '하남', '구리', '광주', '과천']
INCHEON = ['인천', '부평', '연수', '남동', '계양', '미추홀']
REGIONS = SEOUL_GU + GYEONGGI + INCHEON


def scan(kw):
    ok, n = pop(kw)
    time.sleep(random.uniform(2.5, 4.0))
    return ok, n


def main():
    total = len(VARIANTS) * len(REGIONS)
    print(f'[청소 변형 확대스캔] 변형 {len(VARIANTS)} × 지역 {len(REGIONS)} = {total}개 (약 {total*5//60}분)', flush=True)
    result = {v: [] for v in VARIANTS}
    for v in VARIANTS:
        print(f'\n----- {v} -----', flush=True)
        for r in REGIONS:
            ok, n = scan(f'{r} {v}')
            if ok:
                result[v].append({'region': r, 'cafe': n})
                print(f'  O {r} {v} (카페{n})', flush=True)
    json.dump(result, open('durban_clean_full.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('\n===== 변형별 통과 지역 =====', flush=True)
    for v in VARIANTS:
        regs = ', '.join(f'{x["region"]}({x["cafe"]})' for x in result[v])
        print(f'[{v}] {len(result[v])}곳: {regs or "없음"}', flush=True)
    print('\ndurban_clean_full.json 저장', flush=True)


if __name__ == '__main__':
    main()
