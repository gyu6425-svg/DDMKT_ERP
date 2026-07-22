import { supabase } from '../lib/supabase';
import { getClientContracts, updateClientContract, type RewardWeeklyLog } from './clientContracts';

// 승인 시 카운트가 어디에 잡혔는지 — 'contract'=계약 잔여 -1 + 외주비, 'blog'=블로그 진행 건수만
//   (기자단 등록 업체 · 외주비 없음), 'none'=연결된 계약이 없어 카운트 미반영.
export type BookMode = 'contract' | 'blog' | 'none';

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
    settled?: boolean | null; // 정산 여부(정산/미정산) — 입금의 '전 단계' 상태 구분용. 회계/외주비에는 영향 없음.
    settled_at?: string | null; // 정산 처리 시각
};

// (내부) 이 보고에 대응하는 계약 진행이력(week=rpt-id) 로그의 paid를 동기화. 매칭 로그 없으면 no-op.
//   입금 처리/정산이 기자단 정산과 계약 상세 진행이력에서 항상 같은 상태가 되도록 하는 단일 경로.
async function syncContractLogPaid(report: Pick<BlogPostReport, 'id' | 'blog_account_id'>, paid: boolean) {
    const { data: accs } = await supabase.from('blog_accounts').select('client_id').eq('id', report.blog_account_id);
    const clientId = ((accs ?? [])[0] as { client_id?: string | null } | undefined)?.client_id ?? null;
    if (!clientId) return null;
    const { data: contracts } = await getClientContracts(clientId);
    const key = `rpt-${report.id}`;
    for (const ct of contracts) {
        const logs = ct.weekly_logs ?? [];
        if (logs.some((l) => l.week === key)) {
            const newLogs = logs.map((l) => (l.week === key ? { ...l, paid } : l));
            const { error } = await updateClientContract(ct.id, { weekly_logs: newLogs });
            return error ?? null;
        }
    }
    return null;
}

// 외주비 정산(입금 처리, 내부) — 지정한 보고들을 입금(paid=true)으로 + 계약 진행이력도 함께 처리로 동기화.
//   RLS: 'bpr 내부 전체'(is_internal)로 내부 직원만 update.
export async function settleReports(reportIds: string[]) {
    if (!reportIds.length) return { error: null, count: 0 };
    // 진행이력 동기화를 위해 대상 보고(blog_account_id) 확보.
    const { data: reps } = await supabase
        .from('blog_post_reports')
        .select('id,blog_account_id,status')
        .in('id', reportIds)
        .in('status', ['confirmed', 'published'])
        .returns<Pick<BlogPostReport, 'id' | 'blog_account_id'>[]>();
    const { data, error } = await supabase
        .from('blog_post_reports')
        .update({ paid: true, paid_at: new Date().toISOString() })
        .in('id', reportIds)
        .in('status', ['confirmed', 'published']) // 승인(카운트)된 건만 정산 대상
        .select('id');
    if (error) return { error, count: 0 };
    for (const r of reps ?? []) await syncContractLogPaid(r, true); // 계약 진행이력도 처리로
    return { error: null, count: data?.length ?? 0 };
}

// 기자단 보고 '입금 처리' 토글 — 정산(report.paid) + 계약 진행이력(week=rpt-id) 로그 paid를 함께 동기화.
//   회사 ERP '승인 처리 내역'의 입금 버튼 → 기자단 정산(미입금↔입금) + 계약 상세 진행이력(미처리↔처리) 동시 반영.
export async function setReportPaid(report: BlogPostReport, paid: boolean) {
    const nowIso = new Date().toISOString();
    // 1) 보고행 paid(승인 확정 건만)
    const { error: e1 } = await supabase
        .from('blog_post_reports')
        .update({ paid, paid_at: paid ? nowIso : null })
        .eq('id', report.id)
        .in('status', ['confirmed', 'published']);
    if (e1) return { error: e1 };
    // 2) 계약 진행이력(week=rpt-id) 로그 paid 동기화 — 실패 시 오류 표면화(반쪽 동기화 방지).
    const e2 = await syncContractLogPaid(report, paid);
    return { error: e2 };
}

// 기자단 보고 '정산' 토글(정산/미정산) — 입금의 전 단계 상태 구분용.
//   입금(paid)·계약 진행이력·외주비에는 전혀 영향 없음. 순수 상태 플래그.
//   ※ blog_post_reports.settled 컬럼 필요(docs/blog-report-settled.sql). 없으면 update 가 오류 반환.
export async function setReportSettled(report: BlogPostReport, settled: boolean) {
    const { error } = await supabase
        .from('blog_post_reports')
        .update({ settled, settled_at: settled ? new Date().toISOString() : null })
        .eq('id', report.id)
        .in('status', ['confirmed', 'published']);
    return { error };
}

