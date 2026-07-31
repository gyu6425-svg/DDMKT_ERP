# [main 전용] 더반 '입주청소' 시/구 단위 발굴 — PC 통합검색 정확판정(scan_common). ⛔ sub 실행금지.
#   1단계: 경기·인천 시 {시} 입주청소 / 2단계: 서울 25구 {구}구·{구} 입주청소(양쪽형).
import os, sys, json, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan_common import cafe_popular as pop

BUSINESS = '입주청소'

# 이미 발행(더반/더티) 참고 — 제외 아님(구형/일반형 별개일 수 있어 다 스캔), 표시만.
DONE = {'과천', '수원', '성남', '하남', '광진구', '금천구', '동대문구', '부천', '용인', '고양', '송파구'}

CITIES = ['수원', '성남', '고양', '용인', '부천', '안산', '안양', '평택', '시흥', '파주', '김포',
          '광명', '의정부', '남양주', '화성', '군포', '의왕', '오산', '하남', '구리', '광주', '과천',
          '인천', '부평', '연수', '남동', '계양', '미추홀']
SEOUL_GU = ['종로', '중구', '용산', '성동', '광진', '동대문', '중랑', '성북', '강북', '도봉',
            '노원', '은평', '서대문', '마포', '양천', '강서', '구로', '금천', '영등포', '동작',
            '관악', '서초', '강남', '송파', '강동']


def scan(kw):
    ok, n = pop(kw)
    time.sleep(random.uniform(2.5, 4.0))
    return ok, n


def main():
    print(f'[더반 입주청소 시/구 스캔] 시 {len(CITIES)} + 서울 {len(SEOUL_GU)}구×2형태', flush=True)
    print('\n===== 1단계: {시} 입주청소 =====', flush=True)
    s1 = []
    for city in CITIES:
        ok, n = scan(f'{city} {BUSINESS}')
        tag = ' (이미발행)' if city in DONE else ''
        print(f'  {"O" if ok else "x"} {city} 입주청소' + (f' 카페{n}' if ok else '') + tag, flush=True)
        if ok:
            s1.append({'region': city, 'cafe': n, 'done': city in DONE})

    print('\n===== 2단계: 서울 구 (구형 vs 일반형) =====', flush=True)
    s2 = []
    for gu in SEOUL_GU:
        base = gu[:-1] if gu.endswith('구') else gu
        ok_gu, n_gu = scan(f'{gu}구 {BUSINESS}')     # 구형: 강남구 입주청소
        ok_b, n_b = scan(f'{gu} {BUSINESS}')          # 일반형: 강남 입주청소
        if ok_gu:
            form, n = '구형', n_gu
        elif ok_b:
            form, n = '일반형', n_b
        else:
            form, n = 'X', 0
        print(f'  {gu}: 구형={"O"+str(n_gu) if ok_gu else "x"} 일반형={"O"+str(n_b) if ok_b else "x"} → {form}'
              + (f'(카페{n})' if form != 'X' else ''), flush=True)
        if form != 'X':
            s2.append({'gu': gu, 'form': form, 'cafe': n})

    json.dump({'step1': s1, 'step2': s2}, open('durban_region.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('\n===== 요약 =====', flush=True)
    print('[1단계 시]', ', '.join(f'{x["region"]}({x["cafe"]}){"·발행" if x["done"] else ""}' for x in s1) or '없음', flush=True)
    print('[2단계 구]', ', '.join(f'{x["gu"]}({x["form"]},{x["cafe"]})' for x in s2) or '없음', flush=True)
    print(f'\n통과 시 {len(s1)} · 구 {len(s2)} · durban_region.json 저장', flush=True)


if __name__ == '__main__':
    main()
