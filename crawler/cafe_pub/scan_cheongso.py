# [main 전용] '청소업체' 시/구 발굴 — PC 통합검색 정확판정. 서울 25구 both-form + 경기/인천 시. ⛔ sub 실행금지.
import os, sys, json, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan_common import cafe_popular as pop

BUSINESS = '청소업체'

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
    print(f'[청소업체 시/구 스캔] 시 {len(CITIES)} + 서울 {len(SEOUL_GU)}구×2형태', flush=True)
    print('\n===== 1단계: {시} 청소업체 =====', flush=True)
    s1 = []
    for city in CITIES:
        ok, n = scan(f'{city} {BUSINESS}')
        print(f'  {"O" if ok else "x"} {city} 청소업체' + (f' 카페{n}' if ok else ''), flush=True)
        if ok:
            s1.append({'region': city, 'cafe': n})

    print('\n===== 2단계: 서울 구 (구형 vs 일반형) =====', flush=True)
    s2 = []
    for gu in SEOUL_GU:
        ok_gu, n_gu = scan(f'{gu}구 {BUSINESS}')
        ok_b, n_b = scan(f'{gu} {BUSINESS}')
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

    json.dump({'step1': s1, 'step2': s2}, open('cheongso.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('\n===== 요약 =====', flush=True)
    print('[1단계 시]', ', '.join(f'{x["region"]}({x["cafe"]})' for x in s1) or '없음', flush=True)
    print('[2단계 구]', ', '.join(f'{x["gu"]}({x["form"]},{x["cafe"]})' for x in s2) or '없음', flush=True)
    print(f'\n통과 시 {len(s1)} · 구 {len(s2)} · cheongso.json 저장', flush=True)


if __name__ == '__main__':
    main()
