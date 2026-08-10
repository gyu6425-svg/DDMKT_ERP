import { supabase } from '../lib/supabase';

// 단가: 1토큰(=카페 1건 발행) = 15,000원. 충전은 이 단가로 입금.
export const TOKEN_PRICE_KRW = 15000;
// 건수 → 금액(원) 문자열. 예: tokenWon(3) → "45,000"
export const tokenWon = (count: number) => (Math.max(0, Math.round(count || 0)) * TOKEN_PRICE_KRW).toLocaleString('ko-KR');

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
// 서비스 토큰(무상) — 노출 안 될 때 우리가 주는 것. kind='서비스' 로 저장해 금액(15,000)에 안 잡히게(유상 충전과 구분). 잔액엔 포함(사용 가능).
export async function grantTokens(clientId: string, count: number, note?: string) {
    if (!Number.isFinite(count) || count <= 0) return { error: { message: '건수를 1 이상 입력하세요' } as { message: string } };
    const { error } = await supabase.from('cafe_tokens').insert({
        client_id: clientId, delta: Math.floor(count), kind: '서비스', note: note?.trim() || null,
    });
    return { error };
}

// 관리자: 접수 삭제 시 그 접수로 발행했던 토큰 회수(-). 발행 grant 는 note 에 `[req:접수id]` 태그가 있어
//   해당 태그 grant 합계를 정확히 되돌린다. 태그가 없으면(구버전 발행) fallbackCount 를 사용.
//   미발행(태그 없음 + fallback 0) 이면 0 반환(회수 안 함). 회수분은 고객 충전내역에 '조정 -N' 으로 남는다.
export async function reverseDeployTokens(clientId: string, requestId: string, fallbackCount = 0, company = '') {
    const { data } = await supabase.from('cafe_tokens')
        .select('delta,note,kind').eq('client_id', clientId).eq('kind', '충전');
    const tag = `[req:${requestId}]`;
    const granted = (data ?? [])
        .filter((r) => ((r as { note: string | null }).note ?? '').includes(tag))
        .reduce((s, r) => s + ((r as { delta: number }).delta || 0), 0);
    const amount = granted > 0 ? granted : Math.max(0, Math.floor(fallbackCount));
    if (amount <= 0) return { error: null, reversed: 0 };
    const { error } = await supabase.from('cafe_tokens').insert({
        client_id: clientId, delta: -amount, kind: '조정',
        note: `접수 삭제 회수${company ? ' · ' + company : ''} · -${amount}건 ${tag}`,
    });
    return { error, reversed: error ? 0 : amount };
}

// 고객: 발행 1건 소비(-1). 발행 흐름에서 호출.
export async function consumeToken(clientId: string, note?: string) {
    const { error } = await supabase.from('cafe_tokens').insert({
        client_id: clientId, delta: -1, kind: '발행', note: note?.trim() || null,
    });
    return { error };
}

// ── 충전 요청(고객 → 관리자) ──────────────────────────────
export type TokenRequest = {
    id: string; created_at: string; client_id: string;
    requested_count: number | null; note: string | null; status: string;
};

// 고객: 충전 요청.
export async function requestCharge(clientId: string, count: number | null, note?: string) {
    const { error } = await supabase.from('cafe_token_requests').insert({
        client_id: clientId, requested_count: count ?? null, note: note?.trim() || null, status: 'pending',
    });
    return { error };
}

// 요청 목록 — clientId 주면 그 고객만(고객 본인 RLS 자동). 없으면 전체(내부).
export async function listChargeRequests(clientId?: string) {
    let q = supabase.from('cafe_token_requests').select('*').order('created_at', { ascending: false });
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    return { data: (data ?? []) as TokenRequest[], error };
}

// 내부: 요청 처리 상태(done/rejected).
export async function setChargeRequestStatus(id: string, status: string) {
    const { error } = await supabase.from('cafe_token_requests')
        .update({ status, handled_at: new Date().toISOString() }).eq('id', id);
    return { error };
}
