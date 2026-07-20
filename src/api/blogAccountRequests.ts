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

// 기자단 업체 등록으로 승인되어 생긴 블로그 id 집합.
//   이 블로그들은 계약 관리에 연동되지 않아(client_id=null) 계약 잔여/외주비를 잡을 수 없다.
//   → 글 보고 승인 시 블로그 자체 진행 건수만 +1 하고 외주비는 제외하는 판정에 쓴다.
//   ※ client_id=null 이라고 전부 여기 해당하는 건 아니다(시트 붙여넣기로 등록한 기존 브랜드
//     블로그도 client_id 가 비어 있을 수 있음). 그래서 신청 이력이 있는 것만 정확히 골라낸다.
//   ※ 이 판정은 '표시/입력' 용도로만 쓴다. 실제 진행 카운트와 외주비 계상 여부는 DB 함수
//     count_blog_progress 가 단독으로 결정한다(앱 판정이 어긋나도 금액이 잘못 잡히지 않도록).
//     조회 실패 시 조용히 빈 Set 을 주면 금액이 잘못 보일 수 있어 오류를 함께 반환한다.
export async function getReporterRegisteredBlogIds(): Promise<Set<string>> {
    const { ids } = await getReporterRegisteredBlogIdsSafe();
    return ids;
}

export async function getReporterRegisteredBlogIdsSafe(): Promise<{
    ids: Set<string>;
    error: { message: string } | null;
}> {
    const { data, error } = await supabase
        .from('blog_account_requests')
        .select('blog_account_id')
        .eq('status', 'approved')
        .not('blog_account_id', 'is', null)
        .returns<{ blog_account_id: string | null }[]>();
    const linked = (data ?? []).map((r) => r.blog_account_id).filter((id): id is string => !!id);
    if (error || !linked.length) return { ids: new Set<string>(), error: error ?? null };
    // 신청 이력이 있어도 그 뒤 계약 관리에 연동됐으면(client_id 있음) 계약 규칙대로 외주비가 잡힌다.
    //   → 계약 미연동(client_id is null)인 것만 '외주비 없음' 대상. DB 함수 count_blog_progress 의
    //     판정 조건과 동일하게 맞춘다(둘이 갈라지면 정산 금액이 실제 계상과 어긋난다).
    const { data: accs, error: accErr } = await supabase
        .from('blog_accounts')
        .select('id')
        .in('id', linked)
        .is('client_id', null)
        .returns<{ id: string }[]>();
    if (accErr) return { ids: new Set<string>(), error: accErr };
    return { ids: new Set((accs ?? []).map((a) => a.id)), error: null };
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
    if (claimErr) return { error: claimErr, account: null, linked: false, note: null as string | null };
    if (!(claimed ?? []).length)
        return {
            error: { message: '이미 처리된 신청입니다' },
            account: null,
            linked: false,
            note: null as string | null,
        };

    const rollback = async () => {
        await supabase
            .from('blog_account_requests')
            .update({ status: 'pending', reviewed_at: null, reviewed_by: null })
            .eq('id', req.id);
    };

    // 2) 같은 blog_url 이 이미 등록돼 있으면 새로 만들지 않고 그 블로그에 '연결'한다.
    //    blog_accounts.blog_url 은 unique 라 그냥 insert 하면 승인이 실패한다.
    //    ※ 기존 값은 덮어쓰지 않는다 — 계약에 연동된 블로그(client_id 있음)의 계약 건수/잔여를
    //      기자단이 적어낸 숫자로 갈아치우면 계약 데이터가 훼손되므로, 비어 있는 값만 채운다.
    const { data: dupList, error: dupErr } = await supabase
        .from('blog_accounts')
        .select('id,name,client_id,reporter_id,goal_count,remain_count')
        .eq('blog_url', req.blog_url)
        .returns<
            {
                id: string;
                name: string;
                client_id: string | null;
                reporter_id: string | null;
                goal_count: number | null;
                remain_count: number | null;
            }[]
        >();
    if (dupErr) {
        await rollback();
        return { error: dupErr, account: null, linked: false, note: null as string | null };
    }
    const existing = (dupList ?? [])[0];
    if (existing) {
        const patch: Record<string, unknown> = {};
        const notes: string[] = [];
        // 담당 기자단은 비어 있을 때만 배정 — 이미 다른 기자단이 담당 중이면 뺏지 않는다.
        if (!existing.reporter_id) patch.reporter_id = req.reporter_id;
        else if (existing.reporter_id !== req.reporter_id)
            notes.push('이미 다른 기자단이 담당 중이라 담당자는 그대로 둡니다');
        // 계약 건수는 계약 미연동이고 아직 비어 있을 때만 채운다.
        if (existing.client_id) {
            notes.push('계약 관리에 연동된 블로그라 계약 건수/잔여는 계약 값을 유지합니다');
        } else if (existing.goal_count == null && req.contract_count != null) {
            patch.goal_count = req.contract_count;
            patch.remain_count = Math.max(0, req.contract_count - (req.progress_count ?? 0));
        } else if (existing.goal_count != null) {
            notes.push('이미 입력된 계약 건수가 있어 건수는 그대로 둡니다');
        }
        if (Object.keys(patch).length) {
            const { error: upErr } = await supabase.from('blog_accounts').update(patch).eq('id', existing.id);
            if (upErr) {
                await rollback();
                return { error: upErr, account: null, linked: false, note: null as string | null };
            }
        }
        await supabase.from('blog_account_requests').update({ blog_account_id: existing.id }).eq('id', req.id);
        return {
            error: null,
            account: { id: existing.id, name: existing.name },
            linked: true,
            note: notes.join(' · ') || null,
        };
    }

    // 3) 신규 생성 — 계약 건=goal_count, 잔여=계약-진행, 담당 기자단=신청자.
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
        // 롤백 — 승인 취소하고 오류를 표면화. 위 조회와 insert 사이에 다른 곳에서 같은 URL이
        //   등록되는 경합(드묾)도 여기로 떨어지므로 사람이 읽을 수 있는 문구로 바꾼다.
        await rollback();
        const friendly = /duplicate key|unique constraint/i.test(accErr.message)
            ? { message: '같은 블로그 주소가 방금 등록되었습니다. 새로고침 후 다시 승인해 주세요.' }
            : accErr;
        return { error: friendly, account: null, linked: false, note: null as string | null };
    }
    const account = (accs ?? [])[0] ?? null;
    // 4) 생성된 블로그 id 연결(실패해도 승인 자체는 유효 — 링크만 비어있음).
    if (account) {
        await supabase.from('blog_account_requests').update({ blog_account_id: account.id }).eq('id', req.id);
    }
    return { error: null, account, linked: false, note: null as string | null };
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
