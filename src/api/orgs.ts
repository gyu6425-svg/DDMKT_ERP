import { supabase } from '../lib/supabase';

// 조직(대행사 계층) — 든든한마케팅(우리) → 대행사(is_agency) → 하위 업체.
//   계층의 근거는 clients.parent_client_id 하나뿐이다(docs/agency-org-phase1.sql).
//   ⚠️ 그 컬럼이 아직 없는 환경에서도 화면은 떠야 한다 — SQL 미실행이 곧 백지 화면이 되면
//      무엇이 문제인지 알 수 없다. 조회는 컬럼 없으면 자동으로 폴백하고 ready=false 를 돌려준다.

export type OrgNode = {
    id: string;
    company: string;
    is_agency: boolean;
    parent_client_id: string | null;
    status: string | null;
    client_partner: string | null;
    created_at: string | null;
    has_cafe: boolean;   // 카페 관련 업체인지 — 조직도는 카페 사업만 다룬다
};

const MISSING_COL = /parent_client_id|column .* does not exist|schema cache/i;

// 카페 관련 client 집합 — 카페 계정 / 배포 접수 / 카페 계약 / 토큰 원장 중 하나라도 있으면 해당.
//   조직도는 카페 사업 전용이라 나머지 160여 곳(블로그·플레이스만 하는 업체)은 목록에 안 올린다.
//   ⚠️ 조회는 부분 실패를 허용한다 — 한 테이블이 막혀도 조직도 자체는 떠야 한다.
async function cafeClientIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    const pick = (rows: unknown) => {
        for (const r of (rows ?? []) as { client_id: string | null }[]) if (r.client_id) ids.add(r.client_id);
    };
    const [acc, dep, ctr, tok] = await Promise.all([
        supabase.from('cafe_accounts').select('client_id'),
        supabase.from('cafe_deploy_requests').select('client_id'),
        supabase.from('client_contracts').select('client_id').eq('category', '카페'),
        supabase.from('cafe_tokens').select('client_id'),
    ]);
    pick(acc.data); pick(dep.data); pick(ctr.data); pick(tok.data);
    return ids;
}

// 조직도용 client 목록. ready=false = parent_client_id 컬럼 미적용(= SQL 미실행).
export async function listOrgClients(): Promise<{ data: OrgNode[]; ready: boolean; error: string | null }> {
    const [full, cafeIds] = await Promise.all([
        supabase
            .from('clients')
            .select('id,company,is_agency,parent_client_id,status,client_partner,created_at')
            .order('company', { ascending: true }),
        cafeClientIds(),
    ]);
    if (!full.error) {
        const rows = (full.data ?? []) as Omit<OrgNode, 'has_cafe'>[];
        return { data: rows.map((r) => ({ ...r, has_cafe: cafeIds.has(r.id) })), ready: true, error: null };
    }
    if (!MISSING_COL.test(full.error.message || '')) {
        return { data: [], ready: false, error: full.error.message };
    }
    // 폴백 — 컬럼 없이 평평하게라도 보여준다.
    const lite = await supabase
        .from('clients')
        .select('id,company,is_agency,status,client_partner,created_at')
        .order('company', { ascending: true });
    const rows = (lite.data ?? []) as Omit<OrgNode, 'parent_client_id' | 'has_cafe'>[];
    const ids = await cafeClientIds();
    return {
        data: rows.map((r) => ({ ...r, parent_client_id: null, has_cafe: ids.has(r.id) })),
        ready: false,
        error: lite.error?.message ?? null,
    };
}

// 소속 지정/해제. parent=null 이면 직거래로 전환한다(대행사 계약 종료 시 이 경로를 쓴다 — 삭제 아님).
export async function setClientParent(clientId: string, parentClientId: string | null) {
    const { error } = await supabase
        .from('clients')
        .update({ parent_client_id: parentClientId })
        .eq('id', clientId);
    return { error };
}

// 대행사 전환/해제. 하위가 있는 대행사는 해제하지 못하게 화면에서 먼저 막는다(DB 트리거도 2단을 강제).
export async function setClientAgency(clientId: string, isAgency: boolean) {
    const { error } = await supabase.from('clients').update({ is_agency: isAgency }).eq('id', clientId);
    return { error };
}

// ── 초대 코드 ────────────────────────────────────────────────────────────
export type AgencyInvite = {
    code: string;
    agency_client_id: string;
    label: string | null;
    max_uses: number | null;
    used_count: number;
    expires_at: string | null;
    active: boolean;
    created_at: string;
};

