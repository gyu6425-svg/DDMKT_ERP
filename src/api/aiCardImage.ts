import type { BannerForm, BannerSize } from '../routes/BannerGeneratorPage';

export type GenerateAiCardImageInput = {
    bannerSize: BannerSize;
    brandText?: string;
    campaignStyleReferenceImageDataUrls?: string[];
    form: BannerForm;
    imageDataUrls?: string[];
    logoDataUrl?: string;
    provider: 'gemini' | 'openai';
    rawText: string;
    referenceLibraryImageDataUrls?: string[];
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
    bannerSize,
    brandText,
    campaignStyleReferenceImageDataUrls,
    form,
    imageDataUrls,
    logoDataUrl,
    provider,
    rawText,
    referenceLibraryImageDataUrls,
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
                bannerSize,
                brandText,
                campaignStyleReferenceImageDataUrls,
                form,
                imageDataUrls,
                logoDataUrl,
                provider,
                rawText,
                referenceLibraryImageDataUrls,
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
                        ? 'AI ?대?吏 ?앹꽦 ?묐떟???댁꽍?섏? 紐삵뻽?듬땲??'
                        : 'AI ?대?吏 ?앹꽦 API ?묐떟???댁꽍?섏? 紐삵뻽?듬땲?? 濡쒖뺄 API ?쒕쾭媛 ?ㅽ뻾 以묒씤吏 ?뺤씤?섏꽭??',
                );
            }
        }

        if (!response.ok) {
            throw new Error(result?.message || 'AI ?대?吏 ?앹꽦???ㅽ뙣?덉뒿?덈떎.');
        }

        if (!result.imageDataUrl || !result.prompt) {
            throw new Error('AI ?대?吏 ?앹꽦 API ?묐떟???대?吏 ?곗씠?곌? ?놁뒿?덈떎.');
        }

        return result as GenerateAiCardImageResult;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('AI image generation timed out after 8 minutes. Reduce the copy or try again.', {
                cause: error,
            });
        }

        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

