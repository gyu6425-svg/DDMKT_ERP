// 계약 상품 분류 — 부모 6 카테고리 + 세부유형. 등록 가이드·상세페이지·사이드바 대시보드가 공유.
//   DB(client_contracts)에는 category/subtype 를 한글 라벨 그대로 저장한다(고정 값).
export type ProductCategory = { key: string; label: string; path: string; ready: boolean; subs: string[] };

export const PRODUCT_CATEGORIES: ProductCategory[] = [
    {
        key: 'place',
        label: '플레이스',
        path: '/place-rank',
        ready: false,
        subs: ['영수증 리뷰', '플레이스 리워드', '플레이스용 블로그 배포', '상위노출 보장형'],
    },
    { key: 'insta', label: '인스타', path: '/insta-rank', ready: false, subs: ['브랜드 인스타', '인스타 배포'] },
    { key: 'cafe', label: '카페', path: '/cafe-rank', ready: false, subs: ['맘카페'] },
    { key: 'shopping', label: '쇼핑', path: '/shopping-rank', ready: false, subs: ['쇼핑'] },
    { key: 'powerlink', label: '파워링크', path: '/powerlink-rank', ready: false, subs: ['파워링크'] },
    {
        key: 'blog',
        label: '블로그',
        path: '/blog-rank',
        ready: true,
        subs: [
            '브랜드 블로그',
            '최적화 블로그 배포',
            '준최적화 블로그 배포',
            '단순 블로그 배포',
            'AI 블로그 배포',
        ],
    },
];

export const categoryByLabel = (label: string): ProductCategory | undefined =>
    PRODUCT_CATEGORIES.find((c) => c.label === label);

// 일 단위 상품 — 총수량 = 일일수량 × 일수(예: 리워드 100타/일 × 90일). 입력을 2칸으로 나눈다.
export const DAILY_SUBS = new Set<string>(['플레이스 리워드']);
export const isDailySub = (sub: string) => DAILY_SUBS.has(sub);
