import { supabase } from '../lib/supabase';

// 고객사 계약 내역(카테고리/세부유형별 건수 계약). client_contracts 테이블(docs/client-contracts.sql).
export type ClientContract = {
    id: string;
    client_id: string;
    created_at: string;
    category: string;
    subtype: string;
    goal_count: number | null;
    remain_count: number | null;
    amount: number | null;
    contract_date: string | null;
    note: string | null;
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
