import { supabase } from '../lib/supabase';

// 기자단 글 보고 — 기자단이 본인 담당 블로그 글 URL을 보고(insert), 내부가 확인 시 추적글(blog_posts) 생성.
export type BlogPostReport = {
    id: string;
    blog_account_id: string;
    reporter_id: string | null;
    post_url: string;
    title: string | null;
    keyword: string | null;
    status: 'pending' | 'confirmed' | 'rejected';
    note: string | null;
    created_at: string;
    reviewed_at: string | null;
    reviewed_by: string | null;
    blog_post_id: string | null;
};

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
export async function getReports(status?: 'pending' | 'confirmed' | 'rejected') {
    let query = supabase.from('blog_post_reports').select('*').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query.returns<BlogPostReport[]>();
    return { data: data ?? [], error };
}

// 확인(내부) → 추적글 생성 + 보고 confirmed. 크롤러가 이후 순위를 측정한다.
export async function confirmReport(report: BlogPostReport, reviewerProfileId: string | null) {
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
    const { error } = await supabase
        .from('blog_post_reports')
        .update({
            status: 'confirmed',
            reviewed_at: new Date().toISOString(),
            reviewed_by: reviewerProfileId,
            blog_post_id: (post as { id?: string } | null)?.id ?? null,
        })
        .eq('id', report.id);
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
