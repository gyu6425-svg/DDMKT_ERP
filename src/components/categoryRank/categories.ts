// 고객사 ERP 5개 카테고리 정의 — 사이드바·라우트·대시보드가 공유하는 단일 출처.
//   고객사 1업체가 이 중 여러 카테고리를 계약할 수 있고, 등록 출발점은 '고객사 관리'(/clients).
//   각 카테고리 = 같은 구조(대시보드·관리시트·순위트래커·크롤링현황). 블로그만 작성기 추가.
//   blog 는 이미 구현됨(ready) — 별도 페이지(BlogRankPage). 나머지 4개는 뼈대(준비 중) 단계.
export type CategoryKey = 'blog' | 'video' | 'insta' | 'cafe' | 'traffic';

export type CategoryDef = {
    key: CategoryKey;
    label: string; // 사이드바·헤더 표기 (예: '영상 대시보드')
    path: string; // 라우트 경로 (예: '/video-rank')
    tabs: string[]; // 이 카테고리가 가질 탭(페이지) 구조
    ready: boolean; // true=구현됨(블로그), false=뼈대(준비 중)
};

const BASE_TABS = ['대시보드', '관리 시트', '순위 트래커', '크롤링 현황'];

export const CATEGORIES: CategoryDef[] = [
    { key: 'blog', label: '블로그 대시보드', path: '/blog-rank', tabs: [...BASE_TABS, '블로그 작성기'], ready: true },
    { key: 'video', label: '영상 대시보드', path: '/video-rank', tabs: BASE_TABS, ready: false },
    { key: 'insta', label: '인스타 대시보드', path: '/insta-rank', tabs: BASE_TABS, ready: false },
    { key: 'cafe', label: '카페 대시보드', path: '/cafe-rank', tabs: BASE_TABS, ready: false },
    { key: 'traffic', label: '트래픽 대시보드', path: '/traffic-rank', tabs: BASE_TABS, ready: false },
];

export const categoryByKey = (key: CategoryKey): CategoryDef =>
    CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[0];

// 고객 전용 ERP 사이드바 메뉴 — 통합 대시보드 + 5개 카테고리(계약한 것만 보이게는 추후 데이터 연동).
//   내부 메뉴(배너/파워링크/계약관리/고객사관리 등)는 고객에게 노출하지 않는다.
export const CUSTOMER_NAV: { path: string; label: string }[] = [
    { path: '/portal', label: '통합 대시보드' },
    ...CATEGORIES.map((c) => ({ path: `/portal/${c.key}`, label: c.label })),
];
