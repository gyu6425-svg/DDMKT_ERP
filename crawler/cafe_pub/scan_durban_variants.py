# [main 전용] 더반 — 청소 계열 키워드 변형 발굴. 어떤 변형이 인기탭 잘 뜨는지 지역×변형 탐색.
#   판정=PC 통합검색(scan_common). ⛔ sub 실행금지.
import os, sys, json, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan_common import cafe_popular as pop

# 입주청소 인접 청소 변형(더반 도메인)
VARIANTS = ['이사청소', '준공청소', '입주청소업체', '이사청소업체', '상가청소', '사무실청소',
            '원룸청소', '새집청소', '청소업체', '거주청소', '준공청소업체', '에어컨청소', '왁싱']
# 입주청소가 인기탭 떴던 강한 지역
REGIONS = ['성남', '강남', '은평', '부천', '수원', '용인', '안산', '광진', '송파', '중구', '안양', '화성']


def scan(kw):
    ok, n = pop(kw)
    time.sleep(random.uniform(2.5, 4.0))
    return ok, n


def main():
    total = len(VARIANTS) * len(REGIONS)
    print(f'[더반 청소 변형 탐색] 변형 {len(VARIANTS)} × 지역 {len(REGIONS)} = {total}개 (약 {total*5//60}분)', flush=True)
    by_variant = {v: [] for v in VARIANTS}
    for v in VARIANTS:
        for r in REGIONS:
            ok, n = scan(f'{r} {v}')
            if ok:
                by_variant[v].append((r, n))
                print(f'  O {r} {v} (카페{n})', flush=True)
    print('\n===== 변형별 인기탭 적중 =====', flush=True)
    for v, hits in sorted(by_variant.items(), key=lambda kv: -len(kv[1])):
        regs = ', '.join(f'{r}({n})' for r, n in hits)
        print(f'  {v}: {len(hits)}/{len(REGIONS)} → {regs or "없음"}', flush=True)
    json.dump({v: hits for v, hits in by_variant.items()}, open('durban_variants.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('\ndurban_variants.json 저장 — 적중 높은 변형은 전 지역 확대 스캔 권장', flush=True)


if __name__ == '__main__':
    main()
