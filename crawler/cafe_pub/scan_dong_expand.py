# [main 전용] 입주청소 동 풀 확장 — 아직 안 훑은 서울 동(초기목록 - DONG_DICT/METRO)만 추가 PC스캔.
#   더반/더티 나눠 쓸 동 풀 확대. ⛔ sub 실행금지.
import os, sys, json, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan_common import cafe_popular as pop
import cafe_auto_publish_ddclean as D
import scan_durban_seoul as S   # 초기 SEOUL dict(다른 동 다수)

BUSINESS = '입주청소'
FOUND = {'길동', '번동', '창동', '목동', '등촌동', '능동', '항동', '사동', '중동', '상동', '와동동', '당동'}

# 이미 스캔한 동(DONG_DICT + METRO) — 제외
scanned = set()
for v in (D.DONG_DICT or {}).values():
    scanned.update(v)
for v in (D.METRO_DONG or {}).values():
    scanned.update(v)

# 초기 SEOUL dict 중 아직 안 훑은 동만
cands = []
seen = set()
for gu, dongs in (S.SEOUL or {}).items():
    for dong in dongs:
        if dong in FOUND or dong in scanned or dong in seen:
            continue
        seen.add(dong); cands.append((gu, dong))


def main():
    total = len(cands)
    print(f'[동 풀 확장] 미스캔 서울 동 {total}개 PC판정 (약 {total*5//60}분)', flush=True)
    hits = []
    for i, (gu, dong) in enumerate(cands, 1):
        ok, n = pop(f'{dong} {BUSINESS}')
        print(f'{i:>3}/{total} {"O" if ok else "x"} {dong} 입주청소' + (f' 카페{n} [{gu}]' if ok else ''), flush=True)
        if ok:
            hits.append({'gu': gu, 'dong': dong, 'keyword': f'{dong} 입주청소', 'cafe': n})
        time.sleep(random.uniform(2.5, 4.0))
    json.dump(hits, open('dong_expand.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('\n===== 추가 인기탭 동 =====', flush=True)
    for h in hits:
        print(f'  [{h["gu"]}] {h["dong"]} 입주청소 (카페{h["cafe"]})', flush=True)
    print(f'\n추가 {len(hits)}/{total} · dong_expand.json 저장', flush=True)


if __name__ == '__main__':
    main()