// 발행/저장 승인 외주단가 — 아래 업체는 10,000원, 그 외 8,000원. (브랜드 블로그 고정 규칙)
const OUT_UNIT_10K = ['대박종합주방', '위너키친'];
export function publishOutUnit(company: string): number {
    return OUT_UNIT_10K.some((n) => (company || '').includes(n)) ? 10000 : 8000;
}

// 이 보고의 실제 외주단가 — 브랜드는 항상 회사명 규칙(8,000/10,000)으로 고정(입력값 무시, 조작 방지).
//   비-브랜드(최적화·준최적화·저인망)만 승인 시 입력한 out_amount를 사용(없으면 규칙 폴백).
export function reportOutUnit(report: Pick<BlogPostReport, 'out_amount' | 'blog_kind'>, company: string): number {
    if (isBrandKind(report.blog_kind)) return publishOutUnit(company);
    return report.out_amount != null ? report.out_amount : publishOutUnit(company);
}

// 스키마 드리프트 대응 — 새 컬럼(blog_kind·out_amount·round 등) 마이그레이션 실행 전에도 보고가 되게,
//   'column not found'(PGRST204/42703) 오류면 그 컬럼을 빼고 재시도. SQL 실행 후엔 그대로 저장됨.
const missingCol = (msg: string) =>
    (/Could not find the '([a-z_]+)' column|column "?blog_post_reports\.?([a-z_]+)"?/i.exec(msg || '') || [])
        .slice(1)
        .find(Boolean);
