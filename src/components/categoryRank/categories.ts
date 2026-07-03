// 카테고리 대시보드 정의 — 사이드바·라우트·고객포털이 공유하는 단일 출처.
//   계약 상품(src/lib/products.ts)의 부모 6 카테고리와 동일하게 맞춤: 플레이스/인스타/카페/쇼핑/파워링크/블로그.
//   blog 만 구현됨(ready) — BlogRankPage. 나머지 5개는 뼈대(준비 중).
export type CategoryKey = 'place' | 'insta' | 'cafe' | 'shopping' | 'powerlink' | 'video' | 'blog';

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
    { key: 'video', label: '영상 대시보드', path: '/video-rank', ready: false },
    { key: 'blog', label: '블로그 대시보드', path: '/blog-rank', ready: true },
];

export const categoryByKey = (key: CategoryKey): CategoryDef =>
    CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[0];

// 사이드바 아코디언 전용 트리 — 최상위(축약 라벨) → [대시보드 + 하위 카테고리].
//   label = 화면 표기(축약), href = 이동 경로.
//   하위 href는 대부분 `${path}?sub=<원본 subtype>`(내부값 보존: DAILY_SUBS·client_contracts.subtype과 일치).
//   단 '브랜드 블로그'는 이미 구현된 /blog-rank(현재 블로그 작업물 전체)로 직접 연결.
export type SidebarSub = { label: string; href: string };
export type SidebarCategory = {
    key: CategoryKey;
    label: string; // 축약 표기 (플레이스/인스타/...)
    dashHref: string; // '대시보드' 목적지
    subs: SidebarSub[];
};

export const SIDEBAR_CATEGORIES: SidebarCategory[] = [
    {
        key: 'place',
        label: '플레이스',
        dashHref: '/place-rank',
        subs: [
            { label: '영수증 리뷰', href: '/place-rank?sub=' + encodeURIComponent('영수증 리뷰') },
            { label: '리워드', href: '/place-rank?sub=' + encodeURIComponent('플레이스 리워드') },
            {
                label: '플레이스용 블로그 배포',
                href: '/place-rank?sub=' + encodeURIComponent('플레이스용 블로그 배포'),
            },
            {
                label: '상위노출 보장형',
                href: '/place-rank?sub=' + encodeURIComponent('상위노출 보장형'),
            },
        ],
    },
    {
        key: 'insta',
        label: '인스타',
        dashHref: '/insta-rank',
        subs: [
            { label: '브랜드 인스타', href: '/insta-rank?sub=' + encodeURIComponent('브랜드 인스타') },
            { label: '인스타 배포', href: '/insta-rank?sub=' + encodeURIComponent('인스타 배포') },
        ],
    },
    // 카페도 하위 1개(맘카페)라 드롭다운 없이 상위=대시보드 링크.
    {
        key: 'cafe',
        label: '카페',
        dashHref: '/cafe-rank',
        subs: [],
    },
    // 쇼핑·파워링크는 하위가 카테고리명과 동일(1개)이라 드롭다운 없이 상위=대시보드 링크.
    {
        key: 'shopping',
        label: '쇼핑',
        dashHref: '/shopping-rank',
        subs: [],
    },
    {
        key: 'powerlink',
        label: '파워링크',
        dashHref: '/powerlink-rank',
        subs: [],
    },
    {
        key: 'video',
        label: '영상',
        dashHref: '/video-rank',
        subs: [
            { label: '영상제작 롱폼', href: '/video-rank?sub=' + encodeURIComponent('영상제작 롱폼') },
            { label: '숏폼 마케팅', href: '/video-rank?sub=' + encodeURIComponent('숏폼 마케팅') },
            { label: '클립 업로드', href: '/video-rank?sub=' + encodeURIComponent('클립 업로드') },
        ],
    },
    {
        key: 'blog',
        // 하위마다 고유 pathname(App은 pathname으로만 매칭) → 실제로 다른 페이지.
        //   브랜드 블로그 = 기존 작업물(BlogRankPage). 대시보드·최적화·준최적화는 별도.
        label: '블로그',
        dashHref: '/blog-dash',
        subs: [
            { label: '브랜드 블로그', href: '/blog-rank' },
            { label: '최적화 블로그 배포', href: '/blog-optimized' },
            { label: '준최적화 블로그 배포', href: '/blog-semi' },
            { label: '단순 블로그 배포', href: '/blog-simple' },
            { label: 'AI 블로그 배포', href: '/blog-ai' },
        ],
    },
];

// 고객 전용 ERP 사이드바 — 통합 대시보드 + 6개 카테고리.
export const CUSTOMER_NAV: { path: string; label: string }[] = [
    { path: '/portal', label: '통합 대시보드' },
    ...CATEGORIES.map((c) => ({ path: `/portal/${c.key}`, label: c.label })),
];
