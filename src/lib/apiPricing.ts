// 정확 비용 계산.
// 토큰 '개수'는 OpenAI usage 실측값을 그대로 쓰고, 여기 '단가'만 실제 요금으로 맞추면 된다.
// 비용은 '읽을 때' usage 원본 × 현재 단가로 계산하므로, 아래 값을 고치면 과거 기록까지 전부 자동 재계산된다.

export const USD_TO_KRW = 1500;

// ── 토큰 단가 (USD per 1,000,000 tokens) ──────────────────────────────
// ⚠️ OpenAI platform 가격표의 실제 gpt-5.5 요금으로 맞추세요.
// cachedInput = 캐시된 입력 토큰 단가(보통 input 의 ~1/10). output 에는 추론(reasoning) 토큰 포함.
// output=42 : 사용자 실측 보정(2026-07-15) — 저화질 배너 4장 실제 청구 $0.16(=잔액 91.54→91.38).
//   이미지 토큰(272×$40/M) 확정 후 역산 → gpt-5.5 출력 ≈ $42/M(기존 $10은 4배 과소계상이었음).
export const TOKEN_RATES_USD_PER_M: Record<
    string,
    { input: number; cachedInput: number; output: number }
> = {
    'gpt-5.5': { cachedInput: 0.125, input: 1.25, output: 42 },
};
const DEFAULT_MODEL_KEY = 'gpt-5.5';

// ── 이미지 1장 단가 (USD) : provider → size → quality ──────────────────
// ⚠️ 실제 image_generation 요금으로 맞추세요.
// square medium = $0.04 : 사용자 실측(2장 $0.08, OpenAI Usage 대시보드)으로 보정됨(2026-06-22).
// bottom 은 면적비(약 1.5배)로 추정, low ≈ medium 의 약 1/4·high ≈ 약 4배(대략치).
export const IMAGE_PRICE_USD: Record<string, Record<string, Record<string, number>>> = {
    openai: {
        bottom: { high: 0.24, low: 0.015, medium: 0.06 }, // 1536 x 1024
        square: { high: 0.16, low: 0.01, medium: 0.04 }, // 1024 x 1024 (실측 보정)
    },
    gemini: {
        bottom: { high: 0.12, low: 0.03, medium: 0.06 },
        square: { high: 0.08, low: 0.02, medium: 0.04 },
    },
};

// ── OpenAI gpt-image: 이미지 output 토큰(결정론적) → 실제 청구 = 토큰 × $40/M ────────
//   gpt-image 는 응답 usage 에 이미지 토큰이 안 담긴다(Responses API). 대신 크기·화질별 토큰이 고정이라
//   토큰 × 이미지 output 단가($40/M)로 '센트 단위 정확'하게 산출한다. (OpenAI 공식 토큰표·단가, 2026)
export const IMAGE_OUTPUT_RATE_USD_PER_M = 40;
export const IMAGE_OUTPUT_TOKENS: Record<string, Record<string, number>> = {
    square: { low: 272, medium: 1056, high: 4160 }, // 1024 x 1024 → $0.0109 / $0.0422 / $0.1664
    bottom: { low: 400, medium: 1568, high: 6208 }, // 1536 x 1024 → $0.0160 / $0.0627 / $0.2483
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

// 이미지 1장 단가 조회. OpenAI=결정론적 토큰 × $40/M(센트 정확). 그 외(gemini 등)=장당 정액표.
export function imagePriceUsd(
    provider: string | null | undefined,
    size: string | null | undefined,
    quality: string | null | undefined,
): number {
    // OpenAI gpt-image — 크기·화질별 이미지 output 토큰 × $40/M.
    if (!provider || provider === 'openai') {
        const bySize = IMAGE_OUTPUT_TOKENS[size || 'square'] || IMAGE_OUTPUT_TOKENS.square;
        const qk = quality && bySize[quality] != null ? quality : 'medium';
        return ((bySize[qk] ?? 0) * IMAGE_OUTPUT_RATE_USD_PER_M) / 1_000_000;
    }
    // 그 외 provider(예: gemini/imagen) — 기존 장당 정액표.
    const byProvider = IMAGE_PRICE_USD[provider] || IMAGE_PRICE_USD.openai;
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
