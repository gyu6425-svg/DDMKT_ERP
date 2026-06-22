// 정확 비용 계산.
// 토큰 '개수'는 OpenAI usage 실측값을 그대로 쓰고, 여기 '단가'만 실제 요금으로 맞추면 된다.
// 비용은 '읽을 때' usage 원본 × 현재 단가로 계산하므로, 아래 값을 고치면 과거 기록까지 전부 자동 재계산된다.

export const USD_TO_KRW = 1500;

// ── 토큰 단가 (USD per 1,000,000 tokens) ──────────────────────────────
// ⚠️ OpenAI platform 가격표의 실제 gpt-5.5 요금으로 맞추세요.
// cachedInput = 캐시된 입력 토큰 단가(보통 input 의 ~1/10). output 에는 추론(reasoning) 토큰 포함.
export const TOKEN_RATES_USD_PER_M: Record<
    string,
    { input: number; cachedInput: number; output: number }
> = {
    'gpt-5.5': { cachedInput: 0.125, input: 1.25, output: 10 },
};
const DEFAULT_MODEL_KEY = 'gpt-5.5';

// ── 이미지 1장 단가 (USD) : provider → size → quality ──────────────────
// ⚠️ 실제 image_generation 요금으로 맞추세요. medium 은 검증됨(square $0.042 / bottom $0.063),
// low ≈ medium 의 약 1/4, high ≈ 약 4배(대략치).
export const IMAGE_PRICE_USD: Record<string, Record<string, Record<string, number>>> = {
    openai: {
        bottom: { high: 0.25, low: 0.016, medium: 0.063 }, // 1536 x 1024
        square: { high: 0.167, low: 0.011, medium: 0.042 }, // 1024 x 1024
    },
    gemini: {
        bottom: { high: 0.12, low: 0.03, medium: 0.06 },
        square: { high: 0.08, low: 0.02, medium: 0.04 },
    },
};

export type TokenUsageRaw = {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number; [key: string]: unknown };
    output_tokens_details?: { reasoning_tokens?: number; [key: string]: unknown };
    [key: string]: unknown;
};

export type TokenBreakdown = {
    input: number;
    cached: number;
    output: number;
    reasoning: number;
    total: number;
};

// usage 원본에서 토큰 유형별 개수 추출(실측값).
export function extractTokenBreakdown(usage: TokenUsageRaw | null | undefined): TokenBreakdown {
    const input = Number(usage?.input_tokens) || 0;
    const output = Number(usage?.output_tokens) || 0;
    const cached = Number(usage?.input_tokens_details?.cached_tokens) || 0;
    const reasoning = Number(usage?.output_tokens_details?.reasoning_tokens) || 0;
    const total = Number(usage?.total_tokens) || input + output;
    return { cached, input, output, reasoning, total };
}

// 텍스트 토큰 비용(캐시 입력은 할인 단가, 나머지 입력은 일반 단가, 출력은 출력 단가).
export function tokenCostUsd(
    usage: TokenUsageRaw | null | undefined,
    model: string = DEFAULT_MODEL_KEY,
): number {
    const rate = TOKEN_RATES_USD_PER_M[model] || TOKEN_RATES_USD_PER_M[DEFAULT_MODEL_KEY];
    const b = extractTokenBreakdown(usage);
    const nonCachedInput = Math.max(0, b.input - b.cached);
    return (
        (nonCachedInput / 1_000_000) * rate.input +
        (b.cached / 1_000_000) * rate.cachedInput +
        (b.output / 1_000_000) * rate.output
    );
}

// 이미지 1장 단가 조회(provider/size/quality 매칭, 없으면 기본값).
export function imagePriceUsd(
    provider: string | null | undefined,
    size: string | null | undefined,
    quality: string | null | undefined,
): number {
    const byProvider = IMAGE_PRICE_USD[provider || 'openai'] || IMAGE_PRICE_USD.openai;
    const sizeKey = size && byProvider[size] ? size : 'square';
    const byQuality = byProvider[sizeKey];
    const qualityKey = quality && byQuality[quality] != null ? quality : 'medium';
    return byQuality[qualityKey] ?? 0;
}

export type CostInput = {
    usage_raw?: TokenUsageRaw | null;
    provider?: string | null;
    banner_size?: string | null;
    image_quality?: string | null;
    model?: string | null;
};

// 기록 1건의 정확 비용(읽을 때 계산). 이미지(=banner_size 있음)면 토큰비 + 장당 이미지비, 텍스트면 토큰비만.
export function computeRecordCostUsd(record: CostInput): number {
    const model =
        record.model && TOKEN_RATES_USD_PER_M[record.model] ? record.model : DEFAULT_MODEL_KEY;
    const isImage = Boolean(record.banner_size);
    let cost = 0;
    // Gemini 는 usage 를 안 주므로 토큰비 0(이미지 장당가만).
    if (record.provider !== 'gemini') {
        cost += tokenCostUsd(record.usage_raw ?? null, model);
    }
    if (isImage) {
        cost += imagePriceUsd(record.provider, record.banner_size, record.image_quality);
    }
    return cost;
}

export function formatUsd(value: number): string {
    return `$${value.toFixed(4)}`;
}

export function formatKrw(usdValue: number): string {
    return `₩${Math.round(usdValue * USD_TO_KRW).toLocaleString('ko-KR')}`;
}
