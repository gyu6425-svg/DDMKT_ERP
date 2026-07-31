# [main 전용] 설고점 '소방업체' 키워드 발굴 — 1단계 {지역} 소방업체 + 2단계 서울 {구}구/{구} 소방업체.
#   모바일 m.search 인기글 섹션 탐지(순위 크롤러와 동일) + 광고 제외 상위 개수.  ⛔ sub 실행금지.
import os, sys, json, time, random
from urllib.parse import quote
from scan_common import cafe_popular as pop_count   # 카페 카드 ≥3 기준(블로그위주 섹션 오탐 방지)

BUSINESS = '소방업체'   # 설고점 업종어. 소방점검으로 바꾸려면 이 한 줄만 수정.

def scan(kw):
    ok, n = pop_count(kw)
    time.sleep(random.uniform(2.5, 4.0))
    return ok, n

# 이미 발행된 설고 지역(참고·제외 판단용) — 성북·강남·노원·종로·도봉·은평
DONE = {'성북', '강남', '노원', '종로', '도봉', '은평'}
# 1단계 후보 — 경기·인천·광역 시
CITIES = ['고양','화성','남양주','평택','시흥','파주','김포','광명','의정부','안산','하남','구리',
          '군포','의왕','오산','인천','천안','청주','대전','대구','부산','울산','창원','성남','부천','용인','안양']
# 2단계 — 서울 25구(구형 vs 일반형)
SEOUL_GU = ['종로구','중구','용산구','성동구','광진구','동대문구','중랑구','성북구','강북구','도봉구',
            '노원구','은평구','서대문구','마포구','양천구','강서구','구로구','금천구','영등포구','동작구',
            '관악구','서초구','강남구','송파구','강동구']

def main():
    print(f'[설고 소방업체 스캔] 1단계 {len(CITIES)}시 + 2단계 서울 {len(SEOUL_GU)}구×2형태', flush=True)
    print('\n===== 1단계: {지역} 소방업체 =====', flush=True)
    s1 = []
    for city in CITIES:
        ok, n = scan(f'{city} {BUSINESS}')
        tag = ' (이미발행)' if city in DONE else ''
        print(f'  {"O" if ok else "x"} {city} 소방업체' + (f' 상위{n}' if ok else '') + tag, flush=True)
        if ok:
            s1.append({'region': city, 'top': n, 'done': city in DONE})

    print('\n===== 2단계: 서울 구 (구형 vs 일반형) =====', flush=True)
    s2 = []
    for gu in SEOUL_GU:
        base = gu[:-1] if gu.endswith('구') else gu
        ok_g, n_g = scan(f'{gu} {BUSINESS}')
        ok_b, n_b = scan(f'{base} {BUSINESS}')
        if ok_g:
            form, n = '구형', n_g
        elif ok_b:
            form, n = '일반형', n_b
        else:
            form, n = 'X', 0
        print(f'  {gu}: 구형={"O"+str(n_g) if ok_g else "x"} 일반형={"O"+str(n_b) if ok_b else "x"} → 채택={form}'
              + (f'(상위{n})' if form != 'X' else ''), flush=True)
        if form != 'X':
            s2.append({'gu': gu, 'form': form, 'top': n})

    json.dump({'step1': s1, 'step2': s2}, open('seolgo_sobang.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)
    print('\n===== 요약 =====', flush=True)
    print('[1단계]', ', '.join(f'{x["region"]} O(상위{x["top"]}){"·이미발행" if x["done"] else ""}' for x in s1) or '(없음)', flush=True)
    print('[2단계]', ', '.join(f'{x["gu"]} O({x["form"]},상위{x["top"]})' for x in s2) or '(없음)', flush=True)
    print(f'\n통과 1단계 {len(s1)} · 2단계 {len(s2)} · seolgo_sobang.json 저장', flush=True)

if __name__ == '__main__':
    main()
