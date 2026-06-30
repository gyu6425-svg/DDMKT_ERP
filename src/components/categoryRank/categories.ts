// 카테고리 대시보드 정의 — 사이드바·라우트·고객포털이 공유하는 단일 출처.
//   계약 상품(src/lib/products.ts)의 부모 6 카테고리와 동일하게 맞춤: 플레이스/인스타/카페/쇼핑/파워링크/블로그.
//   blog 만 구현됨(ready) — BlogRankPage. 나머지 5개는 뼈대(준비 중).
export type CategoryKey = 'place' | 'insta' | 'cafe' | 'shopping' | 'powerlink' | 'blog';

export type CategoryDef = {
    key: CategoryKey;
    label: string; // 사이드바·헤더 표기 (예: '플레이스 대시보드')
    path: string; // 라우트 경로
    ready: boolean; // true=구현됨(블로그), false=뼈대(준비 중)
};

export const CATEGORIES: CategoryDef[] = [
    { key: 'place', label: '플레이스 대시보드', path: '/place-rank', ready: false },
    { key: 'insta', label: '인스타 대시보드', path: '/insta-rank', ready: false },
    { key: 'cafe', label: '카페 대시보드', path: '/cafe-rank', ready: false },
    { key: 'shopping', label: '쇼핑 대시보드', path: '/shopping-rank', ready: false },
    { key: 'powerlink', label: '파워링크 대시보드', path: '/powerlink-rank', ready: false },
    { key: 'blog', label: '블로그 대시보드', path: '/blog-rank', ready: true },
];

export const categoryByKey = (key: CategoryKey): CategoryDef =>
    CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[0];

// 고객 전용 ERP 사이드바 — 통합 대시보드 + 6개 카테고리.
export const CUSTOMER_NAV: { path: string; label: string }[] = [
    { path: '/portal', label: '통합 대시보드' },
    ...CATEGORIES.map((c) => ({ path: `/portal/${c.key}`, label: c.label })),
];