async function bprInsert(row: Record<string, unknown>) {
    const r = { ...row };
    for (let i = 0; i < 6; i += 1) {
        const { data, error } = await supabase.from('blog_post_reports').insert(r).select().returns<BlogPostReport[]>();
        if (!error) return { data: data ?? [], error: null as { message: string } | null };
        const col = missingCol(error.message);
        if (col && col in r) {
            delete r[col];
            continue;
        }
        return { data: [] as BlogPostReport[], error };
    }
    return { data: [] as BlogPostReport[], error: { message: '보고 저장 반복 실패' } };
}
async function bprUpdate(id: string, patch: Record<string, unknown>) {
    const p = { ...patch };
    for (let i = 0; i < 6; i += 1) {
        const { data, error } = await supabase.from('blog_post_reports').update(p).eq('id', id).select().returns<BlogPostReport[]>();
        if (!error) return { data: data ?? [], error: null as { message: string } | null };
        const col = missingCol(error.message);
        if (col && col in p) {
            delete p[col];
            continue;
        }
        return { data: [] as BlogPostReport[], error };
    }
    return { data: [] as BlogPostReport[], error: { message: '보고 수정 반복 실패' } };
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
        const { data, error } = await bprUpdate(dup.id, patch); // 드리프트 대응
        return { data, error, duplicate: false };
    }

    const { data, error } = await bprInsert({
        blog_account_id: payload.blog_account_id,
        reporter_id: payload.reporter_id,
        post_url: payload.post_url,
        title: payload.title,
        keyword: payload.keyword ?? null,
        report_type: payload.report_type,
        round: payload.round ?? null,
        blog_kind: payload.blog_kind ?? null,
        published_at: payload.report_type === 'publish' ? new Date().toISOString() : null,
    });
    return { data, error, duplicate: false };
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
    if (!clientId) {
        // 기자단이 '업체 등록'으로 승인받은 블로그 — 계약 관리 미연동이라 계약 잔여/외주비를 잡을 수 없다.
        //   대신 블로그 자체 진행 건수만 +1(remain_count -1). 외주비는 계약 관리 통합 시 별도 등록.
        //   판정과 차감을 모두 RPC 안에서 처리한다 — 단일 UPDATE라 동시 승인에도 카운트가 유실되지 않고,
        //   '기자단 등록 업체' 정의가 SQL 한 곳에만 있어 앱 판정과 갈라지지 않는다.
        const { data, error } = await supabase.rpc('count_blog_progress', {
            p_blog_account_id: report.blog_account_id,
        });
        const res = data as { matched?: boolean; counted?: boolean } | null;
        if (!error && res?.matched) {
            // counted=false → 계약 건수 미입력이거나 잔여가 이미 0(소진). 외주비는 어느 쪽이든 잡지 않는다.
            return { processed: !!res.counted, outUnit: 0, err: null, mode: 'blog' as BookMode };
        }
        // 그 외 계약 미연동 블로그(시트 붙여넣기 등록 등)는 기존 동작 유지 — 카운트 없음.
        //   비-브랜드(out_amount 지정)는 계약이 없어도 그 금액을 외주비로 보고(정산엔 보고행이 직접 반영됨).
        //   브랜드는 회사명 규칙이라 계약(회사)이 없으면 0으로 폴백(주입값 무시).
        //   RPC 오류 시에도 기존 동작으로 떨어지되 오류는 표면화한다(조용한 오계상 방지).
        const noClientOut = isBrandKind(report.blog_kind) ? 0 : report.out_amount ?? 0;
        return {
            processed: false,
            outUnit: noClientOut,
            err: (error ?? null) as { message: string } | null,
            mode: 'none' as BookMode,
        };
    }
    let company = '';
    const { data: cl } = await supabase.from('clients').select('company').eq('id', clientId);
    company = ((cl ?? [])[0] as { company?: string } | undefined)?.company ?? '';
    const outUnit = reportOutUnit(report, company);
    const { data: contracts, error: cErr } = await getClientContracts(clientId);
    if (cErr) return { processed: false, outUnit, err: cErr, mode: 'none' as BookMode };
    const sub = (ct: { subtype: string }) => ct.subtype.replace(/^상위노출 보장형 · /, '');
    const blogs = contracts.filter((ct) => ct.category === '블로그');
    const target =
        (acc?.name ? blogs.find((ct) => (ct.blog_name || '') === acc.name) : undefined) ||
        blogs.find((ct) => sub(ct) === '브랜드 블로그') ||
        blogs.find((ct) => sub(ct) === '블로그') ||
        (blogs.length === 1 ? blogs[0] : null);
    if (!target) return { processed: false, outUnit, err: null, mode: 'none' as BookMode };
    // 이미 이 보고로 계상된 로그가 있으면(안전판) 재계상 금지.
    const key = `rpt-${report.id}`;
    if ((target.weekly_logs ?? []).some((l) => l.week === key))
        return { processed: true, outUnit, err: null, mode: 'contract' as BookMode };
    // 진행 이력에 표기할 기자단 이름.
    let reporterName: string | null = null;
    if (report.reporter_id) {
        const { data: rp } = await supabase.from('profiles').select('name').eq('id', report.reporter_id);
        reporterName = ((rp ?? [])[0] as { name?: string | null } | undefined)?.name ?? null;
    }
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
        reporter: reporterName,
        week: key,
    };
    const { error: uErr } = await updateClientContract(target.id, {
        remain_count: nextRemain,
        unit_outsource: outUnit,
        weekly_logs: [...(target.weekly_logs ?? []), log],
    });
    return { processed: !uErr, outUnit, err: uErr ?? null, mode: 'contract' as BookMode };
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
    if (claimErr) return { error: claimErr, processed: false, outUnit: 0, mode: 'none' as BookMode };
    if (!claimed || claimed.length === 0)
        return { error: null, processed: false, outUnit: 0, mode: 'none' as BookMode }; // 이미 승인됨
    // 아래 계약 계상은 방금 저장한 외주비 금액을 반영해야 하므로 병합본으로 넘긴다.
    const bookReport: BlogPostReport = { ...report, out_amount: outAmount ?? report.out_amount };

    // 2) 추적글 생성(같은 URL 이미 추적 중이면 재사용) → blog_post_id 연결.
    //    개별 글 주소(글 번호 포함)일 때만 만든다. 저장(빈 URL)이나 블로그 대문 주소(글 번호 없음)는
    //    순위 트래커가 최신글로 오배정되므로 추적글을 만들지 않는다(측정대기·오배정 원천 차단).
    const base = (report.post_url || '').split('?')[0];
    const hasArticle = /\/\d{6,}/.test(base); // blog.naver.com/아이디/224xxxxx 형태만
    let postId: string | null = null;
    if (hasArticle) {
        const { data: existing } = await supabase
            .from('blog_posts')
            .select('id,post_url')
            .eq('blog_account_id', report.blog_account_id);
        const hit = (existing ?? []).find((p) => (p.post_url || '').split('?')[0] === base);
        if (hit) postId = (hit as { id: string }).id;
    }
    if (hasArticle && !postId) {
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
    const { processed, outUnit, err, mode } = await bookContractCredit(bookReport);
    return { error: err, processed, outUnit, mode };
}

