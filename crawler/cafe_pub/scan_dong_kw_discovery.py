# [main 전용] 동 단위 잡는 키워드 발굴 — 입주청소 되던 강한 동에 여러 키워드 테스트. PC판정. ⛔ sub 실행금지.
import os, sys, time, random, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan_common import cafe_popular as pop

# 청소·홈서비스 계열(동 단위로 검색될 만한 것)
KEYWORDS = ['입주청소', '이사청소', '청소업체', '준공청소', '거주청소', '상가청소', '사무실청소',
            '원룸청소', '화장실청소', '에어컨청소', '줄눈', '줄눈시공', '인테리어', '도배', '장판',
            '포장이사', '이사', '새집증후군', '입주청소업체', '청소']
# 입주청소 동 인기탭 확인된 강한 동
DONGS = ['목동', '창동', '길동', '번동', '등촌동']


def main():
    total = len(KEYWORDS) * len(DONGS)
    print(f'[동 키워드 발굴] 키워드 {len(KEYWORDS)} × 동 {len(DONGS)} = {total}개 (약 {total*4//60}분)', flush=True)
    by_kw = {k: [] for k in KEYWORDS}
    for kw in KEYWORDS:
        for d in DONGS:
            ok, n = pop(f'{d} {kw}')
            if ok:
                by_kw[kw].append((d, n))
                print(f'  O {d} {kw} (카페{n})', flush=True)
            time.sleep(random.uniform(2.5, 4.0))
    print('\n===== 키워드별 동 인기탭 적중 =====', flush=True)
    for kw, hits in sorted(by_kw.items(), key=lambda x: -len(x[1])):
        regs = ', '.join(f'{d}({n})' for d, n in hits)
        print(f'  {kw}: {len(hits)}/{len(DONGS)} → {regs or "없음"}', flush=True)
    json.dump({k: v for k, v in by_kw.items()}, open('dong_kw_discovery.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('\n동 잡는 키워드 = 적중 높은 것. dong_kw_discovery.json 저장', flush=True)


if __name__ == '__main__':
    main()
