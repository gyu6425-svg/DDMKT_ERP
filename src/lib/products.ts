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
    { key: 'cafe', label: '카페', path: '/cafe-rank', ready: false, subs: ['카페 배포', '맘카페'] },
    {
        key: 'shopping',
        label: '쇼핑',
        path: '/shopping-rank',
        ready: false,
        subs: ['슬롯', '가구매', '실구매', '스토어 리뷰'],
    },
    { key: 'powerlink', label: '파워링크', path: '/powerlink-rank', ready: false, subs: ['파워링크'] },
    {
        key: 'video',
        label: '영상',
        path: '/video-rank',
        ready: false,
        subs: ['롱폼(유튜브)', '숏폼(유튜브,인스타)', '클립', '촬영 패키지', '전달 패키지'],
    },
    {
        key: 'blog',
        label: '블로그',
        path: '/blog-rank',
        ready: true,
        subs: [
            '브랜드 블로그',
            '최적화 블로그 배포',
            '준최적화 블로그 배포',
            '저인망 블로그 배포',
        ],
    },
    // 종합광고 — 고정 카테고리가 아니라 상황별 묶음. 컨테이너로 등록 후 상세에서 '모든 카테고리' 상품을 골라 넣음.
    { key: 'adall', label: '종합광고', path: '/dashboard', ready: false, subs: ['종합광고'] },
    // 서비스 — 무상 제공(서비스로 나가는 비용). 금액만 입력 → 매출에 −(마이너스)로 저장, 외주비 0.
    { key: 'service', label: '서비스', path: '', ready: false, subs: ['서비스'] },
];

// 컨테이너형(부모) 세부유형 — 자기 자신을 하위로 못 넣게 제외. 상위노출 보장형=플레이스 고정, 종합광고=전 카테고리.
export const CONTAINER_SUBS = ['상위노출 보장형', '종합광고'];

// 영상 '숏폼' — 유튜브/인스타 중 선택. 선택 종류는 계약 blog_name(라벨)에 저장 → 카드 칩 표시.
export const SHORTFORM_SUB = '숏폼(유튜브,인스타)';
export const SHORTFORM_PLATFORMS = ['유튜브', '인스타'];

export const categoryByLabel = (label: string): ProductCategory | undefined =>
    PRODUCT_CATEGORIES.find((c) => c.label === label);

// 일 단위 상품 — 총수량 = 일일수량 × 일수(예: 리워드 100타/일 × 90일). 입력을 2칸으로 나눈다.
export const DAILY_SUBS = new Set<string>(['플레이스 리워드']);
export const isDailySub = (sub: string) => DAILY_SUBS.has(sub);

// 브랜드블로그 관리 시트(blog_accounts)에 대응하는 블로그 세부유형.
//   '브랜드 블로그'(신규 표기) + '블로그'(레거시 표기) = 브랜드블로그. 크롤·순위 추적 대상.
//   최적화/준최적화/단순/AI 블로그 배포·유료이미지는 각 하위 카테고리에서 관리(브랜드블로그 시트 제외).
export const BRAND_BLOG_SUBS = new Set<string>(['브랜드 블로그', '블로그']);
export const isBrandBlogSub = (sub: string) => BRAND_BLOG_SUBS.has(sub);
