import { hasSupabaseConfig, supabase } from '../lib/supabase';
import type { CafeContent } from '../components/cafe/cafeContent';

// 카페 원고 생성기 저장 갤러리 — 카드 콘텐츠(JSON)·후기 본문·AI 배경 보관. docs/cafe-outputs-table.sql.

export type CafeOutput = {
    id: string;
    created_at: string;
    operator_name: string | null;
    keyword: string | null;
    region: string | null;
    title: string | null;
    content: CafeContent | null;
    review_body: string | null;
    tone: string | null;
    bg_image: string | null;
};

export type CafeOutputInsert = {
    operator_name?: string | null;
    keyword?: string | null;
    region?: string | null;
    title?: string | null;
    content: CafeContent;
    review_body?: string | null;
    tone?: string | null;
    bg_image?: string | null;
};

export async function saveCafeOutput(input: CafeOutputInsert) {
    if (!hasSupabaseConfig) return { error: null, data: null };
    try {
        const { data, error } = await supabase
            .from('cafe_outputs')
            .insert({
                bg_image: input.bg_image ?? null,
                content: input.content,
                keyword: input.keyword ?? null,
                operator_name: input.operator_name ?? null,
                region: input.region ?? null,
                review_body: input.review_body ?? null,
                title: input.title ?? null,
                tone: input.tone ?? null,
            })
            .select()
            .returns<CafeOutput[]>();
        return { data: data?.[0] ?? null, error };
    } catch (error) {
        return { data: null, error };
    }
}

export async function getCafeOutputs(limit = 30) {
    if (!hasSupabaseConfig) return { data: [] as CafeOutput[], error: null };
    try {
        const { data, error } = await supabase
            .from('cafe_outputs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit)
            .returns<CafeOutput[]>();
        return { data: data ?? [], error };
    } catch (error) {
        return { data: [] as CafeOutput[], error };
    }
}

export async function deleteCafeOutput(id: string) {
    if (!hasSupabaseConfig) return { error: null };
    try {
        const { error } = await supabase.from('cafe_outputs').delete().eq('id', id);
        return { error };
    } catch (error) {
        return { error };
    }
}