export async function listInvites(agencyClientId?: string) {
    let q = supabase.from('agency_invites').select('*').order('created_at', { ascending: false });
    if (agencyClientId) q = q.eq('agency_client_id', agencyClientId);
    const { data, error } = await q;
    return { data: (data ?? []) as AgencyInvite[], error };
}

// 코드 생성 — 헷갈리는 글자(I·L·O·U·0·1)를 뺀 32자 알파벳. 예: DD-7K4M2XQP
const ALPHA = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newInviteCode(): string {
    let s = '';
    const buf = new Uint32Array(8);
    crypto.getRandomValues(buf);
    for (let i = 0; i < 8; i += 1) s += ALPHA[buf[i] % ALPHA.length];
    return `DD-${s}`;
}

export async function createInvite(agencyClientId: string, label?: string, maxUses?: number | null) {
    // 충돌 확률은 무시할 수준이지만(30^8), 유니크 위반이면 한 번 더 시도한다.
    for (let i = 0; i < 3; i += 1) {
        const code = newInviteCode();
        const { error } = await supabase.from('agency_invites').insert({
            code,
            agency_client_id: agencyClientId,
            label: label?.trim() || null,
            max_uses: maxUses ?? null,
        });
        if (!error) return { code, error: null };
        if (!/duplicate key/i.test(error.message || '')) return { code: null, error };
    }
    return { code: null, error: { message: '코드 생성 실패 — 다시 시도하세요' } };
}

// 폐기(삭제하지 않는다 — 그 코드로 붙은 업체의 감사 추적이 끊긴다).
export async function setInviteActive(code: string, active: boolean) {
    const { error } = await supabase.from('agency_invites').update({ active }).eq('code', code);
    return { error };
}

// ── 대행사 본인 화면(고객 포털 '조직 관리') ──────────────────────────────
//   대행사로 로그인한 고객이 자기 조직만 본다. 읽기 전용 — 소속 지정·코드 발급은 우리(내부)만 한다.
//   ★ 여기서 client_id 를 화면이 넘겨주지만, 그 값을 믿고 권한을 주는 게 아니다.
//     실제 차단은 RLS(docs/agency-portal-rls.sql)가 한다 — 남의 id 를 넣어도 0행이 돌아온다.
export type MyOrg = {
    me: OrgNode | null;
    children: OrgNode[];
    invites: AgencyInvite[];
};

export async function getMyOrg(clientId: string): Promise<{ data: MyOrg; error: string | null }> {
    const cols = 'id,company,is_agency,parent_client_id,status,client_partner,created_at';
    const [meRes, kidRes, invRes] = await Promise.all([
        supabase.from('clients').select(cols).eq('id', clientId).maybeSingle(),
        supabase.from('clients').select(cols).eq('parent_client_id', clientId).order('company'),
        supabase.from('agency_invites').select('*').eq('agency_client_id', clientId).order('created_at', { ascending: false }),
    ]);
    const asNode = (r: unknown) => ({ ...(r as Omit<OrgNode, 'has_cafe'>), has_cafe: true }) as OrgNode;
    return {
        data: {
            me: meRes.data ? asNode(meRes.data) : null,
            children: ((kidRes.data ?? []) as unknown[]).map(asNode),
            // 초대 코드 조회가 막혀 있어도(정책 미적용) 조직 목록은 떠야 한다.
            invites: (invRes.data ?? []) as AgencyInvite[],
        },
        error: meRes.error?.message ?? kidRes.error?.message ?? null,
    };
}

// ── 대행사 콘솔 (docs/agency-console.sql) ────────────────────────────────
//   전부 SECURITY DEFINER 함수로만 동작한다. 대행사에게 profiles·clients·cafe_tokens 의
//   쓰기 정책을 열면 남의 업체를 만들거나 자기 토큰을 늘리는 길이 함께 열리기 때문이다.
//   함수가 "호출자가 대행사인가 → 대상이 내 하위인가"를 매번 다시 확인한다.

export type AgencyPendingSignup = {
    profile_id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;      // 가입 시 적은 업체명
    biz_no: string | null;
    invite_code: string | null;
    created_at: string;
};

export type AgencyChild = {
    client_id: string;
    company: string | null;
    status: string | null;
    created_at: string | null;
    balance: number;   // 잔여 토큰
    granted: number;   // 받은 총합
    used: number;      // 발행에 쓴 합
};

export type AgencyTransfer = {
    id: string;
    created_at: string;
    agency_client_id: string;
    child_client_id: string;
    count: number;
    unit_price: number;
    amount: number;
    note: string | null;
};

export async function agencyPendingSignups() {
    const { data, error } = await supabase.rpc('agency_pending_signups');
    return { data: (data ?? []) as AgencyPendingSignup[], error };
}

