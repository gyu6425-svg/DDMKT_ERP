// 이미지 생성 1건당 "예상" 단가(USD).
// 실제 청구액은 공급자 콘솔(OpenAI/Google) 요금을 확인한 뒤 아래 값을 조정하세요.
// 아래는 quality 미지정(기본) 기준의 대략적인 추정치이며 정확한 금액이 아닙니다.

// 환율(원/USD) — 필요 시 조정.
export const USD_TO_KRW = 1500;

// provider > banner_size > 1건당 USD
// image_generation 툴(quality=medium) 기준. 검증된 실측 범위:
//   square(1024x1024) ≈ $0.034~0.042 → 0.04 채택
//   bottom(1536x1024) ≈ $0.05~0.063  → 0.06 채택
// quality를 바꾸면 실제 비용도 달라짐(low ≈ 약 1/4, high ≈ 약 4배).
export const IMAGE_PRICE_USD: Record<string, Record<string, number>> = {
    openai: {
        square: 0.04, // 1024 x 1024, quality=medium (범위 $0.034~0.042)
        bottom: 0.06, // 1536 x 1024, quality=medium (범위 $0.05~0.063)
    },
    gemini: {
        square: 0.04,
        bottom: 0.06,
    },
};

export function estimateCostUsd(provider: string, bannerSize: string | null): number {
    const providerTable = IMAGE_PRICE_USD[provider];

    if (!providerTable) {
        return 0;
    }

    const key = bannerSize && providerTable[bannerSize] != null ? bannerSize : 'square';

    return providerTable[key] ?? 0;
}

// gpt-5.5 토큰 요금(USD per 1,000,000 tokens). 실제 OpenAI 요금으로 조정하세요.
// 이미지 생성 토큰은 보통 output에 포함되어 과금됩니다.
export const TOKEN_PRICE_USD_PER_M = {
    input: 1.25,
    output: 10,
};

export type TokenUsage = {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
};

// API가 돌려준 실제 토큰 사용량으로 실제 비용(USD)을 계산.
export function computeActualCostUsd(usage: TokenUsage | null | undefined): number {
    if (!usage) {
        return 0;
    }

    const input = usage.input_tokens || 0;
    const output = usage.output_tokens || 0;

    return (
        (input / 1_000_000) * TOKEN_PRICE_USD_PER_M.input +
        (output / 1_000_000) * TOKEN_PRICE_USD_PER_M.output
    );
}

export function formatUsd(value: number): string {
    return `$${value.toFixed(3)}`;
}

export function formatKrw(usdValue: number): string {
    return `₩${Math.round(usdValue * USD_TO_KRW).toLocaleString('ko-KR')}`;
}
