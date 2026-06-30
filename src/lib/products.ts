// 계약 상품 분류 — 부모 6 카테고리 + 세부유형. 등록 가이드·상세페이지가 공유하는 단일 출처.
//   DB(client_contracts)에는 category/subtype 를 한글 라벨 그대로 저장한다(고정 값).
export type ProductCategory = { key: string; label: string; subs: string[] };

export const PRODUCT_CATEGORIES: ProductCategory[] = [
    { key: 'place', label: '플레이스', subs: ['영수증 리뷰', '플레이스 리워드', '플레이스용 블로그 리뷰'] },
    { key: 'insta', label: '인스타', subs: ['브랜드 인스타', '인스타 배포'] },
    { key: 'cafe', label: '카페', subs: ['맘카페'] },
    { key: 'shopping', label: '쇼핑', subs: ['쇼핑'] },
    { key: 'powerlink', label: '파워링크', subs: ['파워링크'] },
    { key: 'blog', label: '블로그', subs: ['브랜드 블로그', '최적화 블로그 배포', '준최적화 블로그 배포'] },
];

export const categoryByLabel = (label: string): ProductCategory | undefined =>
    PRODUCT_CATEGORIES.find((c) => c.label === label);
