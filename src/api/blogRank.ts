import { supabase } from '../lib/supabase';

// ── 타입 ────────────────────────────────────────────────
export type BlogMeasurement = {
    date: string; // YYYY-MM-DD
    ti: number; // 통합검색 순위
    bl: number; // 블로그탭 순위
};

// 웹사이트(통합검색 '웹사이트' 섹션) 순위 — 회사 단위 측정값.
// status: ok=노출/측정성공, out=권외, fail=API/네트워크 실패, skip=url·키워드 미설정
export type WebMeasurement = {
    date: string; // YYYY-MM-DD
    we: number; // 웹사이트 섹션 순위 (out/fail/skip 이면 99)
    status: 'ok' | 'out' | 'fail' | 'skip';
};

export type BlogAccount = {
    id: string;
    created_at: string;
    name: string;
    manager: string | null;
    blog_url: string;
    blog_id: string | null;
    goal_count: number | null;
    remain_count: number | null;
    weekly: string | null;
    note: string | null;
    is_active: boolean;
    client_id: string | null;
    // 웹사이트 순위 추적 (회사 단위). 없는 업체는 NULL = "해당없음".
    website_url: string | null; // 호스트만 저장(예: momo-cleaning.com)
    rep_keyword: string | null; // 대표키워드 1개
    // website_measurements 는 크롤러(service_role)만 patch 한다.
    // 프론트의 insert/update payload 에는 절대 포함하지 말 것(optional 인 이유).
    website_measurements?: WebMeasurement[];
};

export type BlogPost = {
    id: string;
    created_at: string;
    blog_account_id: string;
    post_url: string | null;
    title: string | null;
    keyword: string | null;
    published_date: string | null;
    first_seen_at: string | null;
    measurements: BlogMeasurement[];
};

// URL에서 네이버 블로그 아이디 추출 (https://blog.naver.com/puleenbe → puleenbe)
export function extractBlogId(url: string): string {
    const match = url.match(/blog\.naver\.com\/([^/?#]+)/i);
    return match ? match[1] : '';
}

// ── 관리 블로그 ─────────────────────────────────────────
export async function getBlogAccounts() {
    const { data, error } = await supabase
        .from('blog_accounts')
        .select('*')
        .order('created_at', { ascending: true })
        .returns<BlogAccount[]>();

    return { data: data ?? [], error };
}

export async function insertBlogAccounts(payloads: Array<Partial<BlogAccount>>) {
    const { data, error } = await supabase
        .from('blog_accounts')
        .insert(payloads)
        .select()
        .returns<BlogAccount[]>();

    return { data: data ?? [], error };
}

export async function updateBlogAccount(id: string, payload: Partial<BlogAccount>) {
    const { data, error } = await supabase
        .from('blog_accounts')
        .update(payload)
        .eq('id', id)
        .select()
        .returns<BlogAccount[]>();

    return { data: data ?? [], error };
}

export async function deleteBlogAccount(id: string) {
    const { error } = await supabase.from('blog_accounts').delete().eq('id', id);
    return { error };
}

// ── 추적 글 ─────────────────────────────────────────────
export async function getBlogPosts() {
    const { data, error } = await supabase
        .from('blog_posts')
        .select('*')
        .order('published_date', { ascending: false })
        .returns<BlogPost[]>();

    return { data: data ?? [], error };
}
