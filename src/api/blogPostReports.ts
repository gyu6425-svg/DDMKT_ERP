import { supabase } from '../lib/supabase';
import { getClientContracts, updateClientContract, type RewardWeeklyLog } from './clientContracts';

// 기자단 글 보고 — 기자단이 본인 담당 블로그 글을 '저장(save)' 또는 '발행(publish)'으로 보고.
//   회사가 '승인'하면 그때 추적글(blog_posts) 생성 + 계약 잔여 -1(카운트) + 외주비 1건이 딱 1회 잡힌다.
//   report_type = 저장/발행(기자단 히스토리 구분). 저장을 승인해 카운트된 뒤 기자단이 '발행' 버튼을 누르면
//   report_type만 publish로 바뀌고 재카운트는 없다(중복 방지). status = 대기/승인/반려.
export type ReportStatus = 'pending' | 'confirmed' | 'rejected' | 'published';
export type ReportType = 'save' | 'publish';

// 블로그 종류 — 브랜드 블로그는 외주비 8,000원 고정(대박종합주방 10,000), 그 외는 승인 시 금액 직접 입력.
export const BLOG_KINDS = ['브랜드 블로그', '최적화', '준최적화', '저인망 배포'] as const;
export type BlogKind = (typeof BLOG_KINDS)[number];
// 종류 미지정(구 데이터)은 브랜드 블로그로 간주.
export function isBrandKind(kind: string | null | undefined): boolean {
    return (kind ?? '브랜드 블로그') === '브랜드 블로그';
}

export type BlogPostReport = {
    id: string;
    blog_account_id: string;
    reporter_id: string | null;
    post_url: string;
    title: string | null;
    keyword: string | null;
    status: ReportStatus;
    report_type: ReportType; // 저장/발행 — 기자단 히스토리 버킷
    blog_kind: string | null; // 블로그 종류(브랜드/최적화/준최적화/저인망 배포). null=브랜드 간주
    out_amount: number | null; // 비-브랜드 외주비(승인 시 입력). null이면 브랜드 규칙(8,000/10,000)
    round: number | null; // 회차(n회차) — 기자단이 보고 시 입력
    published_at: string | null; // 기자단이 '발행' 처리한 시각(발행 히스토리)
    note: string | null;
    created_at: string;
    reviewed_at: string | null;
    reviewed_by: string | null;
    blog_post_id: string | null;
    paid: boolean; // 외주비 입금 여부(미입금/입금). 승인=미입금, '외주비 정산' 시 입금.
    paid_at: string | null; // 정산(입금) 처리 시각
};

// 외주비 정산(입금 처리, 내부) — 지정한 보고들을 입금(paid=true)으로. 주 단위 일괄 정산에 사용.
//   RLS: 'bpr 내부 전체'(is_internal)로 내부 직원만 update.
export async function settleReports(reportIds: string[]) {
    if (!reportIds.length) return { error: null, count: 0 };
    const { data, error } = await supabase
        .from('blog_post_reports')
        .update({ paid: true, paid_at: new Date().toISOString() })
        .in('id', reportIds)
        .in('status', ['confirmed', 'published']) // 승인(카운트)된 건만 정산 대상
        .select('id');
    return { error, count: data?.length ?? 0 };
}

// 발행/저장 승인 외주단가 — 대박종합주방만 10,000원, 그 외 8,000원. (브랜드 블로그 고정 규칙)
export function publishOutUnit(company: string): number {
    return (company || '').includes('대박종합주방') ? 10000 : 8000;
}

// 이 보고의 실제 외주단가 — 브랜드는 항상 회사명 규칙(8,000/10,000)으로 고정(입력값 무시, 조작 방지).
//   비-브랜드(최적화·준최적화·저인망)만 승인 시 입력한 out_amount를 사용(없으면 규칙 폴백).
export function reportOutUnit(report: Pick<BlogPostReport, 'out_amount' | 'blog_kind'>, company: string): number {
    if (isBrandKind(report.blog_kind)) return publishOutUnit(company);
    return report.out_amount != null ? report.out_amount : publishOutUnit(company);
}

