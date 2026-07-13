import { supabase } from '../lib/supabase';
import { getClientContracts, updateClientContract, type RewardWeeklyLog } from './clientContracts';

// 기자단 글 보고 — 기자단이 본인 담당 블로그 글 URL을 보고(insert), 내부가 확인 시 추적글(blog_posts) 생성.
//   상태 흐름: pending(보고) → confirmed(승인) → published(발행 완료) / rejected(반려).
export type ReportStatus = 'pending' | 'confirmed' | 'rejected' | 'published';
export type BlogPostReport = {
    id: string;
    blog_account_id: string;
    reporter_id: string | null;
    post_url: string;
    title: string | null;
    keyword: string | null;
    status: ReportStatus;
    note: string | null;
    created_at: string;
    reviewed_at: string | null;
    reviewed_by: string | null;
    blog_post_id: string | null;
};

// 발행 완료 외주단가 — 대박종합주방만 10,000원, 그 외 8,000원.
export function publishOutUnit(company: string): number {
    return (company || '').includes('대박종합주방') ? 10000 : 8000;
}

// 보고 등록(기자단) — RLS가 본인 reporter_id + 본인 담당 블로그만 허용.
export async function createReport(payload: {
    blog_account_id: string;
    reporter_id: string;
    post_url: string;
    title?: string | null;
    keyword?: string | null;
}) {
    const { data, error } = await supabase
        .from('blog_post_reports')
        .insert(payload)
        .select()
        .returns<BlogPostReport[]>();
    return { data: data ?? [], error };
}

// 보고 목록 — 내부는 전체(status로 필터), 기자단은 RLS로 본인 것만.
export async function getReports(status?: ReportStatus) {
    let query = supabase.from('blog_post_reports').select('*').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query.returns<BlogPostReport[]>();
    return { data: data ?? [], error };
}

// 확인(내부) → 추적글 생성 + 보고 confirmed. 크롤러가 이후 순위를 측정한다.
//   같은 URL(쿼리 제외 기준)이 이미 추적 중이면 중복 생성하지 않고 기존 글에 연결(크롤 현황 오염 방지).
export async function confirmReport(report: BlogPostReport, reviewerProfileId: string | null) {
    const base = (report.post_url || '').split('?')[0];
    let postId: string | null = null;
    if (base) {
        const { data: existing } = await supabase
            .from('blog_posts')
            .select('id,post_url')
            .eq('blog_account_id', report.blog_account_id);
        const hit = (existing ?? []).find((p) => (p.post_url || '').split('?')[0] === base);
        if (hit) postId = (hit as { id: string }).id; // 이미 추적 중 → 재사용
    }
    if (!postId) {
        const { data: post, error: postErr } = await supabase
            .from('blog_posts')
            .insert({
                blog_account_id: report.blog_account_id,
                post_url: report.post_url,
                title: report.title,
                keyword_manual: report.keyword,
                published_date: (report.created_at || '').slice(0, 10) || null,
                measurements: [],
            })
            .select('id')
            .single();
        if (postErr) return { error: postErr };
        postId = (post as { id?: string } | null)?.id ?? null;
    }
    const { error } = await supabase
        .from('blog_post_reports')
        .update({
            status: 'confirmed',
            reviewed_at: new Date().toISOString(),
            reviewed_by: reviewerProfileId,
            blog_post_id: postId,
        })
        .eq('id', report.id);
    return { error };
}

