# [main 전용] 누수탐지 동단독형 인기탭 스캔 — nusu2 DONG_DICT(서울)+METRO_DONG(경기/인천). PC판정. ⛔ sub 실행금지.
import os, sys, json, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan_common import cafe_popular as pop
import cafe_auto_publish_nusu2 as N

BUSINESS = '누수탐지'


def main():
    cands = []
    seen = set()
    src = {**(N.DONG_DICT or {}), **(N.METRO_DONG or {})}
    for gu, dongs in src.items():
        for d in dongs:
            if d in seen:
                continue
            seen.add(d)
            cands.append((gu, d))
    total = len(cands)
    print(f'[누수탐지 동단독형] {total}동 · PC판정 (약 {total*5//60}분)', flush=True)
    hits = []
    for i, (gu, d) in enumerate(cands, 1):
        ok, n = pop(f'{d} {BUSINESS}')
        print(f'{i:>3}/{total} {"O" if ok else "x"} {d} 누수탐지' + (f' 카페{n} [{gu}]' if ok else ''), flush=True)
        if ok:
            hits.append({'region': gu, 'dong': d, 'keyword': f'{d} 누수탐지', 'cafe': n})
        time.sleep(random.uniform(2.5, 4.0))
    json.dump(hits, open('dong_nusu_verified.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('\n===== 누수탐지 인기탭 통과 동 =====', flush=True)
    for h in hits:
        print(f'  [{h["region"]}] {h["dong"]} 누수탐지 (카페{h["cafe"]})', flush=True)
    print(f'\n통과 {len(hits)}/{total} · dong_nusu_verified.json 저장', flush=True)


if __name__ == '__main__':
    main()
