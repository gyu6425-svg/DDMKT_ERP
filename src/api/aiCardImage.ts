import type { BannerForm, BannerSize } from '../routes/BannerGeneratorPage';

export type GenerateAiCardImageInput = {
    bannerSize: BannerSize;
    baseCompositionDataUrl?: string;
    brandText?: string;
    campaignStyleReferenceImageDataUrls?: string[];
    form: BannerForm;
    imageDataUrls?: string[];
    logoDataUrl?: string;
    provider: 'gemini' | 'openai';
    rawText: string;
    referenceLibraryImageDataUrls?: string[];
    seriesStyleReferenceImageDataUrls?: string[];
    signal?: AbortSignal;
    skipServerLogoOverlay?: boolean;
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
    bannerSize,
    baseCompositionDataUrl,
    brandText,
    campaignStyleReferenceImageDataUrls,
    form,
    imageDataUrls,
    logoDataUrl,
    provider,
    rawText,
    referenceLibraryImageDataUrls,
    seriesStyleReferenceImageDataUrls,
    signal,
    skipServerLogoOverlay,
    templateDirection,
    templateName,
}: GenerateAiCardImageInput): Promise<GenerateAiCardImageResult> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
        controller.abort();
    }, 180000);

    // 외부(사용자 중단) 신호를 내부 컨트롤러로 전달.
    if (signal) {
        if (signal.aborted) {
            controller.abort();
        } else {
            signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
    }

    try {
        const response = await fetch(getGenerateCardImageUrl(), {
            body: JSON.stringify({
                bannerSize,
                baseCompositionDataUrl,
                brandText,
                campaignStyleReferenceImageDataUrls,
                form,
                imageDataUrls,
                logoDataUrl,
                provider,
                rawText,
                referenceLibraryImageDataUrls,
                seriesStyleReferenceImageDataUrls,
                skipServerLogoOverlay,
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
            throw new Error('AI 이미지 생성이 중단되었습니다(최대 3분 초과 또는 사용자 취소).', {
                cause: error,
            });
        }

        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}