// 보고 등록(기자단) — report_type(저장/발행) 지정. title 필수(UI에서 검증). RLS: 본인 + 본인 담당 블로그만.
export async function createReport(payload: {
    blog_account_id: string;
    reporter_id: string;
    post_url: string;
    title: string;
    report_type: ReportType;
    keyword?: string | null;
    round?: number | null;
    blog_kind?: string | null;
}) {
    // 같은 블로그에 같은 글(제목 동일)을 이미 보고했는지 확인한다.
    //   · 판별은 '제목'만으로 한다. 저장 보고는 같은 글 URL을 계속 재사용하므로(저장 상태·회차 반복)
    //     URL로 판별하면 제목이 다른 새 글도 URL 겹침만으로 잘못 중복 처리된다 → 제목 기준으로만 판정.
    //   · 같은 구분(저장/발행)으로 또 보고 = 진짜 중복 → 새로 만들지 않고 duplicate 신호(UI: '이미 등록한 글').
    //   · 구분이 바뀌면(저장→발행) 그 행을 이동시킨다(두 행으로 쌓이지 않게 · 승인 week키 rpt-<id> 동일 → 재계상 없음).
    //   · 반려됐던 건을 다시 보고하면 검토 대기로 되돌린다(재보고).
    const titleKey = (payload.title || '').trim();
    const { data: dupes } = await supabase
        .from('blog_post_reports')
        .select('*')
        .eq('blog_account_id', payload.blog_account_id)
        .returns<BlogPostReport[]>();
    const dup = (dupes ?? []).find((r) => !!titleKey && (r.title || '').trim() === titleKey);
    if (dup) {
        const sameType = (dup.report_type ?? 'save') === payload.report_type;
        // 같은 구분 + 반려 아님 = 이미 등록된 글(중복). 아무것도 바꾸지 않고 알림만.
        if (sameType && dup.status !== 'rejected') {
            return { data: [dup], error: null, duplicate: true };
        }
        const patch: Record<string, unknown> = {
            report_type: payload.report_type,
            title: payload.title,
            keyword: payload.keyword ?? null,
            round: payload.round ?? dup.round ?? null,
            blog_kind: payload.blog_kind ?? dup.blog_kind ?? null,
            post_url: payload.post_url,
            published_at:
                payload.report_type === 'publish' ? (dup.published_at ?? new Date().toISOString()) : dup.published_at,
        };
        if (dup.status === 'rejected') {
            patch.status = 'pending';
            patch.note = null;
            patch.reviewed_at = null;
            patch.reviewed_by = null;
            patch.blog_post_id = null;
        }
        const { data, error } = await supabase
            .from('blog_post_reports')
            .update(patch)
            .eq('id', dup.id)
            .select()
            .returns<BlogPostReport[]>();
        return { data: data ?? [], error, duplicate: false };
    }

    const { data, error } = await supabase
        .from('blog_post_reports')
        .insert({
            blog_account_id: payload.blog_account_id,
            reporter_id: payload.reporter_id,
            post_url: payload.post_url,
            title: payload.title,
            keyword: payload.keyword ?? null,
            report_type: payload.report_type,
            round: payload.round ?? null,
            blog_kind: payload.blog_kind ?? null,
            published_at: payload.report_type === 'publish' ? new Date().toISOString() : null,
        })
        .select()
        .returns<BlogPostReport[]>();
    return { data: data ?? [], error, duplicate: false };
}

