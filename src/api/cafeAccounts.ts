import { supabase } from '../lib/supabase';

export type CafeAccount = {
    id: string;
    created_at: string;
    company_key: string;
    display_name: string;
    cafe_name: string;
    club_id: string;
    board_name: string;
    board_short: string;
    client_id: string | null;
    active: boolean;
    publish_enabled: boolean;   // 고객 셀프 발행 승인(기본 false) — docs/cafe-customer-publish-rls.sql
    note: string | null;
    // 계약 정보(관리시트) — docs/cafe-account-contract.sql
    goal_count: number | null;   // 목표 발행 건수
    done_count: number | null;   // 발행 완료
    amount: number | null;       // 계약금액(원)
    contract_date: string | null;
    manager: string | null;
};

// 계약/담당 필드 인라인 수정.
export async function updateCafeAccount(id: string, patch: Partial<CafeAccount>) {
    const { error } = await supabase.from('cafe_accounts').update(patch).eq('id', id);
    return { error };
}

export async function getCafeAccounts() {
    const { data, error } = await supabase
        .from('cafe_accounts')
        .select('*')
        .order('created_at', { ascending: true });
    return { data: (data ?? []) as CafeAccount[], error };
}

export async function upsertCafeAccount(input: Partial<CafeAccount> & { company_key: string; display_name: string }) {
    const payload = {
        active: input.active ?? true,
        board_name: input.board_name || input.board_short || input.display_name,
        board_short: input.board_short || input.display_name,
        cafe_name: input.cafe_name || 'ddmkt2',
        client_id: input.client_id || null,
        club_id: input.club_id || '31754130',
        company_key: input.company_key.trim(),
        display_name: input.display_name.trim(),
        note: input.note || null,
    };
    const { error } = await supabase.from('cafe_accounts').upsert(payload, { onConflict: 'company_key' });
    return { error };
}

export async function setCafeAccountActive(id: string, active: boolean) {
    const { error } = await supabase.from('cafe_accounts').update({ active }).eq('id', id);
    return { error };
}

// 고객 셀프 발행 승인 on/off (내부 전용 — cafe_accounts 내부 update RLS).
export async function setCafeAccountPublish(id: string, publish_enabled: boolean) {
    const { error } = await supabase.from('cafe_accounts').update({ publish_enabled }).eq('id', id);
    return { error };
}

// 토큰 발급 시 자동화 발행 탭 활성화 — 이 고객의 카페 계정을 발행 승인(publish_enabled=true).
//   계정이 없으면 생성(접수 없이 토큰만 준 경우 대비). 여러 개면 전부 켠다.
export async function enablePublishByClient(clientId: string, displayName?: string) {
    const { data } = await supabase.from('cafe_accounts').select('id').eq('client_id', clientId);
    if (data && data.length) {
        const { error } = await supabase.from('cafe_accounts')
            .update({ publish_enabled: true, active: true }).eq('client_id', clientId);
        return { error };
    }
    const { error } = await supabase.from('cafe_accounts').insert({
        company_key: `dep_${clientId}`, display_name: displayName || '고객사',
        client_id: clientId, active: true, publish_enabled: true,
    });
    return { error };
}