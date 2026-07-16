import { supabase } from '../lib/supabase';

// 카페 순위 추적 — cafe_rank_posts CRUD + 카페 URL 파싱. 측정(measurements)은 PC 크롤러(cafe_rank_crawler.py)가 기록.
export type CafeMeasurement = { date: string; ti: number; ti_status: 'ok' | 'out' | 'fail' };

export type CafeRankPost = {
    id: string;
    created_at?: string;
    club_id: string | null;
    cafe_name: string | null;
    article_id: string;
    post_url: string | null;
    title: string | null;
    keyword: string | null;
    keyword_manual: string | null;
    published_date: string | null;
    excluded: boolean;
    measurements: CafeMeasurement[];
};

const RESERVED = ['ca-fe', 'cafes', 'f-e', 'gallery'];

// 카페 URL → 식별자. 구형 ArticleRead / 신형 ca-fe / 단축형(vanity) 모두 커버(크롤러 parse_cafe_url 와 1:1).
export function parseCafeUrl(url: string): { clubId: string | null; cafeName: string | null; articleId: string | null } {
    const u = url || '';
    let m = u.match(/cafe\.naver\.com\/ca-fe\/(?:web\/)?cafes\/(\d+)\/(?:web\/)?articles\/(\d+)/);
    if (m) return { clubId: m[1], cafeName: null, articleId: m[2] };
    m = u.match(/ArticleRead\.nhn\?[^"']*?clubid=(\d+)[^"']*?articleid=(\d+)/);
    if (m) return { clubId: m[1], cafeName: null, articleId: m[2] };
    m = u.match(/cafe\.naver\.com\/([A-Za-z0-9_-]+)\/(\d+)/);
    if (m && !RESERVED.includes(m[1])) return { clubId: null, cafeName: m[1], articleId: m[2] };
    return { clubId: null, cafeName: null, articleId: null };
}

export async function getCafeRankPosts() {
    const { data, error } = await supabase
        .from('cafe_rank_posts')
        .select('*')
        .eq('excluded', false)
        .order('published_date', { ascending: false, nullsFirst: false });
    return { data: (data ?? []) as CafeRankPost[], error };
}

// 등록 — (cafe_name, article_id) 유니크. 이미 있으면 keyword/title/url 갱신(measurements 보존).
export async function upsertCafeRankPost(input: {
    club_id: string | null;
    cafe_name: string | null;
    article_id: string;
    post_url: string | null;
    title: string | null;
    keyword: string | null;
    published_date: string | null;
}) {
    const { error } = await supabase
        .from('cafe_rank_posts')
        .upsert(input, { onConflict: 'cafe_name,article_id' });
    return { error };
}

// 소프트 삭제(트래커 숨김 + 측정 제외).
export async function excludeCafeRankPost(id: string) {
    const { error } = await supabase.from('cafe_rank_posts').update({ excluded: true }).eq('id', id);
    return { error };
}

// 수동 키워드 보정(있으면 크롤이 우선 사용).
export async function setCafeKeywordManual(id: string, keyword_manual: string) {
    const { error } = await supabase.from('cafe_rank_posts').update({ keyword_manual }).eq('id', id);
    return { error };
}
