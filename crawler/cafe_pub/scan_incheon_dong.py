# [main 전용] 인천 동 입주청소 확장 — METRO에 없던 인천 동 추가 PC스캔. ⛔ sub 실행금지.
import os, sys, json, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan_common import cafe_popular as pop
import cafe_auto_publish_ddclean as D

BUSINESS = '입주청소'

# 인천 전 구 실재 동(주거 위주). METRO에 있던 건 스크립트가 제외.
INCHEON = {
    '중구': ['신포동', '연안동', '신흥동', '도원동', '율목동', '영종동', '운서동'],
    '동구': ['만석동', '화수동', '송현동', '송림동', '금창동', '창영동'],
    '미추홀구': ['문학동', '관교동', '주안동', '도화동', '숭의동', '용현동', '학익동'],
    '연수구': ['송도동', '연수동', '옥련동', '청학동', '동춘동', '선학동'],
    '남동구': ['구월동', '논현동', '만수동', '간석동', '서창동', '장수동', '남촌동'],
    '부평구': ['부평동', '산곡동', '삼산동', '부개동', '십정동', '청천동', '갈산동', '일신동'],
    '계양구': ['작전동', '계산동', '효성동', '병방동', '임학동', '용종동', '서운동', '귤현동'],
    '서구': ['청라동', '가정동', '석남동', '당하동', '검암동', '신현동', '마전동', '심곡동', '연희동', '가좌동', '검단동'],
}

# METRO 에서 이미 스캔한 인천 동 제외
scanned = set()
for k, v in (D.METRO_DONG or {}).items():
    if '인천' in k:
        scanned.update(v)
FOUND = {'길동', '번동', '창동', '목동', '등촌동', '능동', '항동', '사동', '중동', '상동', '와동동', '당동'}

cands = []
seen = set()
for gu, dongs in INCHEON.items():
    for dong in dongs:
        if dong in scanned or dong in FOUND or dong in seen:
            continue
        seen.add(dong); cands.append((gu, dong))


def main():
    total = len(cands)
    print(f'[인천 동 확장] 미스캔 인천 동 {total}개 PC판정 (약 {total*5//60}분)', flush=True)
    hits = []
    for i, (gu, dong) in enumerate(cands, 1):
        ok, n = pop(f'{dong} {BUSINESS}')
        print(f'{i:>3}/{total} {"O" if ok else "x"} {dong} 입주청소' + (f' 카페{n} [{gu}]' if ok else ''), flush=True)
        if ok:
            hits.append({'gu': gu, 'dong': dong, 'keyword': f'{dong} 입주청소', 'cafe': n})
        time.sleep(random.uniform(2.5, 4.0))
    json.dump(hits, open('incheon_dong.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('\n===== 인천 인기탭 동 =====', flush=True)
    for h in hits:
        print(f'  [{h["gu"]}] {h["dong"]} 입주청소 (카페{h["cafe"]})', flush=True)
    print(f'\n인천 추가 {len(hits)}/{total} · incheon_dong.json 저장', flush=True)


if __name__ == '__main__':
    main()
