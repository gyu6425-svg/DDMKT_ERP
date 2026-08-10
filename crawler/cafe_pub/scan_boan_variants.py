# [main 전용] 더맨 — 보안/경호 계열 키워드 변형 발굴. 어떤 변형이 인기탭 잘 뜨는지 지역×변형 탐색.
#   판정=PC 통합검색(scan_common). ⛔ sub 실행금지.
import os, sys, json, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan_common import cafe_popular as pop

# 보안/경호 계열 변형(시설경호업체 도메인)
VARIANTS = ['경호업체', '시설경호', '시설경호업체', '경비업체', '무인경비', '보안업체',
            '시설보안', '경호경비', '특수경비', '신변보호', '사설경호', '건물경비', '경비업']
# 회사보안이 인기탭 떴던 강한 지역 + 대표 시로 변형 반응 테스트
REGIONS = ['송파', '성북', '강북', '은평', '강동', '중랑', '대전', '창원', '수원', '인천']


def scan(kw):
    ok, n = pop(kw)
    time.sleep(random.uniform(2.5, 4.0))
    return ok, n


def main():
    total = len(VARIANTS) * len(REGIONS)
    print(f'[보안/경호 변형 탐색] 변형 {len(VARIANTS)} × 지역 {len(REGIONS)} = {total}개 (약 {total*4//60}분)', flush=True)
    by_variant = {v: [] for v in VARIANTS}
    for v in VARIANTS:
        for r in REGIONS:
            ok, n = scan(f'{r} {v}')
            if ok:
                by_variant[v].append((r, n))
                print(f'  O {r} {v} (카페{n})', flush=True)
    print('\n===== 변형별 인기탭 적중 =====', flush=True)
    ranked = sorted(by_variant.items(), key=lambda kv: -len(kv[1]))
    for v, hits in ranked:
        regs = ', '.join(f'{r}({n})' for r, n in hits)
        print(f'  {v}: {len(hits)}/{len(REGIONS)} → {regs or "없음"}', flush=True)
    json.dump({v: hits for v, hits in by_variant.items()}, open('boan_variants.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('\nboan_variants.json 저장 — 적중 높은 변형은 전 지역 확대 스캔 권장', flush=True)


if __name__ == '__main__':
    main()
