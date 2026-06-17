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
    seriesStyleReferenceImageDataUrls?: string[];
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
    seriesStyleReferenceImageDataUrls,
    templateDirection,
    templateName,
}: GenerateCardImagePayload) {
    const referenceImages = getReferenceImages({ imageDataUrl, imageDataUrls });
    const seriesStyleReferenceImages = getSeriesStyleReferenceImages({
        seriesStyleReferenceImageDataUrls,
    });
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
    const seriesStyleDirection = seriesStyleReferenceImages.length
        ? `
Series style reference:
- ${seriesStyleReferenceImages.length} previously generated card image(s) are attached as style references.
- Match the repeated visual system from the style reference exactly: brand treatment, [1장]/[2장] page labels, number label treatment, title typography, body typography, chip dimensions, chip height/width, padding, radius, color, border, shadow, alignment, and spacing.
- Match the exact positions from the first/reference card: brand treatment must use the same x/y anchor position, bounding box size, alignment, margins from canvas edges, and baseline position on every card.
- Page/step labels such as [1장], [2장], [3장] must use the same x/y anchor position, bounding box size, alignment, margins from canvas edges, and baseline position on every card.
- Page/step labels are optional and must appear only when the user's Korean text explicitly includes a page/step marker.
- Preserve the user's exact page/step marker format. If the text says "[1장]", render "[1장]"; if it says "1", render "1"; if it says "1페이지", render "1페이지"; if it says "01" or "STEP 1", preserve that exact format.
- Do not convert "1", "1페이지", "첫 번째", or any other page marker into "[1장]" unless the user explicitly wrote "[1장]".
- If the user's Korean text does not contain any page/step marker, do not invent or add any page number label.
- On the 1254x1254 canvas, keep the brand area anchored around x=70, y=70 with a consistent chip/text bounding box size. Keep the page label area anchored around x=995, y=70 with a consistent chip/text bounding box size.
- Do not copy the previous card's words or content. Only copy the style tokens and repeated component treatment.
- If the reference uses a chip for the page label, every new page label must use the same chip shape and dimensions. If the reference uses plain text, every new page label must stay plain text.
- If the reference uses a chip/text/underline/label treatment for the brand, use the same brand treatment on this card.`
        : `
Series style reference:
- This is the first card in the series. Establish a reusable style system for brand treatment, page labels, title typography, body typography, chips, shadows, spacing, and colors. Future cards must match this card.`;

    return `Create one polished Korean square card banner image.

Canvas:
- 1254x1254 square image.
- The final image must be a full square canvas with 0px corner radius.
- Do not create rounded outer corners, rounded side edges, card-shaped clipping, masks, frames, or transparent corner cutouts.
- Fill the entire canvas to all four edges; the image corners and side corners must be perfectly square.
- Premium Korean card-news / social banner style.
- Choose a layout freely based on the content, similar to Korean academy, product, consultation, portfolio, and playful card-news references.
${imageDirection}
${seriesStyleDirection}

Template:
- Selected template: ${templateName || 'Template 1'}.
${templateDirection ? `- ${templateDirection}` : '- Follow the selected template style consistently.'}

Brand:
- Brand or badge text: ${form.badge || 'BRAND'}
- Treat the badge as a brand name.
- Keep the brand name visually consistent across every card in the series.
- Use the same brand placement, color treatment, and typography style.
- Do not translate, rename, distort, or restyle the brand name differently between cards.
- Choose one brand treatment for the series and keep it identical on every card.
- The brand may be plain text, a chip, a badge, a rectangular label, an underline treatment, or another simple brand treatment, but it must not change between cards.
- If the brand is a chip/badge/label/box/underline, keep the exact same shape, corner radius, padding, fill color, border, underline thickness, shadow, text color, font size, font weight, spacing, and alignment on every card.
- Do not render the brand as a chip on one card and plain text on another; do not switch between pill, rectangle, underline, badge, or text-only styles within the same series.

Korean text to include exactly:
Main title:
${form.title || ''}

Supporting copy:
${form.subtitle || ''}

Emphasis:
${form.emphasis || ''}

Raw user copy:
${rawText}

Design direction:
- Make the typography large, clear, and highly readable.
- Series consistency is mandatory: when generating multiple cards, treat shared UI elements as reusable components with fixed design tokens.
- Do not create a bottom CTA button, CTA chip, "learn more", "자세히 보기", "문의하기", or generic call-to-action button.
- Reuse the exact same component styles across every card for brand text/chips, numbered labels, section labels, badges, dividers, shadows, borders, and decorative containers.
- For every repeated chip/badge component, keep the same corner radius, padding, height, fill color, border color, border width, shadow blur, shadow offset, shadow opacity, text color, font size, font weight, letter spacing, and alignment across the full series.
- If page/step labels such as [1장], 1, 1페이지, STEP 1, 첫 번째, etc. appear, choose one treatment for the full series and keep it identical on every card.
- Only use page/step labels when the raw user copy explicitly includes them. Do not automatically add [1장], [2장], page numbers, slide numbers, or step labels.
- Do not normalize page/step label text into a different format. Keep the exact punctuation, brackets, Korean words, spacing, and numeral style from the source text.
- Page/step labels may be plain text, a chip, a badge, a circle, a rectangular label, an underline treatment, or another simple treatment, but they must not change between cards.
- If page/step labels are chips/badges/circles/labels, keep the exact same shape, corner radius, padding, fill color, border, shadow, text color, font size, font weight, spacing, bracket style, and alignment on every card.
- Keep brand and page/step labels in the same absolute position across the series. Do not move them to fit each card.
- Use the first card's brand position and page-label position as fixed anchors for all later cards.
- The brand and page/step label bounding boxes must keep the same width, height, x/y coordinates, edge margins, and text baseline across cards.
- Use fixed top anchors for this design: brand at the upper-left, page label at the upper-right. Keep their y-position aligned across cards.
- Do not resize a chip to fit the text differently from card to card. Use one fixed chip width and height for the same component across the series.
- Bad example to avoid: one card has a wider/taller brand chip while another has a smaller brand chip; one card has a page label chip while another uses plain text; one card shifts the brand/page label by a few pixels; one card changes chip purple/black color slightly. Do not do any of these.
- Brand chip/text and page label chip/text must be visually identical components across cards, with only the actual page number changing.
- If [1장] appears inside a chip, [2장], [3장], etc. must use the same chip width, height, corner radius, padding, color, border, shadow, font size, font weight, and x/y position.
- If the brand appears inside a chip, every card must use the same brand chip width, height, corner radius, padding, color, border, shadow, font size, font weight, and x/y position.
- The numerals 1, 2, 3, 4, etc. must use the exact same typeface, glyph style, width, height, stroke thickness, color, font size, font weight, and baseline across the full series.
- Do not render one page marker as a chip and another as plain text; do not switch number label styles within the same series.
- If no page/step label exists in the input text, leave the top-right page label area empty.
- Do not subtly change chip sizes, shadow values, border radii, padding, or number styles from card to card.
- Layout may adapt to copy length, but shared visual components must remain token-consistent across the series.
- Use one consistent modern Korean sans-serif typeface across all Korean text.
- Do not mix font families, handwriting styles, serif styles, outline fonts, or decorative lettering.
- Main title typography must be locked: every title line and every title block across the series uses the exact same font family, font weight, font size, color, letter spacing, line height, stroke thickness, shadow treatment, and baseline style.
- If the main title wraps into multiple lines, keep the first line and second line visually identical except for the actual words.
- Supporting copy/body typography must be locked separately: every supporting/body text line across the series uses the exact same font family, font weight, font size, color, letter spacing, line height, stroke thickness, and shadow treatment.
- Emphasis text may have its own hierarchy level, but every emphasis text line across the series must use identical color, size, and weight.
- Avoid per-word or per-line font variation. Do not make one Korean sentence subtly bolder, narrower, taller, rounder, or smaller than another sentence in the same title block.
- Color-linked typography rule: any text rendered in the same color must use the exact same font family, font weight, font size, letter spacing, line height, stroke thickness, antialiasing appearance, and shadow treatment unless it is explicitly a different hierarchy level with a different color.
- If two Korean text lines share the same text color, they must look like duplicates of the same text style with only the words changed.
- Do not use same-colored text to imply hierarchy through subtle weight, width, height, or px-size changes. Hierarchy changes must use clearly different placement or color, not hidden font variation.
- Keep all same-colored title text perfectly uniform across every generated card in the series.
- Within a single text line, every Korean character and word must have the same font weight, stroke thickness, width, height, antialiasing, and optical density unless the word is explicitly rendered in a different color.
- Do not bold, enlarge, compress, stretch, outline, shadow, or sharpen only part of a same-colored sentence.
- Same-colored words inside one line must look like they were typed with one continuous text layer, not manually drawn word by word.
- Use clean geometric Korean sans typography similar to Pretendard/Noto Sans KR, with uniform glyph rendering.
- Use Korean text accurately without changing the meaning.
- Preserve natural Korean spacing exactly. Do not insert spaces inside Korean words or split syllables/particles awkwardly.
- Keep line breaks at natural phrase boundaries. Do not create awkward spacing, broken words, or uneven character-by-character layout.
- Do not stretch a Korean word by adding spaces between letters. If text is too long, wrap by phrase, not by individual syllable.
- Use strong hierarchy only between brand, main title, supporting copy, and emphasis.
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

function isNonEmptyString(value: string | undefined): value is string {
    return Boolean(value);
}

function getReferenceImages(
    payload: Pick<GenerateCardImagePayload, 'imageDataUrl' | 'imageDataUrls'>,
): string[] {
    return Array.isArray(payload.imageDataUrls)
        ? payload.imageDataUrls.filter(isNonEmptyString)
        : [payload.imageDataUrl].filter(isNonEmptyString);
}

function getSeriesStyleReferenceImages(
    payload: Pick<GenerateCardImagePayload, 'seriesStyleReferenceImageDataUrls'>,
): string[] {
    return Array.isArray(payload.seriesStyleReferenceImageDataUrls)
        ? payload.seriesStyleReferenceImageDataUrls.filter(isNonEmptyString)
        : [];
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

    [...getReferenceImages(payload), ...getSeriesStyleReferenceImages(payload)].forEach((imageDataUrl) => {
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

    [...getReferenceImages(payload), ...getSeriesStyleReferenceImages(payload)].forEach((imageDataUrl) => {
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