// 보고 목록 — 내부는 전체(status/type 필터), 기자단은 RLS로 본인 것만, 고객은 RLS로 자기 업체 블로그만.
//   blog_account_id 지정 시 특정 블로그 보고만(성과 모달의 '저장,발행 성과' 히스토리용).
export async function getReports(opts?: { status?: ReportStatus; report_type?: ReportType; blog_account_id?: string }) {
    let query = supabase.from('blog_post_reports').select('*').order('created_at', { ascending: false });
    if (opts?.status) query = query.eq('status', opts.status);
    if (opts?.report_type) query = query.eq('report_type', opts.report_type);
    if (opts?.blog_account_id) query = query.eq('blog_account_id', opts.blog_account_id);
    const { data, error } = await query.returns<BlogPostReport[]>();
    return { data: data ?? [], error };
}

// (내부) 브랜드 블로그 계약 잔여 -1 + 진행처리 1건 · 외주비. 보고별 고유 week키(rpt-id)로 중복 계상 방지.
async function bookContractCredit(report: BlogPostReport) {
    const { data: accs } = await supabase
        .from('blog_accounts')
        .select('id,client_id,name')
        .eq('id', report.blog_account_id);
    const acc = (accs ?? [])[0] as { client_id?: string | null; name?: string | null } | undefined;
    const clientId = acc?.client_id ?? null;
    // 비-브랜드(out_amount 지정)는 계약이 없어도 그 금액을 외주비로 보고(정산엔 보고행이 직접 반영됨).
    //   브랜드는 회사명 규칙이라 계약(회사)이 없으면 0으로 폴백(주입값 무시).
    if (!clientId) {
        const noClientOut = isBrandKind(report.blog_kind) ? 0 : report.out_amount ?? 0;
        return { processed: false, outUnit: noClientOut, err: null as { message: string } | null };
    }
    let company = '';
    const { data: cl } = await supabase.from('clients').select('company').eq('id', clientId);
    company = ((cl ?? [])[0] as { company?: string } | undefined)?.company ?? '';
    const outUnit = reportOutUnit(report, company);
    const { data: contracts, error: cErr } = await getClientContracts(clientId);
    if (cErr) return { processed: false, outUnit, err: cErr };
    const sub = (ct: { subtype: string }) => ct.subtype.replace(/^상위노출 보장형 · /, '');
    const blogs = contracts.filter((ct) => ct.category === '블로그');
    const target =
        (acc?.name ? blogs.find((ct) => (ct.blog_name || '') === acc.name) : undefined) ||
        blogs.find((ct) => sub(ct) === '브랜드 블로그') ||
        blogs.find((ct) => sub(ct) === '블로그') ||
        (blogs.length === 1 ? blogs[0] : null);
    if (!target) return { processed: false, outUnit, err: null };
    // 이미 이 보고로 계상된 로그가 있으면(안전판) 재계상 금지.
    const key = `rpt-${report.id}`;
    if ((target.weekly_logs ?? []).some((l) => l.week === key)) return { processed: true, outUnit, err: null };
    const goal = target.goal_count ?? 0;
    const nextRemain = Math.max(0, (target.remain_count ?? goal) - 1);
    const log: RewardWeeklyLog = {
        at: new Date().toISOString().slice(0, 10),
        count: 1,
        note: `${report.report_type === 'publish' ? '발행' : '저장'} 승인: ${report.title || report.post_url}`,
        outUnit,
        paid: false,
        tax: true,
        vendor: '기자단',
        week: key,
    };
    const { error: uErr } = await updateClientContract(target.id, {
        remain_count: nextRemain,
        unit_outsource: outUnit,
        weekly_logs: [...(target.weekly_logs ?? []), log],
    });
    return { processed: !uErr, outUnit, err: uErr ?? null };
}