// 발행 완료(내부) — 승인(confirmed)된 보고를 '발행 완료'로 전환하면서:
//   ① 그 블로그의 '브랜드 블로그' 계약 잔여 -1(카운트) ② 진행처리 히스토리에 1건 · 외주비(대박종합주방=10,000/그외 8,000) 추가.
//   되돌리기 방지: 이미 published면 계약 처리 없이 통과. (계약은 client_contracts 단일 출처, 진행 이력=weekly_logs)
export async function publishReport(report: BlogPostReport, reviewerProfileId: string | null) {
    // 1) 원자적 클레임 — confirmed → published (동시/중복 클릭 방지). 이 update가 1행을 실제로 바꾼 '이긴' 호출만 계약을 처리.
    //    .eq('status','confirmed')로 조건부 갱신하므로 두 번째 호출은 0행 → 중복 계상 없음.
    const { data: claimed, error: claimErr } = await supabase
        .from('blog_post_reports')
        .update({ reviewed_at: new Date().toISOString(), reviewed_by: reviewerProfileId, status: 'published' })
        .eq('id', report.id)
        .eq('status', 'confirmed')
        .select('id');
    if (claimErr) return { error: claimErr, processed: false, outUnit: 0 };
    if (!claimed || claimed.length === 0) return { error: null, processed: false, outUnit: 0 }; // 이미 처리됨/상태 아님

    // 2) 블로그 계정 → client_id, 이름(다중 블로그 매칭용).
    const { data: accs } = await supabase
        .from('blog_accounts')
        .select('id,client_id,name')
        .eq('id', report.blog_account_id);
    const acc = (accs ?? [])[0] as { client_id?: string | null; name?: string | null } | undefined;
    const clientId = acc?.client_id ?? null;
    // 3) 업체명 → 외주단가 판정(대박종합주방=10,000 / 그외 8,000).
    let company = '';
    if (clientId) {
        const { data: cl } = await supabase.from('clients').select('company').eq('id', clientId);
        company = ((cl ?? [])[0] as { company?: string } | undefined)?.company ?? '';
    }
    const outUnit = publishOutUnit(company);
    // 4) 브랜드 블로그 계약 찾기 → 잔여 -1 + 진행처리 1건 + 외주단가를 outUnit으로 정렬(진행률/소진율 일치).
    let processed = false;
    let bookErr: { message: string } | null = null;
    if (clientId) {
        const { data: contracts, error: cErr } = await getClientContracts(clientId);
        if (cErr) bookErr = cErr;
        // 부스트 접두(상위노출 보장형 · )가 붙어도 브랜드블로그로 판정되게 접두 제거 후 매칭.
        const sub = (ct: { subtype: string }) => ct.subtype.replace(/^상위노출 보장형 · /, '');
        const blogs = contracts.filter((ct) => ct.category === '블로그');
        const target =
            (acc?.name ? blogs.find((ct) => (ct.blog_name || '') === acc.name) : undefined) ||
            blogs.find((ct) => sub(ct) === '브랜드 블로그') ||
            blogs.find((ct) => sub(ct) === '블로그') ||
            (blogs.length === 1 ? blogs[0] : null); // 블로그 계약이 하나뿐이면 그걸로(단일 블로그 안전판)
        if (target) {
            const goal = target.goal_count ?? 0;
            const nextRemain = Math.max(0, (target.remain_count ?? goal) - 1);
            const log: RewardWeeklyLog = {
                at: new Date().toISOString().slice(0, 10),
                count: 1,
                note: `발행완료: ${report.title || report.post_url}`,
                outUnit,
                paid: false,
                tax: true,
                vendor: '기자단',
                week: `pub-${report.id}`, // 보고별 고유 키
            };
            const logs = [...(target.weekly_logs ?? []), log];
            const { error: uErr } = await updateClientContract(target.id, {
                remain_count: nextRemain,
                unit_outsource: outUnit, // 계약 외주단가를 8,000/10,000으로 정렬 → totalOutsource·소진율 일치
                weekly_logs: logs,
            });
            if (uErr) bookErr = uErr;
            else processed = true;
        }
    }
    // 오류가 있으면 표면화(조용한 미기록 방지). 상태는 이미 published라, 실패 시 계약 상세에서 수동 보정 필요.
    return { error: bookErr, processed, outUnit };
}

// 재보고(기자단) — 반려된 본인 보고를 수정해 다시 검토중(pending)으로. RLS가 자기확인 방지.
export async function resubmitReport(
    id: string,
    payload: { blog_account_id: string; post_url: string; keyword?: string | null; title?: string | null },
) {
    const { error } = await supabase
        .from('blog_post_reports')
        .update({
            blog_account_id: payload.blog_account_id,
            post_url: payload.post_url,
            keyword: payload.keyword ?? null,
            title: payload.title ?? null,
            status: 'pending',
            note: null,
            reviewed_at: null,
            reviewed_by: null,
            blog_post_id: null,
        })
        .eq('id', id);
    return { error };
}

// 반려(내부).
export async function rejectReport(id: string, reviewerProfileId: string | null, note?: string) {
    const { error } = await supabase
        .from('blog_post_reports')
        .update({
            status: 'rejected',
            reviewed_at: new Date().toISOString(),
            reviewed_by: reviewerProfileId,
            note: note ?? null,
        })
        .eq('id', id);
    return { error };
}