export async function agencyChildren() {
    const { data, error } = await supabase.rpc('agency_children_overview');
    return { data: (data ?? []) as AgencyChild[], error };
}

// 승인 — 업체 생성·소속 연결·계정 활성화가 한 트랜잭션이다(중간 실패 시 전부 되돌아간다).
export async function agencyApproveSignup(profileId: string, company?: string) {
    const { error } = await supabase.rpc('agency_approve_signup', {
        p_profile_id: profileId,
        p_company: company?.trim() || null,
    });
    return { error };
}

// 반려 = 소속 표시만 뗀다. 계정 삭제 권한은 대행사에게 주지 않는다(되돌릴 수 없다).
export async function agencyReleaseSignup(profileId: string) {
    const { error } = await supabase.rpc('agency_release_signup', { p_profile_id: profileId });
    return { error };
}

export async function agencyTransferTokens(childId: string, count: number, unitPrice: number, note?: string) {
    const { error } = await supabase.rpc('agency_transfer_tokens', {
        p_child_client_id: childId,
        p_count: count,
        p_unit_price: unitPrice,
        p_note: note?.trim() || null,
    });
    return { error };
}

export async function agencyTransfers(agencyClientId: string) {
    const { data, error } = await supabase
        .from('agency_token_transfers')
        .select('*')
        .eq('agency_client_id', agencyClientId)
        .order('created_at', { ascending: false })
        .limit(50);
    return { data: (data ?? []) as AgencyTransfer[], error };
}

// ── 하위 업체 → 대행사 토큰 구매 (docs/agency-subrequest.sql) ────────────
//   우리↔대행사(cafe_token_requests)와 같은 4단계지만 표가 다르다.
//   이건 대행사가 처리하는 큐다 — 우리 큐에 섞이면 처리할 건과 구경만 할 건이 뒤섞인다.
//   우리는 관여하지 않지만 볼 수는 있다(is_internal 읽기 정책).

export type SubTokenRequest = {
    id: string;
    created_at: string;
    child_client_id: string;
    agency_client_id: string;
    requested_count: number | null;
    note: string | null;
    status: string;                    // pending | quoted | paid | done | rejected
    quoted_count: number | null;
    unit_price: number | null;
    amount: number | null;             // 공급가(부가세 미포함)
    quoted_at: string | null;
    paid_declared_at: string | null;
    depositor: string | null;
    granted_count: number | null;
    handled_at: string | null;
};

// 조회는 RLS 가 알아서 좁힌다 — 하위는 자기 것, 대행사는 자기 하위 것, 내부는 전부.
export async function listSubRequests(filter?: { agencyId?: string; childId?: string }) {
    let q = supabase.from('agency_token_requests').select('*').order('created_at', { ascending: false });
    if (filter?.agencyId) q = q.eq('agency_client_id', filter.agencyId);
    if (filter?.childId) q = q.eq('child_client_id', filter.childId);
    const { data, error } = await q;
    return { data: (data ?? []) as SubTokenRequest[], error };
}

// 하위 업체
export async function subRequestTokens(count: number, note?: string) {
    const { error } = await supabase.rpc('sub_request_tokens', { p_count: count, p_note: note?.trim() || null });
    return { error };
}
export async function subDeclarePayment(requestId: string, depositor?: string) {
    const { error } = await supabase.rpc('sub_declare_payment', {
        p_request_id: requestId, p_depositor: depositor?.trim() || null,
    });
    return { error };
}

// 대행사
export async function agencyQuoteRequest(requestId: string, count: number, unitPrice: number) {
    const { error } = await supabase.rpc('agency_quote_request', {
        p_request_id: requestId, p_count: count, p_unit_price: unitPrice,
    });
    return { error };
}
export async function agencyFulfillRequest(requestId: string) {
    const { error } = await supabase.rpc('agency_fulfill_request', { p_request_id: requestId });
    return { error };
}
export async function agencyRejectRequest(requestId: string) {
    const { error } = await supabase.rpc('agency_reject_request', { p_request_id: requestId });
    return { error };
}

// 내 상위 대행사(하위 업체 화면에서 '누구에게 신청하는지' 표시용). 없으면 직거래.
export async function myParentAgency(): Promise<{ id: string | null; company: string | null }> {
    const { data } = await supabase.rpc('my_parent_agency_id');
    const id = (data as string | null) ?? null;
    if (!id) return { id: null, company: null };
    const { data: c } = await supabase.from('clients').select('company').eq('id', id).maybeSingle();
    return { id, company: (c as { company: string | null } | null)?.company ?? null };
}