// 승인(회사) — pending 보고를 승인하면서 ① 추적글 생성 ② 계약 잔여 -1 + 외주비 1건을 딱 1회 처리.
//   원자적 클레임(.eq status pending)으로 중복 승인/동시 클릭 시 카운트 이중 계상 방지. 저장·발행 둘 다 동일.
//   outAmount: 비-브랜드 블로그(최적화/준최적화/저인망)의 외주비 금액. 지정 시 out_amount로 저장돼
//   외주비 계상·기자단 정산에 그 금액으로 반영된다. 브랜드 블로그면 생략(8,000/10,000 규칙).
export async function approveReport(
    report: BlogPostReport,
    reviewerProfileId: string | null,
    outAmount?: number | null,
) {
    // 1) 원자적 클레임: pending → confirmed(+ 비-브랜드면 외주비 금액 저장). 실제 1행을 바꾼 '이긴' 호출만 아래 처리.
    const claimPatch: Record<string, unknown> = {
        status: 'confirmed',
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewerProfileId,
    };
    if (outAmount != null) claimPatch.out_amount = outAmount;
    const { data: claimed, error: claimErr } = await supabase
        .from('blog_post_reports')
        .update(claimPatch)
        .eq('id', report.id)
        .eq('status', 'pending')
        .select('id');
    if (claimErr) return { error: claimErr, processed: false, outUnit: 0 };
    if (!claimed || claimed.length === 0) return { error: null, processed: false, outUnit: 0 }; // 이미 승인됨
    // 아래 계약 계상은 방금 저장한 외주비 금액을 반영해야 하므로 병합본으로 넘긴다.
    const bookReport: BlogPostReport = { ...report, out_amount: outAmount ?? report.out_amount };

    // 2) 추적글 생성(같은 URL 이미 추적 중이면 재사용) → blog_post_id 연결.
    const base = (report.post_url || '').split('?')[0];
    let postId: string | null = null;
    if (base) {
        const { data: existing } = await supabase
            .from('blog_posts')
            .select('id,post_url')
            .eq('blog_account_id', report.blog_account_id);
        const hit = (existing ?? []).find((p) => (p.post_url || '').split('?')[0] === base);
        if (hit) postId = (hit as { id: string }).id;
    }
    if (!postId) {
        const { data: post } = await supabase
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
        postId = (post as { id?: string } | null)?.id ?? null;
    }
    if (postId) {
        await supabase.from('blog_post_reports').update({ blog_post_id: postId }).eq('id', report.id);
    }

    // 3) 계약 카운트 +1 · 외주비(중복 방지). 실패해도 승인은 유지 — 오류 표면화.
    const { processed, outUnit, err } = await bookContractCredit(bookReport);
    return { error: err, processed, outUnit };
}

// 기자단 '발행' 처리 — 저장으로 보고한 글을 발행했을 때. report_type만 publish로 + published_at.
//   계약/카운트는 승인 시 이미 1회 처리되므로 여기서는 재계상하지 않는다(중복 방지). RLS: 본인 보고만.
export async function markPublished(reportId: string) {
    // RPC(SECURITY DEFINER)로 발행 이동. 기자단의 직접 UPDATE는 RLS상 status='rejected'만 허용돼
    //   저장(pending/confirmed)건이 0행 업데이트로 조용히 실패하던 문제를 해결(권한 상승 없이 발행 이동만).
    const { error } = await supabase.rpc('mark_report_published', { p_report_id: reportId });
    return { error };
}

// 재보고(기자단) — 반려된 본인 보고를 수정해 다시 대기(pending)로. type/제목 유지·수정.
export async function resubmitReport(
    id: string,
    payload: { blog_account_id: string; post_url: string; keyword?: string | null; title: string; report_type: ReportType },
) {
    const { error } = await supabase
        .from('blog_post_reports')
        .update({
            blog_account_id: payload.blog_account_id,
            post_url: payload.post_url,
            keyword: payload.keyword ?? null,
            title: payload.title,
            report_type: payload.report_type,
            status: 'pending',
            note: null,
            reviewed_at: null,
            reviewed_by: null,
            blog_post_id: null,
        })
        .eq('id', id);
    return { error };
}

// 반려(회사).
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
