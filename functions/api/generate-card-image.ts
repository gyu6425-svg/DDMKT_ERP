type GenerateCardImagePayload = {
    form?: {
        title?: string;
        subtitle?: string;
        emphasis?: string;
        badge?: string;
        cta?: string;
        backgroundColor?: string;
        accentColor?: string;
        textColor?: string;
    };
    imageDataUrl?: string;
    imageDataUrls?: string[];
    provider?: 'gemini' | 'openai';
    rawText?: string;
    templateDirection?: string;
    templateName?: string;
};

type FunctionContext = {
    request: Request;
    env: Record<string, string | undefined>;
};

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
        },
        status,
    });
}

async function readJsonResponse(response: Response) {
    const responseText = await response.text();

    if (!responseText) {
        return {};
    }

    try {
        return JSON.parse(responseText);
    } catch {
        return {
            error: {
                message: response.ok
                    ? 'OpenAI 응답을 해석하지 못했습니다.'
                    : 'OpenAI API가 JSON이 아닌 응답을 반환했습니다.',
            },
        };
    }
}

function buildPrompt({
    form = {},
    imageDataUrl,
    imageDataUrls,
    rawText = '',
    templateDirection,
    templateName,
}: GenerateCardImagePayload) {
    const referenceImages = getReferenceImages({ imageDataUrl, imageDataUrls });
    const imageDirection = referenceImages.length
        ? `- ${referenceImages.length} reference image(s) were uploaded.
- Use uploaded images as visual references, not as exact screenshots.
- Combine the main subject, mood, colors, and context naturally.
- Do not create a collage unless the copy clearly requires it.
- Recompose the visual naturally; remove or simplify messy background if helpful.`
        : `- No source image was uploaded. Create a suitable original visual from the Korean copy.
- Choose clean, relevant card-news imagery such as abstract medical/education/product/service visuals, icons, soft shapes, or professional scene elements.
- Do not invent real people, logos, brands, certificates, or institution marks unless explicitly provided in the copy.
- Keep generated visuals secondary to readable Korean typography.`;

    return `Create one polished Korean square card banner image.

Canvas:
- 1254x1254 square image.
- Premium Korean card-news / social banner style.
- Choose a layout freely based on the content, similar to Korean academy, product, consultation, portfolio, and playful card-news references.
${imageDirection}

Template:
- Selected template: ${templateName || 'Template 1'}.
${templateDirection ? `- ${templateDirection}` : '- Follow the selected template style consistently.'}

Brand:
- Brand or badge text: ${form.badge || 'BRAND'}
- Treat the badge as a brand name.
- Keep the brand badge visually consistent across every card in the series.
- Use the same badge placement, color treatment, and typography style.
- Do not translate, rename, distort, or restyle the brand name differently between cards.

Korean text to include exactly:
Main title:
${form.title || ''}

Supporting copy:
${form.subtitle || ''}

Emphasis:
${form.emphasis || ''}

CTA:
${form.cta || ''}

Raw user copy:
${rawText}

Design direction:
- Make the typography large, clear, and highly readable.
- Use Korean text accurately without changing the meaning.
- Use strong hierarchy: main title, supporting copy, emphasis, CTA.
- Use a refined advertising-card layout with enough margins.
- Main colors: ${form.textColor || '#111827'}, ${form.accentColor || '#1457ff'}, ${form.backgroundColor || '#ffffff'}.
- Avoid clutter. Make it look ready for a professional SNS/card-news banner.`;
}

function splitDataUrl(dataUrl: string) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);

    if (!match) {
        return null;
    }

    return {
        data: match[2],
        mimeType: match[1],
    };
}

function getReferenceImages(payload: Pick<GenerateCardImagePayload, 'imageDataUrl' | 'imageDataUrls'>) {
    return Array.isArray(payload.imageDataUrls)
        ? payload.imageDataUrls.filter(Boolean)
        : [payload.imageDataUrl].filter(Boolean);
}

