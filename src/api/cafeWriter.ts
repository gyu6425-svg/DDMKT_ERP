import type { CafeContent } from '../components/cafe/cafeContent';

// 카페 원고 자동생성 클라이언트 — /api/generate-cafe 호출. 반환 content = Partial<CafeContent>.

export type CafeTokenUsage = {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    [key: string]: unknown;
};

export type GenerateCafeInput = {
    keyword: string;
    region?: string;
    brand?: string;
    branch?: string;
    phone?: string;
    business?: string;
    signal?: AbortSignal;
};

export type GenerateCafeResult = {
    content: Partial<CafeContent>;
    prompt: string;
    usage?: CafeTokenUsage | null;
};

function getUrl() {
    return import.meta.env.DEV ? 'http://127.0.0.1:8787/api/generate-cafe' : '/api/generate-cafe';
}

// 공통 POST — mode/content 에 따라 카드 원고 또는 후기 본문 생성.
async function postCafe(
    body: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 120000);
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
        const response = await fetch(getUrl(), {
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            signal: controller.signal,
        });
        const responseText = await response.text();
        let result: Record<string, unknown> & { message?: string } = {};
        if (responseText) {
            try {
                result = JSON.parse(responseText);
            } catch {
                throw new Error(
                    response.ok
                        ? '원고 응답을 해석하지 못했습니다.'
                        : '원고 API 응답을 해석하지 못했습니다. 로컬 API 서버(npm run api:dev)가 실행 중인지 확인하세요.',
                );
            }
        }
        if (!response.ok) throw new Error(result?.message || '원고 생성에 실패했습니다.');
        return result;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('원고 생성이 중단되었습니다(최대 2분 초과 또는 사용자 취소).', { cause: error });
        }
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

export async function generateCafe(input: GenerateCafeInput): Promise<GenerateCafeResult> {
    const result = await postCafe(
        {
            brand: input.brand,
            branch: input.branch,
            business: input.business,
            keyword: input.keyword,
            phone: input.phone,
            region: input.region,
        },
        input.signal,
    );
    if (!result.content) throw new Error('생성된 원고가 없습니다.');
    return result as GenerateCafeResult;
}

export type GenerateCafeReviewResult = { title: string; reviewBody: string; usage?: CafeTokenUsage | null };

// 후기성 카페 본문 생성 — 현재 카드 콘텐츠(content)를 소재로 후기/경험 형식 글 + 「사진 N」 마커.
export type CafeReviewTone = 'review' | 'info' | 'story' | 'talk' | 'notice';

export async function generateCafeReview(
    input: GenerateCafeInput & { content: Partial<CafeContent>; tone?: CafeReviewTone; count?: number },
): Promise<GenerateCafeReviewResult> {
    const result = await postCafe(
        {
            brand: input.brand,
            branch: input.branch,
            business: input.business,
            content: input.content,
            count: input.count,
            keyword: input.keyword,
            mode: 'review',
            phone: input.phone,
            region: input.region,
            tone: input.tone || 'review',
        },
        input.signal,
    );
    if (result.reviewBody == null) throw new Error('생성된 본문이 없습니다.');
    return result as GenerateCafeReviewResult;
}
