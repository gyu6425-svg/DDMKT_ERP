import type { BannerForm, BannerSize } from '../routes/BannerGeneratorPage';

export type GenerateAiCardImageInput = {
    backgroundOnly?: boolean;
    bannerSize: BannerSize;
    baseCompositionDataUrl?: string;
    brandCorner?: string;
    brandText?: string;
    categoryDirective?: string;
    campaignStyleReferenceImageDataUrls?: string[];
    form: BannerForm;
    imageDataUrls?: string[];
    imageQuality?: 'low' | 'medium' | 'high';
    logoDataUrl?: string;
    provider: 'gemini' | 'openai';
    rawText: string;
    referenceLibraryImageDataUrls?: string[];
    seriesStyleReferenceImageDataUrls?: string[];
    signal?: AbortSignal;
    skipServerLogoOverlay?: boolean;
    styleDirective?: string;
    templateDirection?: string;
    templateName?: string;
};

export type TokenUsage = {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
};

export type GenerateAiCardImageResult = {
    imageDataUrl: string;
    prompt: string;
    usage?: TokenUsage | null;
};

function getGenerateCardImageUrl() {
    // 개발 모드에선 Vite 프록시(큰 응답에서 ECONNRESET 발생)를 우회해 로컬 API 서버를 직접 호출.
    // 프로덕션(Cloudflare)에선 같은 출처의 /api 함수로.
    if (import.meta.env.DEV) {
        return 'http://127.0.0.1:8787/api/generate-card-image';
    }

    return '/api/generate-card-image';
}

export async function generateAiCardImage({
    backgroundOnly,
    bannerSize,
    baseCompositionDataUrl,
    brandCorner,
    brandText,
    categoryDirective,
    campaignStyleReferenceImageDataUrls,
    form,
    imageDataUrls,
    imageQuality,
    logoDataUrl,
    provider,
    rawText,
    referenceLibraryImageDataUrls,
    seriesStyleReferenceImageDataUrls,
    signal,
    skipServerLogoOverlay,
    styleDirective,
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
                backgroundOnly,
                bannerSize,
                baseCompositionDataUrl,
                brandCorner,
                brandText,
                categoryDirective,
                campaignStyleReferenceImageDataUrls,
                form,
                imageDataUrls,
                imageQuality,
                logoDataUrl,
                provider,
                rawText,
                referenceLibraryImageDataUrls,
                seriesStyleReferenceImageDataUrls,
                skipServerLogoOverlay,
                styleDirective,
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
