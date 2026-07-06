import { supabase } from '../lib/supabase';

// 재계약 시 기존 계약을 보관하는 이력 항목.
export type ContractHistoryItem = {
    goal_count: number | null;
    remain_count: number | null;
    amount: number | null;
    contract_date: string | null;
    note: string | null;
    at: string; // 이력으로 넘긴 날짜(YYYY-MM-DD)
    unit_price?: number | null; // 단가
    unit_outsource?: number | null; // 외주 단가
    outsource?: number | null; // 외주비
};

// 리워드(일 단위) 상품의 주간 진행 로그 — 감사기록. 진실의 원천은 remain_count.
export type RewardWeeklyLog = {
    week: string; // ISO 주 키(예: 2026-W27) — 정렬·중복 방지용
    count: number; // 그 주 실제 처리 타수
    at: string; // 기록일(YYYY-MM-DD)
    note?: string | null;
    auto?: boolean; // 추천치 그대로 확정했는지
    outUnit?: number | null; // 그 주 외주단가(입력값) → 외주비 = count × outUnit
    vendor?: string | null; // 그 주 외주업체명
    paid?: boolean; // 입금 처리 여부(true=처리, false=미처리)
};

// 고객사 계약 내역(카테고리/세부유형별 건수 계약). client_contracts 테이블(docs/client-contracts.sql).
export type ClientContract = {
    id: string;
    client_id: string;
    created_at: string;
    category: string;
    subtype: string;
    goal_count: number | null;
    remain_count: number | null;
    amount: number | null; // 매출 = 단가 × 수량
    contract_date: string | null;
    note: string | null;
    history?: ContractHistoryItem[] | null;
    unit_price?: number | null; // 단가
    unit_outsource?: number | null; // 외주 단가
    outsource?: number | null; // 외주비 = 외주단가 × 수량
    per_day?: number | null; // 리워드: 일일 타수(주간 환산 = per_day × 7)
    weekly_logs?: RewardWeeklyLog[] | null; // 리워드: 주차별 진행 로그
    outsource_company?: string | null; // 외주업체명(슈퍼뭉치 등) — 전 상품 공통
    blog_name?: string | null; // 브랜드 블로그 전용 — 블로그 관리시트 업체명(한 고객사 다중 블로그 A/B/C 구분)
    sheet_approved?: boolean | null; // 카테고리 관리 시트 승인 여부 — false=신규 등록 건, true=계약 중(승인 버튼)
};

// clientId 주면 그 고객만. 테이블 미생성 등 오류 시에도 앱이 죽지 않도록 [] 반환.
export async function getClientContracts(clientId?: string) {
    let query = supabase.from('client_contracts').select('*').order('created_at', { ascending: true });
    if (clientId) {
        query = query.eq('client_id', clientId);
    }
    const { data, error } = await query.returns<ClientContract[]>();
    return { data: data ?? [], error };
}

export async function insertClientContracts(rows: Array<Partial<ClientContract>>) {
    const { data, error } = await supabase
        .from('client_contracts')
        .insert(rows)
        .select()
        .returns<ClientContract[]>();
    return { data: data ?? [], error };
}

export async function updateClientContract(id: string, payload: Partial<ClientContract>) {
    const { error } = await supabase.from('client_contracts').update(payload).eq('id', id);
    return { error };
}

// 블로그 대시보드에서 진행률(잔여) 수정 → 계약 관리(client_contracts)의 블로그 계약에 반영(양방향 연동).
//   대상 = 그 고객사의 '브랜드 블로그' 계약(없으면 첫 블로그 계약). 진행률만 양방향, 금액·날짜는 계약 관리 전용.
export async function syncContractProgressFromBlog(
    clientId: string | null | undefined,
    remainCount: number,
    blogName?: string | null,
) {
    if (!clientId) return { synced: false };
    const { data } = await getClientContracts(clientId);
    // 브랜드블로그 계약만 대상. 다중 블로그면 blog_name(관리시트 업체명)으로 정확 매칭.
    const blogs = data.filter((c) => c.category === '블로그');
    const target =
        (blogName && blogs.find((c) => (c.blog_name || '') === blogName)) ||
        blogs.find((c) => c.subtype === '브랜드 블로그') ||
        blogs.find((c) => c.subtype === '블로그') ||
        null;
    if (!target) return { synced: false };
    const { error } = await updateClientContract(target.id, { remain_count: remainCount });
    return { synced: !error, error };
}

export async function deleteClientContract(id: string) {
    const { error } = await supabase.from('client_contracts').delete().eq('id', id);
    return { error };
}
