# [main 전용] 수도권 big 시의 '구' 단위 입주청소·이사청소 인기탭. "{시} {구} {키워드}". PC판정. ⛔ sub 실행금지.
import os, sys, json, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan_common import cafe_popular as pop

VARIANTS = ['입주청소', '이사청소']

METRO_GU = {
    '수원': ['장안구', '권선구', '팔달구', '영통구'],
    '성남': ['수정구', '중원구', '분당구'],
    '고양': ['덕양구', '일산동구', '일산서구'],
    '용인': ['처인구', '기흥구', '수지구'],
    '부천': ['원미구', '소사구', '오정구'],
    '안산': ['상록구', '단원구'],
    '안양': ['만안구', '동안구'],
    '인천': ['중구', '동구', '미추홀구', '연수구', '남동구', '부평구', '계양구', '서구'],
}


def scan(kw):
    ok, n = pop(kw)
    time.sleep(random.uniform(2.5, 4.0))
    return ok, n


def main():
    cands = []
    for city, gus in METRO_GU.items():
        for gu in gus:
            cands.append((city, gu))
    total = len(cands) * len(VARIANTS)
    print(f'[수도권 시-구 청소] 구 {len(cands)} × 키워드 {len(VARIANTS)} = {total}개 (약 {total*5//60}분)', flush=True)
    result = {v: [] for v in VARIANTS}
    for v in VARIANTS:
        print(f'\n----- {v} -----', flush=True)
        for city, gu in cands:
            kw = f'{city} {gu} {v}'
            ok, n = scan(kw)
            if ok:
                result[v].append({'city': city, 'gu': gu, 'keyword': kw, 'cafe': n})
                print(f'  O {kw} (카페{n})', flush=True)
    json.dump(result, open('metro_gu_clean.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('\n===== 시-구 통과 =====', flush=True)
    for v in VARIANTS:
        regs = ', '.join(f'{x["city"]} {x["gu"]}({x["cafe"]})' for x in result[v])
        print(f'[{v}] {len(result[v])}곳: {regs or "없음"}', flush=True)
    print('\nmetro_gu_clean.json 저장', flush=True)


if __name__ == '__main__':
    main()
