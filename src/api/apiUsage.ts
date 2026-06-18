import { estimateCostUsd } from '../lib/apiPricing';
import { hasSupabaseConfig, supabase } from '../lib/supabase';

export type ApiUsageStatus = 'success' | 'error';

export type ApiUsageRecord = {
    id: string;
    created_at: string;
    user_email: string | null;
    provider: string;
    model: string | null;
    banner_size: string | null;
    status: ApiUsageStatus;
    elapsed_ms: number | null;
    error_message: string | null;
    total_tokens: number | null;
    cost_usd: number | null;
};

export type ApiUsageInput = {
    user_email?: string | null;
    provider: string;
    model?: string | null;
    banner_size?: string | null;
    status: ApiUsageStatus;
    elapsed_ms?: number | null;
    error_message?: string | null;
    total_tokens?: number | null;
    cost_usd?: number | null;
};

export type ApiUsageStats = {
    total: number;
    success: number;
    error: number;
    today: number;
    openai: number;
    gemini: number;
    estimatedCostUsd: number;
};

const COST_COMBOS: Array<{ provider: string; size: string }> = [
    { provider: 'openai', size: 'square' },
    { provider: 'openai', size: 'bottom' },
    { provider: 'gemini', size: 'square' },
    { provider: 'gemini', size: 'bottom' },
];

// 생성 1건의 사용량을 기록. 실패해도 생성 흐름에 영향을 주지 않도록 조용히 무시한다.
export async function logApiUsage(input: ApiUsageInput) {
    if (!hasSupabaseConfig) {
        return;
    }

    try {
        await supabase.from('api_usage').insert({
            banner_size: input.banner_size ?? null,
            cost_usd: input.cost_usd ?? null,
            elapsed_ms: input.elapsed_ms ?? null,
            error_message: input.error_message ?? null,
            model: input.model ?? null,
            provider: input.provider,
            status: input.status,
            total_tokens: input.total_tokens ?? null,
            user_email: input.user_email ?? null,
        });
    } catch {
        // 사용량 로깅 실패는 무시.
    }
}

export async function getApiUsageRecent(limit = 100) {
    const { data, error } = await supabase
        .from('api_usage')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)
        .returns<ApiUsageRecord[]>();

    return { data: data ?? [], error };
}

export async function getApiUsageStats() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayIso = startOfToday.toISOString();

    const [totalResult, successResult, errorResult, todayResult, openaiResult, geminiResult] =
        await Promise.all([
            supabase.from('api_usage').select('id', { count: 'exact', head: true }),
            supabase
                .from('api_usage')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'success'),
            supabase
                .from('api_usage')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'error'),
            supabase
                .from('api_usage')
                .select('id', { count: 'exact', head: true })
                .gte('created_at', startOfTodayIso),
            supabase
                .from('api_usage')
                .select('id', { count: 'exact', head: true })
                .eq('provider', 'openai'),
            supabase
                .from('api_usage')
                .select('id', { count: 'exact', head: true })
                .eq('provider', 'gemini'),
        ]);

    // 성공 건만 (제공자 × 사이즈)별로 세어 단가표와 곱해 예상 비용을 계산.
    const costResults = await Promise.all(
        COST_COMBOS.map((combo) =>
            supabase
                .from('api_usage')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'success')
                .eq('provider', combo.provider)
                .eq('banner_size', combo.size),
        ),
    );

    const estimatedCostUsd = COST_COMBOS.reduce(
        (sum, combo, index) =>
            sum + (costResults[index].count ?? 0) * estimateCostUsd(combo.provider, combo.size),
        0,
    );

    const error =
        totalResult.error ||
        successResult.error ||
        errorResult.error ||
        todayResult.error ||
        openaiResult.error ||
        geminiResult.error ||
        costResults.find((result) => result.error)?.error ||
        null;

    const data: ApiUsageStats = {
        error: errorResult.count ?? 0,
        estimatedCostUsd,
        gemini: geminiResult.count ?? 0,
        openai: openaiResult.count ?? 0,
        success: successResult.count ?? 0,
        today: todayResult.count ?? 0,
        total: totalResult.count ?? 0,
    };

    return { data, error };
}
