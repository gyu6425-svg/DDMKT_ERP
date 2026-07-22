export const CAFE_COMPANY_ORDER = ['leak', 'dirty', 'seolgo', 'theman'] as const;

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