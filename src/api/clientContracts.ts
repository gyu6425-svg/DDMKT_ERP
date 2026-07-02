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

export async function deleteClientContract(id: string) {
    const { error } = await supabase.from('client_contracts').delete().eq('id', id);
    return { error };
}
