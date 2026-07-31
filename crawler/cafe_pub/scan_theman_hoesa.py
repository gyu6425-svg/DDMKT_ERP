# [main 전용] 더맨 '회사보안' 키워드 발굴 — 1단계 {지역} 회사보안 + 2단계 서울 {구}구/{구} 회사보안.
#   모바일 m.search 인기글 섹션 탐지(순위 크롤러와 동일) + 광고 제외 상위 개수.  ⛔ sub 실행금지.
import os, sys, json, time, random
from urllib.parse import quote
from scan_common import cafe_popular as pop_count   # 카페 카드 ≥3 기준(블로그위주 섹션 오탐 방지)

BUSINESS = '회사보안'

def scan(kw):
    ok, n = pop_count(kw)
    time.sleep(random.uniform(2.5, 4.0))
    return ok, n

# 1단계 후보 — 경기·인천·광역 시(일반형만)
CITIES = ['고양','화성','남양주','평택','시흥','파주','김포','광명','의정부','안산','하남','구리',
          '군포','의왕','오산','인천','천안','청주','대전','대구','부산','울산','창원']
# 2단계 — 서울 25구(구형 vs 일반형 둘 다). 이미 일반형 발행한 구도 구형은 별개라 포함.
SEOUL_GU = ['종로구','중구','용산구','성동구','광진구','동대문구','중랑구','성북구','강북구','도봉구',
            '노원구','은평구','서대문구','마포구','양천구','강서구','구로구','금천구','영등포구','동작구',
            '관악구','서초구','강남구','송파구','강동구']

def main():
    print(f'[더맨 회사보안 스캔] 1단계 {len(CITIES)}시 + 2단계 서울 {len(SEOUL_GU)}구×2형태', flush=True)
    print('\n===== 1단계: {지역} 회사보안 =====', flush=True)
    s1 = []
    for city in CITIES:
        ok, n = scan(f'{city} {BUSINESS}')
        print(f'  {"O" if ok else "x"} {city} 회사보안' + (f' 상위{n}' if ok else ''), flush=True)
        if ok:
            s1.append({'region': city, 'top': n})

    print('\n===== 2단계: 서울 구 (구형 vs 일반형) =====', flush=True)
    s2 = []
    for gu in SEOUL_GU:
        base = gu[:-1] if gu.endswith('구') else gu       # 강남구 → 강남
        ok_g, n_g = scan(f'{gu} {BUSINESS}')              # 구형: 강남구 회사보안
        ok_b, n_b = scan(f'{base} {BUSINESS}')            # 일반형: 강남 회사보안
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

    json.dump({'step1': s1, 'step2': s2}, open('theman_hoesa.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)
    print('\n===== 요약 =====', flush=True)
    print('[1단계]', ', '.join(f'{x["region"]} O(상위{x["top"]})' for x in s1) or '(없음)', flush=True)
    print('[2단계]', ', '.join(f'{x["gu"]} O({x["form"]},상위{x["top"]})' for x in s2) or '(없음)', flush=True)
    print(f'\n통과 1단계 {len(s1)} · 2단계 {len(s2)} · theman_hoesa.json 저장', flush=True)

if __name__ == '__main__':
    main()
