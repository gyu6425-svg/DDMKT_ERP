import { hasSupabaseConfig, supabase } from '../lib/supabase';

// 생성한 블로그 글 기록(공유 워크스페이스). 작업자·카테고리·시간과 함께 저장.
// 이미지와 달리 텍스트라 가벼우므로 본문(content)을 그대로 컬럼에 저장한다.
export type BlogOutput = {
    id: string;
    created_at: string;
    operator_name: string | null;
    category: string | null;
    category_label: string | null;
    title: string | null;
    content: string | null;
    topic: string | null;
    tone: string | null;
    length: string | null;
};

export type BlogOutputInsert = {
    operator_name?: string | null;
    category?: string | null;
    category_label?: string | null;
    title?: string | null;
    content: string;
    topic?: string | null;
    tone?: string | null;
    length?: string | null;
};

// 생성 직후 1건 저장. 실패해도 생성 흐름엔 영향 주지 않도록 조용히 무시.
export async function saveBlogOutput(input: BlogOutputInsert) {
    if (!hasSupabaseConfig) {
        return { error: null };
    }
    try {
        const { error } = await supabase.from('blog_outputs').insert({
            category: input.category ?? null,
            category_label: input.category_label ?? null,
            content: input.content,
            length: input.length ?? null,
            operator_name: input.operator_name ?? null,
            title: input.title ?? null,
            tone: input.tone ?? null,
            topic: input.topic ?? null,
        });
        return { error };
    } catch (error) {
        return { error };
    }
}

export async function getBlogOutputs(options?: {
    category?: string;
    operator?: string;
    limit?: number;
}) {
    if (!hasSupabaseConfig) {
        return { data: [] as BlogOutput[], error: null };
    }

    let query = supabase
        .from('blog_outputs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(options?.limit ?? 120);

    if (options?.category) {
        query = query.eq('category', options.category);
    }
    if (options?.operator) {
        query = query.eq('operator_name', options.operator);
    }

    const { data, error } = await query.returns<BlogOutput[]>();
    return { data: data ?? [], error };
}

export async function deleteBlogOutput(id: string) {
    if (!hasSupabaseConfig) {
        return { error: null };
    }
    const { error } = await supabase.from('blog_outputs').delete().eq('id', id);
    return { error };
}

// 작업자 필터 옵션 — 최근 기록에서 distinct 작업자 이름.
export async function getBlogOperators(limit = 300) {
    if (!hasSupabaseConfig) {
        return { operators: [] as string[], error: null };
    }
    const { data, error } = await supabase
        .from('blog_outputs')
        .select('operator_name')
        .order('created_at', { ascending: false })
        .limit(limit)
        .returns<Array<{ operator_name: string | null }>>();

    const operators = Array.from(
        new Set((data ?? []).map((row) => (row.operator_name || '').trim()).filter(Boolean)),
    );
    return { operators, error };
}

// "제목: ..." 첫 줄에서 제목 파싱(없으면 빈 문자열).
export function parseBlogTitle(text: string): string {
    const match = text.match(/^\s*제목\s*[:：]\s*(.+)$/m);
    return match ? match[1].trim() : '';
}
