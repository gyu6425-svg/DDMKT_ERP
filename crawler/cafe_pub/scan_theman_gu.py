# [main 전용] 더맨 '회사보안' — 수도권 시·광역시의 '구' 단위 발굴. "{시} {구} 회사보안".
#   교정된 판정(scan_common: 카페 카드 ≥3). ⛔ sub 실행금지.
import os, sys, json, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan_common import cafe_popular as pop_count

BUSINESS = '회사보안'

# 시별 일반구(자치구/일반구). "{시} {구} 회사보안" 형태로 조회.
METRO_GU = {
    '수원': ['장안구', '권선구', '팔달구', '영통구'],
    '성남': ['수정구', '중원구', '분당구'],
    '고양': ['덕양구', '일산동구', '일산서구'],
    '용인': ['처인구', '기흥구', '수지구'],
    '부천': ['원미구', '소사구', '오정구'],
    '안산': ['상록구', '단원구'],
    '안양': ['만안구', '동안구'],
    '인천': ['중구', '동구', '미추홀구', '연수구', '남동구', '부평구', '계양구', '서구'],
    '대전': ['동구', '중구', '서구', '유성구', '대덕구'],
    '대구': ['중구', '동구', '서구', '남구', '북구', '수성구', '달서구'],
    '광주': ['동구', '서구', '남구', '북구', '광산구'],
    '울산': ['중구', '남구', '동구', '북구'],
    '부산': ['부산진구', '동래구', '남구', '북구', '해운대구', '사하구', '금정구',
             '연제구', '수영구', '사상구', '기장군'],
    '창원': ['의창구', '성산구', '마산합포구', '마산회원구', '진해구'],
    '청주': ['상당구', '서원구', '흥덕구', '청원구'],
    '천안': ['동남구', '서북구'],
}


def main():
    cands = []
    for city, gus in METRO_GU.items():
        for gu in gus:
            cands.append((city, gu, f'{city} {gu} {BUSINESS}'))
    total = len(cands)
    print(f'[더맨 회사보안 · 수도권/광역시 구단위] 후보 {total}개 (약 {total*3//60}분)', flush=True)
    hits = []
    for i, (city, gu, kw) in enumerate(cands, 1):
        ok, n = pop_count(kw)
        print(f'{i:>3}/{total} {"O" if ok else "x"} {kw}' + (f' 카페{n}' if ok else ''), flush=True)
        if ok:
            hits.append({'city': city, 'gu': gu, 'keyword': kw, 'cafe': n})
        time.sleep(random.uniform(2.5, 4.0))
    json.dump(hits, open('theman_hoesa_gu.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('\n===== 인기탭 통과(구단위) =====', flush=True)
    for h in hits:
        print(f'  {h["keyword"]} (카페{h["cafe"]})', flush=True)
    print(f'\n통과 {len(hits)}/{total} · theman_hoesa_gu.json 저장', flush=True)


if __name__ == '__main__':
    main()
