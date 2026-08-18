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

// 고객별 잔액만 한 번에 — 발행탭이 고객 수만큼 listTokens 를 돌리던 걸 1회 조회로 바꾼다.
//   원장 전체(*) 대신 client_id·delta 만 받아 합산(실측 2026-08-14: 57 KB → 15 KB · 요청 N회 → 1회).
export async function getTokenBalances(): Promise<Record<string, number>> {
    // ★ PostgREST 는 서버 상한(db-max-rows)에 걸려 .limit(20000) 을 줘도 1000행에서 조용히 잘린다
    //   (실측 2026-08-18: blog_posts?limit=10000 → content-range 0-999/*). 잘리면 오래된 충전이
    //   빠져 잔액이 실제보다 작게 보이고, 그 값으로 발행을 막거나 재충전을 권하게 된다.
    //   → range 로 끝까지 넘긴다. 정렬을 고정하지 않으면 페이지가 겹치거나 빠진다.
    const PAGE = 1000;
    const m: Record<string, number> = {};
    for (let from = 0; from < 200000; from += PAGE) {
        const { data, error } = await supabase
            .from('cafe_tokens').select('client_id,delta').order('id', { ascending: true })
            .range(from, from + PAGE - 1);
        const rows = (data ?? []) as { client_id: string; delta: number }[];
        for (const r of rows) m[r.client_id] = (m[r.client_id] ?? 0) + (r.delta || 0);
        if (error || rows.length < PAGE) break;
    }
    return m;
}

// 잔액 = 그 고객 delta 합계.
export function balanceOf(rows: TokenLedger[], clientId?: string): number {
    return rows.filter((r) => !clientId || r.client_id === clientId).reduce((s, r) => s + r.delta, 0);
}

// 관리자: 토큰 충전(+건수).
//   kind 를 인자로 받는다 — '충전'=유상(입금 확인분) · '서비스'=무상(노출 안 될 때 우리가 주는 것).
//   ⚠️ 예전엔 무조건 '서비스' 로 넣었다. 그 탓에 두 가지가 동시에 깨져 있었다:
//     · 돈 낸 고객의 충전내역에 "유상 0건 / 서비스 N건(무상)" 으로 표시됨(CafeTokenHistory 는 kind 로 가른다)
//     · reverseDeployTokens 가 kind='충전' 만 뒤져 태그 매칭이 항상 0 → 접수 삭제 시 회수량이 틀림
//       (실측: 더업스 접수 total_count 25 / 실지급 23 → 25 를 회수해 2건 과회수)
export async function grantTokens(clientId: string, count: number, note?: string, kind: '충전' | '서비스' = '서비스') {
    if (!Number.isFinite(count) || count <= 0) return { error: { message: '건수를 1 이상 입력하세요' } as { message: string } };
    const { error } = await supabase.from('cafe_tokens').insert({
        client_id: clientId, delta: Math.floor(count), kind, note: note?.trim() || null,
    });
    return { error };
}

// 재계약: 토큰 잔액을 '새 계약 건수'에 맞춘다(차액만 기록).
//   그냥 +N 하면 재계약 버튼을 두 번 누를 때마다 쌓여 계약보다 많은 발행권이 생긴다(실측: 계약 100인데 토큰 154).
//   남은 잔액이 목표보다 많으면 '조정 -' 으로 깎아 계약과 항상 일치시킨다.
export async function syncTokensToContract(clientId: string, target: number, note: string) {
    const goal = Math.max(0, Math.floor(target));
    const { data } = await listTokens(clientId, 1000);
    const before = balanceOf(data);
    const delta = goal - before;
    if (delta === 0) return { error: null, before, delta: 0 };
    const { error } = await supabase.from('cafe_tokens').insert({
        client_id: clientId, delta, kind: delta > 0 ? '서비스' : '조정', note,
    });
    return { error, before, delta };
}

// 관리자: 접수 삭제 시 그 접수로 발행했던 토큰 회수(-). 발행 grant 는 note 에 `[req:접수id]` 태그가 있어
//   해당 태그 grant 합계를 정확히 되돌린다. 태그가 없으면(구버전 발행) fallbackCount 를 사용.
//   미발행(태그 없음 + fallback 0) 이면 0 반환(회수 안 함). 회수분은 고객 충전내역에 '조정 -N' 으로 남는다.
export async function reverseDeployTokens(clientId: string, requestId: string, fallbackCount = 0, company = '') {
    // ⚠️ kind 로 거르지 않는다. 지급은 '충전'(유상)과 '서비스'(무상) 둘 다 가능하고,
    //   예전 코드가 kind='충전' 만 뒤지는 바람에 태그 매칭이 항상 0 이 돼 fallback 으로 떨어졌다.
    //   판정 기준은 오직 "이 접수 태그가 붙은 양수 행". 회수행(-)은 delta>0 조건이 걸러낸다
    //   (회수행에도 같은 태그를 남기므로, 이걸 빼면 두 번째 회수 때 또 전액을 회수한다).
    const { data } = await supabase.from('cafe_tokens')
        .select('delta,note,kind').eq('client_id', clientId).gt('delta', 0);
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
