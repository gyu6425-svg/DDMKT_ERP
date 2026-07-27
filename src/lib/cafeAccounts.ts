export const CAFE_COMPANY_ORDER = ['leak', 'dirty', 'seolgo', 'theman', 'theban', 'nusu'] as const;

// 카페(vanity) → 표시명. 한 카페 안에 여러 업체(게시판)가 있을 수 있다.
export const CAFE_NAME_LABEL: Record<string, string> = {
    ddmkt2: '마이클의 정보 세상',
    thebanclean: '더반클린',
    ddnusu: '누수탐지 상담소',
};
// 관리시트/필터에서 카페 표시 순서.
export const CAFE_NAME_ORDER = ['ddmkt2', 'thebanclean', 'ddnusu'];
export function cafeNameLabel(vanity?: string | null) {
    return (vanity && CAFE_NAME_LABEL[vanity]) || vanity || '기타 카페';
}
export function cafeNameRank(vanity?: string | null) {
    const i = CAFE_NAME_ORDER.indexOf(vanity || '');
    return i < 0 ? 999 : i;
}

export type CafeCompanyKey = (typeof CAFE_COMPANY_ORDER)[number] | string;

export const CAFE_COMPANY_DEFAULTS: Record<string, { displayName: string; boardShort: string }> = {
    leak: { displayName: '누수', boardShort: '누수' },
    dirty: { displayName: '더티클리닉', boardShort: '더티클리닉' },
    seolgo: { displayName: '설고점', boardShort: '설고점' },
    theman: { displayName: '더맨시스템', boardShort: '더맨시스템' },
};

export function cafeCompanyLabel(companyKey?: string | null, fallback?: string | null) {
    return (companyKey && CAFE_COMPANY_DEFAULTS[companyKey]?.displayName) || fallback || companyKey || '미분류';
}

export function cafeCompanyRank(companyKey?: string | null) {
    const i = CAFE_COMPANY_ORDER.indexOf((companyKey || '') as (typeof CAFE_COMPANY_ORDER)[number]);
    return i < 0 ? 999 : i;
}