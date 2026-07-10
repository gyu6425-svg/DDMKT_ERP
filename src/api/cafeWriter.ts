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

function getEditUrl() {
    return import.meta.env.DEV ? 'http://127.0.0.1:8787/api/generate-cafe-edit' : '/api/generate-cafe-edit';
}

// 원본 이미지 글자 교체(실험) — 업로드한 완성 카드 이미지에서 텍스트만 Gemini로 교체.
export async function editCafeImage(input: {
    image: string;
    region?: string;
    keyword?: string;
    phone?: string;
    services?: string;
    signal?: AbortSignal;
}): Promise<string> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 120000);
    if (input.signal) {
        if (input.signal.aborted) controller.abort();
        else input.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
        const res = await fetch(getEditUrl(), {
            body: JSON.stringify({
                image: input.image,
                keyword: input.keyword,
                phone: input.phone,
                region: input.region,
                services: input.services,
            }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            signal: controller.signal,
        });
        const text = await res.text();
        let data: { imageDataUrl?: string; message?: string } = {};
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                throw new Error('편집 응답을 해석하지 못했습니다(로컬은 api:dev 실행 확인).');
            }
        }
        if (!res.ok) throw new Error(data.message || '이미지 편집에 실패했습니다.');
        if (!data.imageDataUrl) throw new Error('편집된 이미지가 없습니다.');
        return data.imageDataUrl;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('이미지 편집이 중단되었습니다(최대 2분 초과 또는 취소).', { cause: error });
        }
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
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

export type GenerateCafeReviewResult = { title: string; reviewBody: string; topics?: string[]; usage?: CafeTokenUsage | null };

// GPT 카드 이미지 1장 생성 — 지역/제목/전화/서비스 + 참고사진(refs). 레퍼런스 무드로 렌더.
export async function generateCafeCard(input: {
    region?: string;
    topic?: string;
    phone?: string;
    services?: string;
    refs?: string[];
    mode?: 'fixed';
    signal?: AbortSignal;
}): Promise<string> {
    const url = import.meta.env.DEV ? 'http://127.0.0.1:8787/api/generate-cafe-card' : '/api/generate-cafe-card';
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 240000); // 이미지 생성은 오래 걸림
    if (input.signal) {
        if (input.signal.aborted) controller.abort();
        else input.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
        const res = await fetch(url, {
            body: JSON.stringify({
                mode: input.mode,
                phone: input.phone,
                refs: input.refs,
                region: input.region,
                services: input.services,
                topic: input.topic,
            }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            signal: controller.signal,
        });
        const text = await res.text();
        let data: { imageDataUrl?: string; message?: string } = {};
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                throw new Error('카드 응답을 해석하지 못했습니다(로컬은 api:dev 실행 확인).');
            }
        }
        if (!res.ok) throw new Error(data.message || '카드 생성에 실패했습니다.');
        if (!data.imageDataUrl) throw new Error('생성된 카드가 없습니다.');
        return data.imageDataUrl;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('카드 생성이 중단되었습니다(최대 4분 초과 또는 취소).', { cause: error });
        }
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

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
