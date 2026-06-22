export type GenerateBlogInput = {
    topic: string;
    industry?: string;
    audience?: string;
    tone?: 'info' | 'review' | 'promo' | 'story';
    length?: 'short' | 'medium' | 'long';
    keywords?: string;
    includeHashtags?: boolean;
    signal?: AbortSignal;
};

export type BlogTokenUsage = {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number; [key: string]: unknown };
    output_tokens_details?: { reasoning_tokens?: number; [key: string]: unknown };
    [key: string]: unknown;
};

export type GenerateBlogResult = {
    text: string;
    prompt: string;
    usage?: BlogTokenUsage | null;
};

function getGenerateBlogUrl() {
    if (import.meta.env.DEV) {
        return 'http://127.0.0.1:8787/api/generate-blog';
    }
    return '/api/generate-blog';
}

export async function generateBlog(input: GenerateBlogInput): Promise<GenerateBlogResult> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 120000);

    if (input.signal) {
        if (input.signal.aborted) {
            controller.abort();
        } else {
            input.signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
    }

    try {
        const response = await fetch(getGenerateBlogUrl(), {
            body: JSON.stringify({
                audience: input.audience,
                includeHashtags: input.includeHashtags,
                industry: input.industry,
                keywords: input.keywords,
                length: input.length,
                tone: input.tone,
                topic: input.topic,
            }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            signal: controller.signal,
        });

        const responseText = await response.text();
        let result: Partial<GenerateBlogResult> & { message?: string } = {};
        if (responseText) {
            try {
                result = JSON.parse(responseText);
            } catch {
                throw new Error(
                    response.ok
                        ? '블로그 응답을 해석하지 못했습니다.'
                        : '블로그 API 응답을 해석하지 못했습니다. 로컬 API 서버(npm run api:dev)가 실행 중인지 확인하세요.',
                );
            }
        }

        if (!response.ok) {
            throw new Error(result?.message || '블로그 생성에 실패했습니다.');
        }
        if (!result.text) {
            throw new Error('생성된 글이 없습니다.');
        }

        return result as GenerateBlogResult;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('블로그 생성이 중단되었습니다(최대 2분 초과 또는 사용자 취소).', {
                cause: error,
            });
        }
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}