// 기자단 '발행' 처리 — 저장으로 보고한 글을 발행했을 때. report_type을 publish로 + published_at + 실제 글 주소.
//   계약/카운트는 승인 시 이미 1회 처리되므로 여기서는 재계상하지 않는다(중복 방지). RLS: 본인 보고만.
//   저장 보고는 링크를 안 받으므로, 발행 시점에 실제 글 주소(글 번호 포함)를 넣는다 → 그 뒤 크롤러가
//   공개된 글을 잡아 순위 추적. postUrl 미지정이면 기존 URL 유지.
export async function markPublished(reportId: string, postUrl?: string) {
    // RPC(SECURITY DEFINER)로 발행 이동. 기자단의 직접 UPDATE는 RLS상 status='rejected'만 허용돼
    //   저장(pending/confirmed)건이 0행 업데이트로 조용히 실패하던 문제를 해결(권한 상승 없이 발행 이동만).
    const { error } = await supabase.rpc('mark_report_published', {
        p_report_id: reportId,
        p_post_url: postUrl?.trim() || null,
    });
    // 마이그레이션(reporter-publish-url.sql) 실행 전이면 2-인자 RPC가 없다 → 구 1-인자로 폴백(발행 이동만).
    if (error && /PGRST202|Could not find the function|does not exist|schema cache/i.test(error.message || '')) {
        const { error: e2 } = await supabase.rpc('mark_report_published', { p_report_id: reportId });
        return { error: e2 };
    }
    return { error };
}

export type ReportEditPayload = {
    blog_account_id: string;
    post_url: string;
    keyword?: string | null;
    title: string;
    report_type: ReportType;
    round?: number | null;
};

// 재보고(기자단) — 반려된 본인 보고를 수정해 다시 대기(pending)로. type/제목 유지·수정.
export async function resubmitReport(id: string, payload: ReportEditPayload) {
    // 드리프트 대응 — round 등 새 컬럼이 없을 수 있어 bprUpdate 로 재시도.
    const { error } = await bprUpdate(id, {
        blog_account_id: payload.blog_account_id,
        post_url: payload.post_url,
        keyword: payload.keyword ?? null,
        title: payload.title,
        report_type: payload.report_type,
        round: payload.round ?? null,
        status: 'pending',
        note: null,
        reviewed_at: null,
        reviewed_by: null,
        blog_post_id: null,
    });
    return { error };
}

// 대기(pending) 보고 수정(기자단) — 검토 중인 본인 보고를 수정하되 상태는 대기 그대로 유지.
//   RLS 'bpr 기자단 대기수정'(docs/reporter-report-edit.sql) 필요 — 없으면 0행(조용히 미반영).
//   status/reviewed_* 는 건드리지 않는다(대기 유지). blog_post_id 도 그대로(대기라 애초에 null).
export async function updatePendingReport(id: string, payload: ReportEditPayload) {
    const { data, error } = await bprUpdate(id, {
        blog_account_id: payload.blog_account_id,
        post_url: payload.post_url,
        keyword: payload.keyword ?? null,
        title: payload.title,
        report_type: payload.report_type,
        round: payload.round ?? null,
    });
    if (error) return { error };
    // 0행 반영 = RLS 정책(reporter-report-edit.sql) 미적용이거나 대기 상태가 아님 → 조용한 실패 방지.
    if (!data || data.length === 0)
        return {
            error: { message: '수정이 반영되지 않았습니다 · 검토 중 보고만 수정 가능(회사 승인 SQL 미실행 여부 확인)' },
        };
    return { error: null };
}

// 반려(회사) — 대기(pending) 건만. 이미 승인된 건을 반려로 되돌릴 수 없게 막는다.
//   승인 → 반려 → 재보고 → 재승인 경로가 열리면 카운트가 두 번 잡히기 때문(계약 모드는 rpt- week키로
//   막히지만 블로그 진행 카운트는 멱등 키가 없어 그대로 -2 된다). UI에도 그런 경로는 없지만 원천 차단.
export async function rejectReport(id: string, reviewerProfileId: string | null, note?: string) {
    const { error } = await supabase
        .from('blog_post_reports')
        .update({
            status: 'rejected',
            reviewed_at: new Date().toISOString(),
            reviewed_by: reviewerProfileId,
            note: note ?? null,
        })
        .eq('id', id)
        .eq('status', 'pending');
    return { error };
}
