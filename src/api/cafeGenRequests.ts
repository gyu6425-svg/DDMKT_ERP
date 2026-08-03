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

// 더반 업종 = 이 5개만(SUB2 답신). CAFE_BUSINESS 로 제목·태그·CTA배너 분기.
export const DURBAN_BUSINESS = ['입주청소', '이사청소', '상가청소', '청소업체', '사무실청소'];

// finder 선택 키워드들 → 발행요청 적재. region = 키워드에서 제품키워드 떼기(개포동 입주청소→개포동).
//   productKeyword: 지역형 제품키워드(입주청소/사설경호/소방업체/누수탐지). durban 은 이 값이 business.
export async function enqueueGenRequests(companyKey: string, keywords: string[], productKeyword: string) {
    const t = PUBLISH_TARGET[companyKey];
    if (!t) return { error: { message: `발행 라우팅 매핑 없음: ${companyKey}` }, count: 0 };
    const pk = (productKeyword || '').trim();
    // 더반은 업종이 CAFE_BUSINESS 로 발행 양식을 분기하므로 5개 중 하나여야 오발행이 없다.
    if (t.businessFromProduct && !DURBAN_BUSINESS.includes(pk)) {
        return { error: { message: `더반 업종은 [${DURBAN_BUSINESS.join(' · ')}] 중 하나여야 합니다. (제품키워드: ${pk || '없음'})` }, count: 0 };
    }
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

// 신규 업체(모델B: 고객 자기 카페·자기 계정) 발행요청 — PUBLISH_TARGET 에 없는 접수 고객용.
//   고정업체(더반/누수 등)와 달리 client_id 로 고객 계정/카페를 잇는다. SUB2 가 client_id→credentials·카페로 대신발행.
//   전제: docs/cafe-gen-requests-client.sql (client_id 컬럼).
export async function enqueueGenRequestsSelf(
    companyKey: string, clientId: string, board: string | null, keywords: string[], productKeyword: string,
) {
    const pk = (productKeyword || '').trim();
    const esc = pk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rows = keywords.filter(Boolean).map((kw) => {
        const region = pk ? (kw.replace(new RegExp(`\\s*${esc}\\s*$`), '').trim() || kw) : kw;
        return {
            company: companyKey, board: board || null, business: null,
            region, keyword: kw, popular_verified: true, status: 'pending',
            client_id: clientId,   // ← 신규 업체 식별: SUB2 가 이 값으로 고객 계정/카페 조회
        };
    });
    if (!rows.length) return { error: { message: '보낼 키워드가 없습니다.' }, count: 0 };
    const { error } = await supabase.from('cafe_gen_requests').insert(rows);
    return { error, count: rows.length };
}
