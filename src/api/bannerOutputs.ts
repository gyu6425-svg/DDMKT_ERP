import { hasSupabaseConfig, supabase } from '../lib/supabase';

// 생성한 배너 작업물 기록(공유 워크스페이스). 작업자·카테고리·시간과 함께 저장.
// thumb_data_url = 갤러리용 작은 미리보기, image_data_url = 원본(다운로드용).
export type BannerOutput = {
    id: string;
    created_at: string;
    operator_name: string | null;
    category: string | null; // 카테고리 id ('' = 미지정)
    category_label: string | null; // 한글 라벨
    banner_size: string | null;
    thumb_data_url: string | null;
};

export type BannerOutputInsert = {
    operator_name?: string | null;
    category?: string | null;
    category_label?: string | null;
    banner_size?: string | null;
    thumb_data_url: string;
    image_data_url: string;
};

// 생성 직후 1건 저장. 실패해도 생성 흐름엔 영향 주지 않도록 조용히 무시.
export async function saveBannerOutput(input: BannerOutputInsert) {
    if (!hasSupabaseConfig) {
        return { error: null };
    }
    try {
        const { error } = await supabase.from('banner_outputs').insert({
            banner_size: input.banner_size ?? null,
            category: input.category ?? null,
            category_label: input.category_label ?? null,
            image_data_url: input.image_data_url,
            operator_name: input.operator_name ?? null,
            thumb_data_url: input.thumb_data_url,
        });
        return { error };
    } catch (error) {
        return { error };
    }
}

// 갤러리 목록 — 원본 이미지(image_data_url)는 무거우므로 제외하고 썸네일만 가져온다.
export async function getBannerOutputs(options?: {
    category?: string; // '' 또는 미지정이면 전체
    operator?: string;
    limit?: number;
}) {
    if (!hasSupabaseConfig) {
        return { data: [] as BannerOutput[], error: null };
    }

    let query = supabase
        .from('banner_outputs')
        .select(
            'id, created_at, operator_name, category, category_label, banner_size, thumb_data_url',
        )
        .order('created_at', { ascending: false })
        .limit(options?.limit ?? 120);

    if (options?.category) {
        query = query.eq('category', options.category);
    }
    if (options?.operator) {
        query = query.eq('operator_name', options.operator);
    }

    const { data, error } = await query.returns<BannerOutput[]>();
    return { data: data ?? [], error };
}

// 다운로드용 — 특정 기록의 원본 이미지 1건만 조회.
export async function getBannerOutputImage(id: string) {
    if (!hasSupabaseConfig) {
        return { dataUrl: '', error: null };
    }
    const { data, error } = await supabase
        .from('banner_outputs')
        .select('image_data_url')
        .eq('id', id)
        .maybeSingle<{ image_data_url: string | null }>();
    return { dataUrl: data?.image_data_url ?? '', error };
}

export async function deleteBannerOutput(id: string) {
    if (!hasSupabaseConfig) {
        return { error: null };
    }
    const { error } = await supabase.from('banner_outputs').delete().eq('id', id);
    return { error };
}

// 작업자 필터 옵션 — 최근 기록에서 distinct 작업자 이름.
export async function getBannerOperators(limit = 300) {
    if (!hasSupabaseConfig) {
        return { operators: [] as string[], error: null };
    }
    const { data, error } = await supabase
        .from('banner_outputs')
        .select('operator_name')
        .order('created_at', { ascending: false })
        .limit(limit)
        .returns<Array<{ operator_name: string | null }>>();

    const operators = Array.from(
        new Set((data ?? []).map((row) => (row.operator_name || '').trim()).filter(Boolean)),
    );
    return { operators, error };
}
