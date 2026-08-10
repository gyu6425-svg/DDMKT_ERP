# [main 전용] 더반 '입주청소' 동 단위 전수 — 서울(DONG_DICT)+경기/인천(METRO_DONG) 341동.
#   PC 통합검색 정확판정(scan_common). dong 단독형 "{동} 입주청소". ⛔ sub 실행금지.
import os, sys, json, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan_common import cafe_popular as pop
import cafe_auto_publish_ddclean as D

BUSINESS = '입주청소'
EXCLUDE = {'길동', '번동', '창동', '목동', '등촌동'}   # 이미 통과·발행


def main():
    cands = []
    seen = set()
    for gu, dongs in (D.DONG_DICT or {}).items():
        for dong in dongs:
            if dong in EXCLUDE or dong in seen:
                continue
            seen.add(dong); cands.append(('서울', gu, dong))
    for city, dongs in (D.METRO_DONG or {}).items():
        for dong in dongs:
            if dong in EXCLUDE or dong in seen:
                continue
            seen.add(dong); cands.append(('경기/인천', city, dong))
    total = len(cands)
    print(f'[더반 입주청소 동 전수] {total}동 (서울+경기/인천) · PC판정 (약 {total*5//60}분)', flush=True)
    hits = []
    for i, (area, region, dong) in enumerate(cands, 1):
        ok, n = pop(f'{dong} {BUSINESS}')
        print(f'{i:>3}/{total} {"O" if ok else "x"} {dong} 입주청소' + (f' 카페{n}  [{region}]' if ok else ''), flush=True)
        if ok:
            hits.append({'area': area, 'region': region, 'dong': dong, 'keyword': f'{dong} 입주청소', 'cafe': n})
        time.sleep(random.uniform(2.5, 4.0))
    # 기존 5동 + 신규 병합
    base5 = [{'area': '서울', 'region': '기존', 'dong': d, 'keyword': f'{d} 입주청소', 'cafe': None} for d in EXCLUDE]
    json.dump(base5 + hits, open('durban_dong.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('\n===== 인기탭 통과 동(신규) =====', flush=True)
    for h in hits:
        print(f'  [{h["region"]}] {h["dong"]} 입주청소 (카페{h["cafe"]})', flush=True)
    print(f'\n신규 {len(hits)}/{total} · 기존5동 포함 총 {len(hits)+5} · durban_dong.json 저장', flush=True)


if __name__ == '__main__':
    main()
