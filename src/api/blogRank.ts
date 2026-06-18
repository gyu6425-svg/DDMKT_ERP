import { supabase } from '../lib/supabase';

// ── 타입 ────────────────────────────────────────────────
export type BlogMeasurement = {
    date: string; // YYYY-MM-DD
    ti: number; // 통합검색 순위
    bl: number; // 블로그탭 순위
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
