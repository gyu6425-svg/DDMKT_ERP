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
