# [main 전용] 이사청소 동 전수 — 서울(DONG_DICT)+경기/인천(METRO_DONG) 341동. PC판정. ⛔ sub 실행금지.
import os, sys, json, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan_common import cafe_popular as pop
import cafe_auto_publish_ddclean as D

BUSINESS = '이사청소'
# 입주청소 통과 12동 — 이사청소로도 되는지 표시용(제외 안 함)
IIP12 = {'길동', '번동', '창동', '목동', '등촌동', '능동', '항동', '사동', '중동', '상동', '와동동', '당동'}


def main():
    cands = []
    seen = set()
    for gu, dongs in (D.DONG_DICT or {}).items():
        for dong in dongs:
            if dong in seen:
                continue
            seen.add(dong); cands.append(('서울', gu, dong))
    for city, dongs in (D.METRO_DONG or {}).items():
        for dong in dongs:
            if dong in seen:
                continue
            seen.add(dong); cands.append(('경기/인천', city, dong))
    total = len(cands)
    print(f'[이사청소 동 전수] {total}동 · PC판정 (약 {total*5//60}분)', flush=True)
    hits = []
    for i, (area, region, dong) in enumerate(cands, 1):
        ok, n = pop(f'{dong} {BUSINESS}')
        mark = ' ★입주청소도O' if dong in IIP12 else ''
        print(f'{i:>3}/{total} {"O" if ok else "x"} {dong} 이사청소' + (f' 카페{n} [{region}]{mark}' if ok else ''), flush=True)
        if ok:
            hits.append({'area': area, 'region': region, 'dong': dong, 'keyword': f'{dong} 이사청소', 'cafe': n, 'also_iipju': dong in IIP12})
        time.sleep(random.uniform(2.5, 4.0))
    json.dump(hits, open('isacheong_dong.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('\n===== 이사청소 인기탭 동 =====', flush=True)
    for h in hits:
        print(f'  [{h["region"]}] {h["dong"]} 이사청소 (카페{h["cafe"]}){" ★입주청소겹침" if h["also_iipju"] else ""}', flush=True)
    overlap = sum(1 for h in hits if h['also_iipju'])
    print(f'\n통과 {len(hits)}/{total} · 입주청소12동과 겹침 {overlap}/12 · isacheong_dong.json 저장', flush=True)


if __name__ == '__main__':
    main()
