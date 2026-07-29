import { supabase } from '../lib/supabase';

// 카페 발행 토큰(건수) 원장. 발행 1건 = 1토큰. 잔액 = delta 합계.
export type TokenLedger = {
    id: string;
    created_at: string;
    client_id: string;
    delta: number;      // +N 충전, -1 발행
    kind: string;       // 충전 | 발행 | 조정
    note: string | null;
};

// 원장 조회 — clientId 주면 그 고객만(고객 본인은 RLS 로 자동 스코프). 없으면 전체(내부).
export async function listTokens(clientId?: string, limit = 500) {
    let q = supabase.from('cafe_tokens').select('*').order('created_at', { ascending: false }).limit(limit);
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    return { data: (data ?? []) as TokenLedger[], error };
}

// 잔액 = 그 고객 delta 합계.
export function balanceOf(rows: TokenLedger[], clientId?: string): number {
    return rows.filter((r) => !clientId || r.client_id === clientId).reduce((s, r) => s + r.delta, 0);
}

// 관리자: 토큰 충전(+건수).
export async function grantTokens(clientId: string, count: number, note?: string) {
    if (!Number.isFinite(count) || count <= 0) return { error: { message: '건수를 1 이상 입력하세요' } as { message: string } };
    const { error } = await supabase.from('cafe_tokens').insert({
        client_id: clientId, delta: Math.floor(count), kind: '충전', note: note?.trim() || null,
    });
    return { error };
}

// 고객: 발행 1건 소비(-1). 발행 흐름에서 호출.
export async function consumeToken(clientId: string, note?: string) {
    const { error } = await supabase.from('cafe_tokens').insert({
        client_id: clientId, delta: -1, kind: '발행', note: note?.trim() || null,
    });
    return { error };
}
