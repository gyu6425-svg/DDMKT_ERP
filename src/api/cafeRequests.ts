import { supabase } from '../lib/supabase';

// 카페 자동발행 '승인 요청' — 고객이 신청 → 내부가 검토·등록·승인.
//   전제: docs/cafe-customer-publish-rls.sql + cafe-publish-requests 테이블/RLS.
export type CafeRequest = {
    id: string;
    created_at: string;
    client_id: string;
    cafe_name: string | null;
    cafe_url: string | null;
    board_name: string | null;
    business: string | null;
    note: string | null;
    status: 'pending' | 'done' | 'rejected';
    handled_at: string | null;
};

// 고객: 신청 등록. client_id 는 RLS(my_client_id) 로 검증되므로 값도 함께 넣는다.
export async function submitCafeRequest(clientId: string, input: {
    cafe_name?: string; cafe_url?: string; board_name?: string; business?: string; note?: string;
}) {
    const { error } = await supabase.from('cafe_publish_requests').insert({
        client_id: clientId,
        cafe_name: input.cafe_name || null,
        cafe_url: input.cafe_url || null,
        board_name: input.board_name || null,
        business: input.business || null,
        note: input.note || null,
        status: 'pending',
    });
    return { error };
}

// 고객: 내 신청(최근) — RLS 로 본인 것만.
export async function listMyCafeRequests(limit = 5) {
    const { data, error } = await supabase
        .from('cafe_publish_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
    return { data: (data ?? []) as CafeRequest[], error };
}

// 내부: 대기 신청 목록.
export async function listPendingCafeRequests() {
    const { data, error } = await supabase
        .from('cafe_publish_requests')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
    return { data: (data ?? []) as CafeRequest[], error };
}

// 내부: 신청 처리 상태 변경(done/rejected).
export async function setCafeRequestStatus(id: string, status: 'done' | 'rejected') {
    const { error } = await supabase
        .from('cafe_publish_requests')
        .update({ status, handled_at: new Date().toISOString() })
        .eq('id', id);
    return { error };
}