async function generateOpenAiCardImage(payload: GenerateCardImagePayload, env: FunctionContext['env']) {
    const apiKey = env.OPENAI_API_KEY;

    if (!apiKey) {
        return jsonResponse(
            {
                message: 'Cloudflare 환경변수 OPENAI_API_KEY가 필요합니다.',
            },
            400,
        );
    }

    const prompt = buildPrompt(payload);
    const model = env.OPENAI_IMAGE_MODEL || 'gpt-5.5';
    const content: Array<
        | {
              text: string;
              type: 'input_text';
          }
        | {
              image_url: string;
              type: 'input_image';
          }
    > = [
        {
            text: prompt,
            type: 'input_text',
        },
    ];

    getReferenceImages(payload).forEach((imageDataUrl) => {
        content.push({
            image_url: imageDataUrl,
            type: 'input_image',
        });
    });

    const openaiResponse = await fetch(OPENAI_API_URL, {
        body: JSON.stringify({
            input: [
                {
                    content,
                    role: 'user',
                },
            ],
            model,
            tools: [
                {
                    size: '1024x1024',
                    type: 'image_generation',
                },
            ],
        }),
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        method: 'POST',
    });

    const result = await readJsonResponse(openaiResponse);

    if (!openaiResponse.ok) {
        return jsonResponse(
            {
                message: result?.error?.message || 'OpenAI 이미지 생성 요청에 실패했습니다.',
            },
            openaiResponse.status,
        );
    }

    const imageOutput = result.output?.find(
        (item: { type?: string }) => item.type === 'image_generation_call',
    );
    const imageBase64 = imageOutput?.result;

    if (!imageBase64) {
        const outputTypes = Array.isArray(result.output)
            ? result.output
                  .map((item: { type?: string }) => item.type)
                  .filter(Boolean)
                  .join(', ')
            : 'none';

        return jsonResponse(
            {
                message:
                    result.output_text ||
                    `OpenAI 응답에서 생성 이미지를 찾지 못했습니다. output: ${outputTypes}`,
            },
            502,
        );
    }

    return jsonResponse({
        imageDataUrl: `data:image/png;base64,${imageBase64}`,
        prompt,
    });
}

async function generateGeminiCardImage(payload: GenerateCardImagePayload, env: FunctionContext['env']) {
    const apiKey = env.GEMINI_API_KEY;

    if (!apiKey) {
        return jsonResponse(
            {
                message: 'Cloudflare 환경변수 GEMINI_API_KEY가 필요합니다.',
            },
            400,
        );
    }

    const prompt = buildPrompt(payload);
    const model = env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash';
    const parts: Array<
        | {
              text: string;
          }
        | {
              inlineData: {
                  data: string;
                  mimeType: string;
              };
          }
    > = [
        {
            text: prompt,
        },
    ];

    getReferenceImages(payload).forEach((imageDataUrl) => {
        const imagePart = splitDataUrl(imageDataUrl);

        if (imagePart) {
            parts.push({
                inlineData: {
                    data: imagePart.data,
                    mimeType: imagePart.mimeType,
                },
            });
        }
    });

    const geminiResponse = await fetch(
        `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${apiKey}`,
        {
            body: JSON.stringify({
                contents: [
                    {
                        parts,
                    },
                ],
                generationConfig: {
                    responseModalities: ['TEXT', 'IMAGE'],
                },
            }),
            headers: {
                'Content-Type': 'application/json',
            },
            method: 'POST',
        },
    );
    const result = await readJsonResponse(geminiResponse);

    if (!geminiResponse.ok) {
        const message =
            geminiResponse.status === 429
                ? '무료 티어 요청 제한에 걸렸습니다. 잠시 후 다시 시도하거나 모델/결제 등급을 확인해주세요.'
                : geminiResponse.status === 404
                  ? '모델명 또는 API 엔드포인트가 올바르지 않습니다.'
                  : result?.error?.message || 'Gemini 이미지 생성 요청에 실패했습니다.';

        return jsonResponse(
            {
                message,
            },
            geminiResponse.status,
        );
    }

    const partsOutput = result.candidates?.[0]?.content?.parts || [];
    const imagePart = partsOutput.find(
        (part: { inlineData?: { data?: string }; inline_data?: { data?: string } }) =>
            part.inlineData?.data || part.inline_data?.data,
    );
    const inlineData = imagePart?.inlineData || imagePart?.inline_data;

    if (!inlineData?.data) {
        const outputTypes = partsOutput
            .map((part: Record<string, unknown>) => Object.keys(part).join('+'))
            .filter(Boolean)
            .join(', ');

        return jsonResponse(
            {
                message: `Gemini 응답에서 생성 이미지를 찾지 못했습니다. output: ${
                    outputTypes || 'none'
                }`,
            },
            502,
        );
    }

    return jsonResponse({
        imageDataUrl: `data:${inlineData.mimeType || inlineData.mime_type || 'image/png'};base64,${
            inlineData.data
        }`,
        prompt,
    });
}

export async function onRequestPost({ request, env }: FunctionContext) {
    const payload = (await request.json()) as GenerateCardImagePayload;

    if (payload.provider === 'gemini') {
        return generateGeminiCardImage(payload, env);
    }

    return generateOpenAiCardImage(payload, env);
}
