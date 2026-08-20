import { supabase } from '../lib/supabase';

// 단가: 1건 = 1토큰 = 15,000원(기본값). **매번 달라질 수 있어 DB 설정에서 바꾼다**
//   — app_settings.token_unit_price (docs/token-price-setting.sql).
//   여기 상수는 설정을 아직 못 읽었을 때 쓰는 마지막 기본값일 뿐이다.
//   ★ 거래에 실제로 적용된 단가는 행마다 저장된다(unit_price). 설정을 바꿔도 과거 거래는 그대로다.
export const TOKEN_PRICE_KRW = 15000;

// 통보 화면에 처음 채워지는 기본 단가.
//   ★ 못 읽었을 때 조용히 15,000 으로 떨어지면 안 된다 — 담당자가 25,000 으로 바꿔 뒀는데
//     조회가 실패하면 화면엔 정상값처럼 15,000 이 뜨고, 그대로 통보하면 건당 1만원씩 덜 받는다.
//     읽기 성공 여부를 함께 돌려주고, 실패하면 화면이 경고를 띄운다.
export async function getDefaultUnitPrice(): Promise<{ price: number; ok: boolean; error: string | null }> {
    const { data, error } = await supabase
        .from('app_settings').select('value').eq('key', 'token_unit_price').maybeSingle();
    if (error) return { price: TOKEN_PRICE_KRW, ok: false, error: error.message };
    const raw = (data as { value?: { default?: number | string } } | null)?.value?.default;
    const v = typeof raw === 'string' ? Number(raw) : raw;   // 문자열로 들어가 있어도 살린다
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
        return { price: TOKEN_PRICE_KRW, ok: false, error: '기본 단가 설정을 읽지 못했습니다' };
    }
    return { price: v, ok: true, error: null };
}

