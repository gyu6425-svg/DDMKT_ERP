import type { BannerForm } from '../routes/BannerGeneratorPage';

export type GenerateAiCardImageInput = {
    form: BannerForm;
    imageDataUrls?: string[];
    provider: 'gemini' | 'openai';
    rawText: string;
    seriesStyleReferenceImageDataUrls?: string[];
    templateDirection?: string;
    templateName?: string;
};

export type GenerateAiCardImageResult = {
    imageDataUrl: string;
    prompt: string;
};

function getGenerateCardImageUrl() {
    return '/api/generate-card-image';
}

export async function generateAiCardImage({
    form,
    imageDataUrls,
    provider,
    rawText,
    seriesStyleReferenceImageDataUrls,
    templateDirection,
    templateName,
}: GenerateAiCardImageInput): Promise<GenerateAiCardImageResult> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
        controller.abort();
    }, 480000);

    try {
        const response = await fetch(getGenerateCardImageUrl(), {
            body: JSON.stringify({
                form,
                imageDataUrls,
                provider,
                rawText,
                seriesStyleReferenceImageDataUrls,
                templateDirection,
                templateName,
            }),
            headers: {
                'Content-Type': 'application/json',
            },
            method: 'POST',
            signal: controller.signal,
        });
        const responseText = await response.text();
        let result: Partial<GenerateAiCardImageResult> & { message?: string } = {};

        if (responseText) {
            try {
                result = JSON.parse(responseText) as Partial<GenerateAiCardImageResult> & {
                    message?: string;
                };
            } catch {
                throw new Error(
                    response.ok
                        ? 'AI 이미지 생성 응답을 해석하지 못했습니다.'
                        : 'AI 이미지 생성 API 응답을 해석하지 못했습니다. 로컬 API 서버가 실행 중인지 확인하세요.',
                );
            }
        }

        if (!response.ok) {
            throw new Error(result?.message || 'AI 이미지 생성에 실패했습니다.');
        }

        if (!result.imageDataUrl || !result.prompt) {
            throw new Error('AI 이미지 생성 API 응답에 이미지 데이터가 없습니다.');
        }

        return result as GenerateAiCardImageResult;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('AI 이미지 생성 시간이 8분을 초과했습니다. 원고를 줄이거나 다시 시도하세요.');
        }

        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}
