import { supabase } from '../lib/supabase';

// 발행요청 큐(cafe_gen_requests) — main 웹이 finder 선택분을 적재 → 발행PC 폴러가 자기 양식으로 생성·발행.
//   전제: docs/cafe-gen-requests.sql. 라우팅·게시판은 SUB1/SUB2 답신 기준 확정값.
export type PublishTarget = { pc: 'SUB1' | 'SUB2'; company: string; board: string; businessFromProduct: boolean };

// 선택 업체(cafe_accounts.company_key) → 발행 라우팅. 더맨=사설경호만(회사보안은 마이클 옛 카페·소진).
export const PUBLISH_TARGET: Record<string, PublishTarget> = {
    theman:  { pc: 'SUB1', company: 'theman', board: '더맨시스템 시설경호업체', businessFromProduct: false },
    theman2: { pc: 'SUB1', company: 'theman', board: '더맨시스템 시설경호업체', businessFromProduct: false },
    seolgo:  { pc: 'SUB1', company: 'seolgo', board: '설고점 소방의 모든 것', businessFromProduct: false },
    seolgo2: { pc: 'SUB1', company: 'seolgo', board: '설고점 소방의 모든 것', businessFromProduct: false },
    theban:  { pc: 'SUB2', company: 'durban', board: '더반클린 입주청소', businessFromProduct: true },
    leak:    { pc: 'SUB2', company: 'leak3', board: '누수탐지 후기·시공사례', businessFromProduct: false },
    nusu:    { pc: 'SUB2', company: 'leak3', board: '누수탐지 후기·시공사례', businessFromProduct: false },
    // dirty: 네이버 아이디 세팅 후 추가
};

export function publishTargetFor(companyKey: string | null): PublishTarget | null {
    return companyKey ? PUBLISH_TARGET[companyKey] ?? null : null;
}

// finder 선택 키워드들 → 발행요청 적재. region = 키워드에서 제품키워드 떼기(개포동 입주청소→개포동).
//   productKeyword: 지역형 제품키워드(입주청소/사설경호/소방업체/누수탐지). durban 은 이 값이 business.
export async function enqueueGenRequests(companyKey: string, keywords: string[], productKeyword: string) {
    const t = PUBLISH_TARGET[companyKey];
    if (!t) return { error: { message: `발행 라우팅 매핑 없음: ${companyKey}` }, count: 0 };
    const pk = (productKeyword || '').trim();
    const esc = pk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rows = keywords.filter(Boolean).map((kw) => {
        const region = pk ? (kw.replace(new RegExp(`\\s*${esc}\\s*$`), '').trim() || kw) : kw;
        return {
            company: t.company, board: t.board,
            business: t.businessFromProduct ? (pk || null) : null,
            region, keyword: kw, popular_verified: true, status: 'pending',
        };
    });
    if (!rows.length) return { error: { message: '보낼 키워드가 없습니다.' }, count: 0 };
    const { error } = await supabase.from('cafe_gen_requests').insert(rows);
    return { error, count: rows.length };
}