// 기본 단가 변경(내부 직원만 — RLS 가 막는다).
export async function setDefaultUnitPrice(price: number) {
    const { error } = await supabase.from('app_settings')
        .upsert({ key: 'token_unit_price', value: { default: price }, updated_at: new Date().toISOString() },
                { onConflict: 'key' });
    return { error };
}
// (삭제) tokenWon — 상수 단가로 금액 문자열을 만들던 유틸. 호출처가 없었고,
//   '건수 → 금액'이라는 가장 쓰기 쉬운 모양이라 남겨두면 설정값·행 저장 단가를 무시한 채
//   잘못 쓰이기 쉬워 제거한다. 금액이 필요하면 won(count * 해당 거래의 unit_price) 를 쓴다.

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
//   idemKey: 같은 입금/접수로 두 번 지급되는 것을 DB 유니크로 막는다(docs/cafe-token-guard.sql).
//     실측 2026-08-14 금융책사 — '토큰 발행'이 3초·14초 간격으로 3번 눌려 계약 100건에 300건이 나갔다.
//     읽고-쓰는 애플리케이션 체크는 두 번째 클릭이 첫 INSERT 전에 읽으면 그대로 통과한다.
//     유니크 위반은 '이미 발행됨'이므로 오류가 아니라 성공으로 돌려준다(중복 클릭이 에러로 보이면 안 된다).
export async function grantTokens(
    clientId: string, count: number, note?: string,
    kind: '충전' | '서비스' = '서비스', idemKey?: string,
) {
    if (!Number.isFinite(count) || count <= 0) return { error: { message: '건수를 1 이상 입력하세요' } as { message: string } };
    const row: Record<string, unknown> = {
        client_id: clientId, delta: Math.floor(count), kind, note: note?.trim() || null,
    };
    if (idemKey) row.idem_key = idemKey;
    const { error } = await supabase.from('cafe_tokens').insert(row);
    if (error && /duplicate key|idem/i.test(error.message || '')) {
        return { error: null, duplicate: true };
    }
    // idem_key 컬럼이 아직 없는 환경(SQL 미실행)에서는 컬럼 없이 한 번 더 시도한다.
    if (error && idemKey && /idem_key|column|schema cache/i.test(error.message || '')) {
        delete row.idem_key;
        const retry = await supabase.from('cafe_tokens').insert(row);
        return { error: retry.error };
    }
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
export type TokenRequestStatus = 'pending' | 'quoted' | 'paid' | 'done' | 'rejected';

// 충전 신청 1건의 전 과정. 신청 → 금액 통보 → 입금 신고 → 발행.
export type TokenRequest = {
    id: string; created_at: string; client_id: string;
    requested_count: number | null; note: string | null; status: string;
    pay_method?: string | null;
    // 금액 통보 시점의 입금 계좌 스냅샷 — 계좌가 바뀌어도 과거 통보 건은 그때 값으로 남는다.
    pay_bank?: string | null;
    pay_account?: string | null;
    pay_holder?: string | null;
    handled_at?: string | null;
    unit_price?: number | null;        // 통보 단가(원/건)
    amount?: number | null;            // 공급가 = 건수 x 단가 (부가세 미포함)
    quoted_at?: string | null;
    quoted_count?: number | null;      // 통보 기준 건수(신청 건수와 다를 수 있다)
    paid_declared_at?: string | null;  // 대행사가 '계좌이체 완료' 누른 시각
    depositor?: string | null;         // 입금자명(통장 대조용)
    granted_count?: number | null;
};

// 대행사 최소 신청 수량. 단가는 업체 구분과 무관하게 app_settings 기본값에서 오고,
//   건별로 다르면 통보 화면에서 고친다(사장님 확인 2026-08-20 — 단가는 매번 달라질 수 있다).
export const AGENCY_MIN_COUNT = 30;

// 결제 방식 — 담당자가 안내 방법(계좌/카드 링크)을 정하고, 나중에 수단별 집계도 낼 수 있게 컬럼으로 받는다.
//   값을 CHECK 로 못박지 않은 이유: 수단이 하나 늘 때마다 배포가 필요해진다.
export const PAY_METHODS = ['계좌이체', '카드결제', '기타'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

// 부가세 별도. 통보 금액(공급가)에 10% 를 더한 값이 실제 입금액이다.
export const vatOf = (supply: number) => Math.round(supply * 0.1);
export const totalOf = (supply: number) => supply + vatOf(supply);
export const won = (n: number) => (n || 0).toLocaleString('ko-KR');

// 정수만·상한까지. 소수점이나 21억 넘는 수를 그대로 보내면 Postgres 영문 원문
// ("invalid input syntax for type integer")이 사용자 화면에 그대로 뜬다.
export const MAX_COUNT = 100000;
export const MAX_UNIT_PRICE = 10000000;
export const intOnly = (v: string, max: number) => {
    const d = (v || '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
    if (!d) return '';
    return String(Math.min(Number(d), max));
};


// 고객: 충전 요청.
export async function requestCharge(clientId: string, count: number | null, note?: string, payMethod?: string) {
    const { error } = await supabase.from('cafe_token_requests').insert({
        client_id: clientId, requested_count: count ?? null, note: note?.trim() || null, status: 'pending',
        pay_method: payMethod?.trim() || null,
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

// 내부: 금액 통보 — 건수·단가 확정 + **입금 계좌를 함께** 대행사에게 알린다(status=quoted).
//   계좌를 같이 보내지 않으면 금액만 알고 어디로 넣을지 모르는 상태가 된다.
export async function quoteChargeRequest(
    id: string, count: number, unitPrice: number,
    account: { bank: string; account: string; holder: string },
) {
    const { error } = await supabase
        .from('cafe_token_requests')
        .update({
            status: 'quoted',
            quoted_count: count,
            unit_price: unitPrice,
            amount: Math.round(count * unitPrice),   // 공급가(부가세 미포함)
            quoted_at: new Date().toISOString(),
            pay_bank: account.bank,
            pay_account: account.account,
            pay_holder: account.holder,
        })
        .eq('id', id);
    return { error };
}

// 고객(대행사): 계좌이체 완료 신고. 토큰은 여기서 지급되지 않는다 — 우리가 통장을 보고 발행한다.
//   ★ UPDATE 정책이 아니라 함수로 처리한다. 정책을 열면 고객이 status 를 done 으로 바꿀 수 있다.
export async function declareTokenPayment(requestId: string, depositor?: string) {
    const { error } = await supabase.rpc('declare_token_payment', {
        p_request_id: requestId,
        p_depositor: depositor?.trim() || null,
    });
    return { error };
}

// 내부: 입금 확인 → 토큰 발행 + 신청 종료. 같은 신청으로 두 번 발행되지 않게 멱등키를 건다.
export async function fulfillChargeRequest(req: TokenRequest, count: number, note?: string) {
    const { error } = await grantTokens(req.client_id, count, note, '충전', `ctr:${req.id}`);
    if (error) return { error };
    const { error: upErr } = await supabase
        .from('cafe_token_requests')
        .update({ status: 'done', granted_count: count, handled_at: new Date().toISOString() })
        .eq('id', req.id);
    if (upErr) return { error: upErr };
    // 판 금액을 매출로 남긴다. 토큰만 주고 끝나면 어느 매출 집계에도 안 잡힌다(검증 2026-08-20).
    return { error: await recordTokenSale(req.client_id, count, req.amount ?? 0, req.unit_price ?? 0) };
}

// 토큰 판매 → 계약(매출) 반영. 금액은 **공급가**(부가세 미포함)로 넣는다 —
//   client_contracts.amount 가 공급가 체계이고, 부가세는 화면에서 no_vat 로 계산한다.
//   ★ 행을 새로 만들지 않고 그 업체의 '카페 배포' 계약에 누적한다. 구매할 때마다 행이 늘면
//     진행률 동기화(cafe_contract_sync)가 같은 실적을 여러 행에 중복 반영한다.
//   ★ 실패해도 토큰 발행은 되돌리지 않는다. 돈은 이미 받았고 토큰도 나갔다 —
//     매출 기록은 사람이 계약관리에서 채울 수 있지만, 토큰을 도로 뺏을 수는 없다.
async function recordTokenSale(clientId: string, count: number, amount: number, unitPrice: number) {
    if (!clientId || count <= 0) return null;
    const { data, error } = await supabase
        .from('client_contracts')
        .select('id,goal_count,remain_count,amount')
        .eq('client_id', clientId).eq('category', '카페').eq('subtype', '카페 배포')
        .order('created_at', { ascending: true });
    if (error) return { message: `매출 반영 실패(계약 조회): ${error.message}` };

    const today = new Date().toISOString().slice(0, 10);
    const row = (data ?? [])[0] as { id: string; goal_count: number | null; remain_count: number | null; amount: number | null } | undefined;
    if (row) {
        const { error: e } = await supabase.from('client_contracts').update({
            goal_count: (row.goal_count ?? 0) + count,
            remain_count: (row.remain_count ?? 0) + count,
            amount: (row.amount ?? 0) + amount,
            unit_price: unitPrice || null,
            sheet_approved: true,
        }).eq('id', row.id);
        return e ? { message: `매출 반영 실패: ${e.message}` } : null;
    }
    const { error: e2 } = await supabase.from('client_contracts').insert({
        client_id: clientId, category: '카페', subtype: '카페 배포',
        goal_count: count, remain_count: count, amount, unit_price: unitPrice || null,
        contract_date: today, sheet_approved: true,
    });
    return e2 ? { message: `매출 반영 실패: ${e2.message}` } : null;
}
