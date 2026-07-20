import { supabase } from '../lib/supabase';
import { extractBlogId, insertBlogAccounts } from './blogRank';

// 기자단 업체 등록 신청 — 기자단이 본인이 진행할 업체를 직접 신청하고, 회사가 브랜드 블로그 시트
//   '승인 대기' 탭에서 승인하면 그때 blog_accounts(브랜드 블로그) 행이 생긴다.
//   승인된 업체는 client_id = null → 계약 관리에는 들어가지 않고 블로그 대시보드에서만 관리한다.
//   (나중에 계약 관리와 통합 예정 — 그때 client_id를 채워 연결)
export type RequestStatus = 'pending' | 'approved' | 'rejected';

export type BlogAccountRequest = {
    id: string;
    reporter_id: string | null;
    name: string; // 업체 이름
    blog_url: string; // 블로그 주소
    contract_count: number | null; // 계약 건
    progress_count: number | null; // 진행 건
    status: RequestStatus;
    note: string | null; // 반려 사유
    created_at: string;
    reviewed_at: string | null;
    reviewed_by: string | null;
    blog_account_id: string | null; // 승인 시 생성된 블로그
};

// 신청 목록 — 내부는 전체, 기자단은 RLS로 본인 것만. status 주면 그 상태만.
export async function getAccountRequests(status?: RequestStatus) {
    let query = supabase
        .from('blog_account_requests')
        .select('*')
        .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query.returns<BlogAccountRequest[]>();
    return { data: data ?? [], error };
}

// 기자단 신청 등록. 같은 블로그 주소를 이미 신청(검토중)했으면 duplicate로 알린다.
export async function createAccountRequest(payload: {
    reporter_id: string;
    name: string;
    blog_url: string;
    contract_count: number | null;
    progress_count: number | null;
}): Promise<{ data: BlogAccountRequest | null; error: { message: string } | null; duplicate?: boolean }> {
    const url = payload.blog_url.trim();
    // 본인 신청 중 같은 URL이 이미 검토중이면 중복 → 행을 또 만들지 않는다.
    const { data: dup } = await supabase
        .from('blog_account_requests')
        .select('id')
        .eq('reporter_id', payload.reporter_id)
        .eq('blog_url', url)
        .eq('status', 'pending')
        .returns<{ id: string }[]>();
    if ((dup ?? []).length) return { data: null, error: null, duplicate: true };

    const { data, error } = await supabase
        .from('blog_account_requests')
        .insert({ ...payload, blog_url: url, name: payload.name.trim(), status: 'pending' })
        .select()
        .returns<BlogAccountRequest[]>();
    return { data: (data ?? [])[0] ?? null, error };
}

// 반려 신청 재신청 — 내용 수정 후 다시 검토중(pending)으로.
export async function resubmitAccountRequest(
    id: string,
    payload: { name: string; blog_url: string; contract_count: number | null; progress_count: number | null },
) {
    const { error } = await supabase
        .from('blog_account_requests')
        .update({
            ...payload,
            name: payload.name.trim(),
            blog_url: payload.blog_url.trim(),
            status: 'pending',
            note: null,
        })
        .eq('id', id)
        .eq('status', 'rejected');
    return { error };
}

// 승인(내부) — 신청을 브랜드 블로그(blog_accounts)로 등록.
//   중복 승인 방지: 먼저 status='pending' 조건으로 원자적 클레임 → 성공한 호출만 블로그를 만든다.
//   블로그 생성이 실패하면 신청을 pending으로 되돌려 다시 승인할 수 있게 한다(반쪽 상태 방지).
export async function approveAccountRequest(req: BlogAccountRequest, reviewerProfileId: string) {
    const nowIso = new Date().toISOString();
    // 1) 원자적 클레임 — 이미 처리된 신청이면 0행 → 중복 생성 차단.
    const { data: claimed, error: claimErr } = await supabase
        .from('blog_account_requests')
        .update({ status: 'approved', reviewed_at: nowIso, reviewed_by: reviewerProfileId })
        .eq('id', req.id)
        .eq('status', 'pending')
        .select('id');
    if (claimErr) return { error: claimErr, account: null };
    if (!(claimed ?? []).length) return { error: { message: '이미 처리된 신청입니다' }, account: null };

    // 2) 브랜드 블로그 생성 — 계약 건=goal_count, 잔여=계약-진행, 담당 기자단=신청자.
    //    client_id는 비워둔다(계약 관리 미연동 — 블로그 대시보드에서만 관리).
    const contract = req.contract_count ?? null;
    const progress = req.progress_count ?? 0;
    const remain = contract == null ? null : Math.max(0, contract - progress);
    const { data: accs, error: accErr } = await insertBlogAccounts([
        {
            name: req.name,
            blog_url: req.blog_url,
            blog_id: extractBlogId(req.blog_url) || null,
            goal_count: contract,
            remain_count: remain,
            reporter_id: req.reporter_id,
            client_id: null,
            is_active: true,
        },
    ]);
    if (accErr) {
        // 롤백 — 승인 취소하고 오류를 그대로 표면화(같은 blog_url 중복 등).
        await supabase
            .from('blog_account_requests')
            .update({ status: 'pending', reviewed_at: null, reviewed_by: null })
            .eq('id', req.id);
        return { error: accErr, account: null };
    }
    const account = (accs ?? [])[0] ?? null;
    // 3) 생성된 블로그 id 연결(실패해도 승인 자체는 유효 — 링크만 비어있음).
    if (account) {
        await supabase.from('blog_account_requests').update({ blog_account_id: account.id }).eq('id', req.id);
    }
    return { error: null, account };
}

// 반려(내부) — 사유를 남기면 기자단이 수정 후 재신청할 수 있다.
export async function rejectAccountRequest(id: string, reviewerProfileId: string, note: string) {
    const { error } = await supabase
        .from('blog_account_requests')
        .update({
            status: 'rejected',
            note: note.trim() || null,
            reviewed_at: new Date().toISOString(),
            reviewed_by: reviewerProfileId,
        })
        .eq('id', id)
        .eq('status', 'pending');
    return { error };
}
