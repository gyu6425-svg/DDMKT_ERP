import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const PORT = Number(process.env.OPENAI_LOCAL_API_PORT || 8787);
const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const recentRequests = [];

function describeError(error) {
    if (!(error instanceof Error)) {
        return {
            message: String(error),
        };
    }

    return {
        cause: error.cause?.code || error.cause?.message,
        message: error.message,
    };
}

function rememberRequest(update) {
    recentRequests.unshift({
        at: new Date().toISOString(),
        ...update,
    });
    recentRequests.splice(20);
}

function loadDotEnv() {
    try {
        const envFile = readFileSync(resolve(process.cwd(), '.env'), 'utf8');

        envFile.split(/\r?\n/).forEach((line) => {
            const trimmedLine = line.trim();

            if (!trimmedLine || trimmedLine.startsWith('#')) {
                return;
            }

            const separatorIndex = trimmedLine.indexOf('=');

            if (separatorIndex === -1) {
                return;
            }

            const key = trimmedLine.slice(0, separatorIndex).trim();
            const value = trimmedLine.slice(separatorIndex + 1).trim();

            if (!process.env[key]) {
                process.env[key] = value;
            }
        });
    } catch {
        // .env is optional for the server process itself.
    }
}

function readJsonBody(request) {
    return new Promise((resolveBody, rejectBody) => {
        let body = '';

        request.on('data', (chunk) => {
            body += chunk;
        });

        request.on('end', () => {
            try {
                resolveBody(JSON.parse(body || '{}'));
            } catch (error) {
                rejectBody(error);
            }
        });

        request.on('error', rejectBody);
    });
}

function sendJson(response, statusCode, body) {
    response.writeHead(statusCode, {
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify(body));
}

async function readJsonResponse(response) {
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

function getReferenceImages(payload) {
    return Array.isArray(payload.imageDataUrls)
        ? payload.imageDataUrls.filter((imageDataUrl) => Boolean(imageDataUrl)).slice(0, 1)
        : [payload.imageDataUrl].filter((imageDataUrl) => Boolean(imageDataUrl)).slice(0, 1);
}

function getSeriesStyleReferenceImages(payload) {
    return Array.isArray(payload.seriesStyleReferenceImageDataUrls)
        ? payload.seriesStyleReferenceImageDataUrls
              .filter((imageDataUrl) => Boolean(imageDataUrl))
              .slice(0, 1)
        : [];
}

function getCampaignStyleReferenceImages(payload) {
    return Array.isArray(payload.campaignStyleReferenceImageDataUrls)
        ? payload.campaignStyleReferenceImageDataUrls
              .filter((imageDataUrl) => Boolean(imageDataUrl))
              .slice(0, 1)
        : [];
}

function getReferenceLibraryImages(payload) {
    return Array.isArray(payload.referenceLibraryImageDataUrls)
        ? payload.referenceLibraryImageDataUrls
              .filter((imageDataUrl) => Boolean(imageDataUrl))
              .slice(0, 3)
        : [];
}

function getBannerDimensions(bannerSize) {
    return {
        height: bannerSize?.height || 1254,
        width: bannerSize?.width || 1254,
    };
}

function getLogoOverlayBox(bannerSize) {
    if (bannerSize?.id === 'bottom') {
        return { height: 76, width: 220, x: 92, y: 76 };
    }

    return { height: 92, width: 220, x: 84, y: 84 };
}

function escapeXml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function encodeSvgDataUrl(svg) {
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function wrapImageWithSvg(imageDataUrl, bannerSize, overlayMarkup = '') {
    const { height, width } = getBannerDimensions(bannerSize);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#ffffff"/>
<image href="${escapeXml(imageDataUrl)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>
${overlayMarkup}
</svg>`;

    return encodeSvgDataUrl(svg);
}

function getCoverOverlayBox(bannerSize) {
    const box = getLogoOverlayBox(bannerSize);

    return {
        height: bannerSize?.id === 'bottom' ? box.y + box.height + 54 : box.y + box.height + 70,
        width: bannerSize?.id === 'bottom' ? box.x + box.width + 90 : box.x + box.width + 110,
        x: 0,
        y: 0,
    };
}

function overlayTopLeftCoverOnImage(imageDataUrl, payload) {
    const box = getCoverOverlayBox(payload.bannerSize);
    const fillColor = payload.form?.backgroundColor || '#ffffff';
    const overlayMarkup = `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${escapeXml(fillColor)}"/>`;

    return wrapImageWithSvg(imageDataUrl, payload.bannerSize, overlayMarkup);
}

function overlayLogoOnImage(imageDataUrl, logoDataUrl, bannerSize) {
    const box = getLogoOverlayBox(bannerSize);
    const overlayMarkup = `<image href="${escapeXml(logoDataUrl)}" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid meet"/>`;

    return wrapImageWithSvg(imageDataUrl, bannerSize, overlayMarkup);
}

function overlayBrandMarkOnImage(imageDataUrl, payload) {
    const coveredImageDataUrl = overlayTopLeftCoverOnImage(imageDataUrl, payload);

    if (payload.logoDataUrl) {
        if (payload.skipServerLogoOverlay) {
            return coveredImageDataUrl;
        }

        return overlayLogoOnImage(coveredImageDataUrl, payload.logoDataUrl, payload.bannerSize);
    }

    return coveredImageDataUrl;
}

function dataUrlToBuffer(dataUrl) {
    const imagePart = splitDataUrl(dataUrl);

    if (!imagePart) {
        return null;
    }

    return Buffer.from(imagePart.data, 'base64');
}

async function makeLogoOverlayBuffer(logoDataUrl, maxWidth, maxHeight) {
    const logoBuffer = dataUrlToBuffer(logoDataUrl);

    if (!logoBuffer) {
        return null;
    }

    const rawLogo = await sharp(logoBuffer).ensureAlpha().raw().toBuffer({
        resolveWithObject: true,
    });
    const pixels = rawLogo.data;
    const { height, width } = rawLogo.info;
    const samplePoints = [
        [0, 0],
        [Math.max(0, width - 1), 0],
        [0, Math.max(0, height - 1)],
        [Math.max(0, width - 1), Math.max(0, height - 1)],
    ];
    const sampledColors = samplePoints.map(([x, y]) => {
        const index = (y * width + x) * 4;

        return {
            blue: pixels[index + 2],
            green: pixels[index + 1],
            red: pixels[index],
        };
    });
    const backgroundColor = sampledColors.reduce(
        (color, sample) => ({
            blue: color.blue + sample.blue / sampledColors.length,
            green: color.green + sample.green / sampledColors.length,
            red: color.red + sample.red / sampledColors.length,
        }),
        { blue: 0, green: 0, red: 0 },
    );

    for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const max = Math.max(red, green, blue);
        const min = Math.min(red, green, blue);
        const backgroundDistance = Math.hypot(
            red - backgroundColor.red,
            green - backgroundColor.green,
            blue - backgroundColor.blue,
        );

        if (backgroundDistance < 26 || (red > 245 && green > 245 && blue > 245 && max - min < 12)) {
            pixels[index + 3] = 0;
        } else if (
            backgroundDistance < 48 ||
            (red > 235 && green > 235 && blue > 235 && max - min < 18)
        ) {
            pixels[index + 3] = Math.min(
                pixels[index + 3],
                Math.max(20, Math.round((backgroundDistance - 26) * 5)),
            );
        }
    }

    return sharp(pixels, { raw: rawLogo.info })
        .trim({
            background: {
                alpha: 0,
                b: Math.round(backgroundColor.blue),
                g: Math.round(backgroundColor.green),
                r: Math.round(backgroundColor.red),
            },
            threshold: 18,
        })
        .resize({
            fit: 'inside',
            height: maxHeight,
            withoutEnlargement: true,
            width: maxWidth,
        })
        .png()
        .toBuffer();
}

function makeCoverOverlaySvg(bannerSize, fillColor = '#ffffff') {
    const box = getLogoOverlayBox(bannerSize);
    const width = bannerSize?.id === 'bottom' ? box.x + box.width + 90 : box.x + box.width + 110;
    const height = bannerSize?.id === 'bottom' ? box.y + box.height + 54 : box.y + box.height + 70;

    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(fillColor)}"/>
</svg>`);
}

async function finalizeImageDataUrl(imageDataUrl, payload) {
    const imageBuffer = dataUrlToBuffer(imageDataUrl);

    if (!imageBuffer) {
        return overlayBrandMarkOnImage(imageDataUrl, payload);
    }

    const { height, width } = getBannerDimensions(payload.bannerSize);
    const composites = [];
    composites.push({
        input: makeCoverOverlaySvg(payload.bannerSize, payload.form?.backgroundColor || '#ffffff'),
        left: 0,
        top: 0,
    });

    if (payload.logoDataUrl) {
        const box = getLogoOverlayBox(payload.bannerSize);
        const logoBuffer = await makeLogoOverlayBuffer(payload.logoDataUrl, box.width, box.height);

        if (logoBuffer) {
            const metadata = await sharp(logoBuffer).metadata();

            composites.push({
                input: logoBuffer,
                left: Math.round(box.x + (box.width - (metadata.width || box.width)) / 2),
                top: Math.round(box.y + (box.height - (metadata.height || box.height)) / 2),
            });
        }
    }

    const outputBuffer = await sharp(imageBuffer)
        .resize(width, height, { fit: 'cover', position: 'center' })
        .composite(composites)
        .png()
        .toBuffer();

    return `data:image/png;base64,${outputBuffer.toString('base64')}`;
}

function buildPrompt({
    bannerSize,
    campaignStyleReferenceImageDataUrls,
    form,
    imageDataUrl,
    imageDataUrls,
    rawText,
    referenceLibraryImageDataUrls,
    seriesStyleReferenceImageDataUrls,
    templateDirection,
    templateName,
}) {
    const width = bannerSize?.width || 1254;
    const height = bannerSize?.height || 1254;
    const isSquare = width === height;
    const formatName = bannerSize?.name || (isSquare ? 'square card banner' : 'bottom banner');
    const referenceImages = getReferenceImages({ imageDataUrl, imageDataUrls });
    const legacySeriesStyleReferenceImages = getSeriesStyleReferenceImages({
        seriesStyleReferenceImageDataUrls,
    });
    const campaignStyleReferenceImages = getCampaignStyleReferenceImages({
        campaignStyleReferenceImageDataUrls,
    });
    const referenceLibraryImages = getReferenceLibraryImages({
        referenceLibraryImageDataUrls,
    });
    const imageDirection = referenceImages.length
        ? `- ${referenceImages.length} reference image(s) were uploaded.
- Use uploaded images as visual references, not as exact screenshots.
- Combine the main subject, mood, colors, and context naturally.
- Do not create a collage unless the copy clearly requires it.
- Recompose the visual naturally; remove or simplify messy background if helpful.`
        : `- No source image was uploaded. Create a suitable original visual from the Korean copy.
- Choose clean, relevant card-news imagery such as abstract medical/education/product/service visuals, icons, soft shapes, or professional scene elements.
- Do not invent real people, certificates, or institution marks unless explicitly provided in the copy.
- Keep generated visuals secondary to readable Korean typography.`;
    const campaignStyleDirection = campaignStyleReferenceImages.length
        ? `
Campaign master style:
- ${campaignStyleReferenceImages.length} previously generated card image(s) from this run are attached first.
- Treat the first generated card from this run as the campaign master design system even when this request uses a different canvas size or aspect ratio.
- Design token lock is mandatory: the first generated card defines the exact campaign design tokens for all later cards.
- For all later cards, reuse the exact same design tokens from the first card. Only replace the content. Do not redesign the system.
- All later cards must look like responsive variants of the campaign master, not like new unrelated designs.
- Match the campaign master before matching the reference library.
- Preserve the campaign master's typography hierarchy, color mood, decorative language, image treatment, spacing rhythm, and component styling.
- If the current canvas size differs from the campaign master, adapt only layout geometry to the new aspect ratio.
- Do not copy the campaign master's words or content. Only copy the design system and repeated component treatment.`
        : `
Campaign master style:
- This is the first generated card in this run. Establish a reusable campaign design system for later cards.
- This first card will define the locked design tokens for title, body, emphasis, page labels, dividers, text boxes, spacing, and decorative components.`;
    const referenceLibraryDirection = referenceLibraryImages.length || legacySeriesStyleReferenceImages.length
        ? `
Reference library:
- ${referenceLibraryImages.length + legacySeriesStyleReferenceImages.length} reference image(s) are attached after any campaign master images.
- Use the references as a design-method guide, not as exact images to copy. Extract the composition logic, spacing system, typography hierarchy, color mood, illustration/photo treatment, and decorative language, then create a new original banner for the user's copy.
- Do not reuse the exact same scene, exact text layout, exact object placement, exact illustration, or exact copy from a reference unless the user's input explicitly asks for it.
- Before composing, infer the reference design method: how the headline is weighted, how support copy is grouped, how emphasis boxes are styled, how decorative dots/arcs/icons are used, and how the main visual balances with text. Apply that method to the new content.
- If the current canvas size differs from the reference, adapt only the layout geometry to the new aspect ratio; preserve the same visual mood, color palette, typography style, border radius language, shadows, decorative motifs, image treatment, spacing rhythm, and hierarchy.
- Cross-size consistency is mandatory: square cards, bottom banners, and any other sizes in the same series must look like one campaign family, not separate template designs.
- Do not switch to a different design theme just because the aspect ratio changes.
- Korean headline typography must preserve the same heavy geometric sans look from the reference. Do not switch to a softer, handwritten, serif, condensed, distorted, or uneven AI-looking Korean font on bottom banners.
- Match the repeated visual system from the style reference for page labels, number label treatment, title typography, body typography, spacing, color, border, shadow, alignment, and spacing.
- Page/step labels such as [1장], [2장], [3장] must use the same x/y anchor position, bounding box size, alignment, margins from canvas edges, and baseline position on every card.
- Page/step labels are optional and must appear only when the user's Korean text explicitly includes a page/step marker.
- Preserve the user's exact page/step marker format. If the text says "[1장]", render "[1장]"; if it says "1", render "1"; if it says "1페이지", render "1페이지"; if it says "01" or "STEP 1", preserve that exact format.
- Do not convert "1", "1페이지", "첫 번째", or any other page marker into "[1장]" unless the user explicitly wrote "[1장]".
- If the user's Korean text does not contain any page/step marker, do not invent or add any page number label.
- If the reference uses a page marker, keep only its general placement and hierarchy. If there is no page marker in the user's text, do not add one.
`
        : '';

    return `Create one polished Korean ${formatName} image.

Canvas:
- ${width}x${height} image.
- The final image must be a full ${isSquare ? 'square' : 'landscape'} canvas with 0px corner radius.
- ${isSquare ? 'Use a square SNS/card-news composition.' : 'Use a wide bottom-banner composition optimized for a horizontal footer or lower-page banner.'}
- Do not create rounded outer corners, rounded side edges, card-shaped clipping, masks, frames, or transparent corner cutouts.
- Fill the entire canvas to all four edges; the image corners and side corners must be perfectly square.
- Premium Korean card-news / social banner style.
- Choose a layout freely based on the content, similar to Korean academy, product, consultation, portfolio, and playful card-news references.
${imageDirection}
${campaignStyleDirection}
${referenceLibraryDirection}

Template:
- Selected template: ${templateName || 'Template 1'}.
${templateDirection ? `- ${templateDirection}` : '- Follow the selected template style consistently.'}

Korean text to include exactly:
Main title:
${form.title}

Supporting copy:
${form.subtitle}

Emphasis:
${form.emphasis}

Raw user copy:
${rawText}

Design direction:
- Make the typography large, clear, and highly readable.
- Render only the Korean text explicitly listed above. Do not add any extra English labels, captions, marks, or decorative text.
- Reference images are inspiration for design principles only. Do not trace, duplicate, or recreate a reference image verbatim.
- Build a fresh layout from the user's raw copy while borrowing only high-level style rules: hierarchy, spacing rhythm, color relationship, decorative motif type, and image mood.
- Design token lock:
- This is a multi-card campaign series.
- The first generated card defines the campaign design system.
- For all later cards, reuse the exact same design tokens from the first card.
- Only replace the content. Do not redesign the system.
- Treat title, body, emphasis text, page labels, dividers, and text boxes as locked reusable components/text styles after the first card.
- Typography token rules:
- If the main title on the first card uses a specific font size, font weight, line height, letter spacing, and color, keep those exact same values on all later cards.
- If the supporting/body text on the first card uses a specific font size, font weight, line height, letter spacing, and color, keep those exact same values on all later cards.
- If the emphasis text on the first card uses a specific font size, font weight, line height, letter spacing, and color, keep those exact same values on all later cards.
- The same hierarchy level must always use the same typography tokens across the whole series.
- Example: if the main title is 15px and #000000 on the first card, all later cards must keep the main title at 15px and #000000.
- Example: if the supporting text is 12px and #555555 on the first card, all later cards must keep that exact same style.
- Example: if the emphasis text is 15px bold and orange on the first card, all later cards must keep that exact same emphasis style.
- Do not introduce subtle differences in font size, weight, spacing, line height, letter spacing, or color between cards.
- Reusable component lock:
- Any repeated UI component such as page labels, dividers, or text boxes must be reused with identical design tokens across all cards.
- Keep the same x/y anchor position, width, height, padding, corner radius, fill color, border, shadow, and text styling.
- Do not restyle shared components from card to card.
- Series consistency is mandatory: when generating multiple cards, treat shared UI elements as reusable components with fixed design tokens.
- If the series contains mixed sizes such as 1254x1254 square cards and 1672x941 bottom banners, keep one unified campaign design system across all sizes.
- For mixed-size outputs, preserve visual mood, color palette, font style, decorative motif style, image treatment, and hierarchy from the first generated card. Change only the layout proportions and element positions needed to fit the selected canvas.
- The different sizes must look like responsive variants of the same design, not separate designs.
- Preserve the master Korean headline font style across sizes: heavy, clean, geometric, uniform stroke width, consistent anti-aliasing, and no odd glyph deformation.
- Do not create a bottom CTA button, "learn more", "자세히 보기", "문의하기", or generic call-to-action button.
- Reuse the exact same component styles across every card for numbered labels, section labels, dividers, shadows, borders, and decorative containers.
- If page/step labels such as [1장], 1, 1페이지, STEP 1, 첫 번째, etc. appear, choose one treatment for the full series and keep it identical on every card.
- Only use page/step labels when the raw user copy explicitly includes them. Do not automatically add [1장], [2장], page numbers, slide numbers, or step labels.
- Do not normalize page/step label text into a different format. Keep the exact punctuation, brackets, Korean words, spacing, and numeral style from the source text.
- Page/step labels should be plain text unless the user explicitly typed a decorated marker in the copy.
- Keep page/step labels in the same absolute position across the series. Do not move them to fit each card.
- Use the first card's page-label position as a fixed anchor for all later cards.
- Page/step label bounding boxes must keep the same width, height, x/y coordinates, edge margins, and text baseline across cards.
- Do not change page marker styling between cards.
- The numerals 1, 2, 3, 4, etc. must use the exact same typeface, glyph style, width, height, stroke thickness, color, font size, font weight, and baseline across the full series.
- Do not switch page marker styles within the same series.
- If no page/step label exists in the input text, leave the top-right page label area empty.
- Do not subtly change marker sizes, shadow values, border radii, padding, or number styles from card to card.
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
- Use strong hierarchy only between main title, supporting copy, and emphasis.
- Use a refined advertising-card layout with enough margins.
- Required color roles:
- Background fill color must be exactly ${form.backgroundColor || '#ffffff'}.
- Main text color must be exactly ${form.textColor || '#111827'}.
- Accent/highlight color must be exactly ${form.accentColor || '#1457ff'}.
- Do not swap background and text colors. Do not use the text color as the full background unless it is also explicitly selected as the background color.
- White may be used only for small contrast areas when needed; do not make the main text white unless the selected text color is white.
- Avoid clutter. Make it look ready for a professional SNS/card-news banner.`;
}

function splitDataUrl(dataUrl) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);

    if (!match) {
        return null;
    }

    return {
        data: match[2],
        mimeType: match[1],
    };
}

async function generateOpenAiCardImage(payload) {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const startedAt = Date.now();
    const apiKey = process.env.OPENAI_API_KEY;
    const outputSize = payload.bannerSize?.id === 'bottom' ? '1536x1024' : '1024x1024';

    if (!apiKey) {
        rememberRequest({
            id: requestId,
            message: 'OPENAI_API_KEY missing',
            status: 'error',
        });
        return {
            body: {
                message: '.env에 OPENAI_API_KEY를 입력해야 AI 이미지 생성을 테스트할 수 있습니다.',
            },
            statusCode: 400,
        };
    }

    const prompt = buildPrompt(payload);
    const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-5.5';
    rememberRequest({
        hasImage: getReferenceImages(payload).length > 0,
        id: requestId,
        model,
        provider: 'openai',
        rawTextLength: payload.rawText?.length || 0,
        status: 'started',
    });
    const content = [
        {
            text: prompt,
            type: 'input_text',
        },
    ];

    [
        ...getReferenceImages(payload),
        ...getCampaignStyleReferenceImages(payload),
        ...getReferenceLibraryImages(payload),
        ...getSeriesStyleReferenceImages(payload),
    ].forEach((imageDataUrl) => {
        content.push({
            image_url: imageDataUrl,
            type: 'input_image',
        });
    });

    let openaiResponse;

    try {
        openaiResponse = await fetch(OPENAI_API_URL, {
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
                        size: outputSize,
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
    } catch (error) {
        const errorDetails = describeError(error);
        rememberRequest({
            elapsedMs: Date.now() - startedAt,
            id: requestId,
            provider: 'openai',
            status: 'error',
            ...errorDetails,
        });
        throw error;
    }

    const result = await readJsonResponse(openaiResponse);
    const elapsedMs = Date.now() - startedAt;

    if (!openaiResponse.ok) {
        rememberRequest({
            elapsedMs,
            id: requestId,
            message: result?.error?.message || 'OpenAI request failed',
            openaiStatus: openaiResponse.status,
            status: 'error',
        });
        return {
            body: {
                message: result?.error?.message || 'OpenAI 이미지 생성 요청에 실패했습니다.',
            },
            statusCode: openaiResponse.status,
        };
    }

    const imageOutput = result.output?.find((item) => item.type === 'image_generation_call');
    const imageBase64 = imageOutput?.result;

    if (!imageBase64) {
        const outputTypes = Array.isArray(result.output)
            ? result.output.map((item) => item.type).filter(Boolean).join(', ')
            : 'none';
        rememberRequest({
            elapsedMs,
            id: requestId,
            message: `No image output. output: ${outputTypes}`,
            status: 'error',
        });

        return {
            body: {
                message:
                    result.output_text ||
                    `OpenAI 응답에서 생성 이미지를 찾지 못했습니다. output: ${outputTypes}`,
            },
            statusCode: 502,
        };
    }

    rememberRequest({
        elapsedMs,
        id: requestId,
        imageBytes: imageBase64.length,
        status: 'success',
    });

    return {
        body: {
            imageDataUrl: await finalizeImageDataUrl(
                `data:image/png;base64,${imageBase64}`,
                payload,
            ),
            prompt,
        },
        statusCode: 200,
    };
}

async function generateGeminiCardImage(payload) {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const startedAt = Date.now();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        rememberRequest({
            id: requestId,
            message: 'GEMINI_API_KEY missing',
            provider: 'gemini',
            status: 'error',
        });
        return {
            body: {
                message: '.env에 GEMINI_API_KEY를 입력해야 Gemini 이미지 생성을 사용할 수 있습니다.',
            },
            statusCode: 400,
        };
    }

    const prompt = buildPrompt(payload);
    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash';
    const parts = [
        {
            text: prompt,
        },
    ];

    [
        ...getReferenceImages(payload),
        ...getCampaignStyleReferenceImages(payload),
        ...getReferenceLibraryImages(payload),
        ...getSeriesStyleReferenceImages(payload),
    ].forEach((imageDataUrl) => {
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

    rememberRequest({
        hasImage: getReferenceImages(payload).length > 0,
        id: requestId,
        model,
        provider: 'gemini',
        rawTextLength: payload.rawText?.length || 0,
        status: 'started',
    });

    let geminiResponse;

    try {
        geminiResponse = await fetch(
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
    } catch (error) {
        const errorDetails = describeError(error);
        rememberRequest({
            elapsedMs: Date.now() - startedAt,
            id: requestId,
            provider: 'gemini',
            status: 'error',
            ...errorDetails,
        });
        throw error;
    }
    const result = await readJsonResponse(geminiResponse);
    const elapsedMs = Date.now() - startedAt;

    if (!geminiResponse.ok) {
        const message =
            geminiResponse.status === 429
                ? '무료 티어 요청 제한에 걸렸습니다. 잠시 후 다시 시도하거나 모델/결제 등급을 확인해주세요.'
                : geminiResponse.status === 404
                  ? '모델명 또는 API 엔드포인트가 올바르지 않습니다.'
                  : result?.error?.message || 'Gemini request failed';
        rememberRequest({
            elapsedMs,
            id: requestId,
            message,
            providerStatus: geminiResponse.status,
            provider: 'gemini',
            status: 'error',
        });
        return {
            body: {
                message,
            },
            statusCode: geminiResponse.status,
        };
    }

    const partsOutput = result.candidates?.[0]?.content?.parts || [];
    const imagePart = partsOutput.find((part) => part.inlineData?.data || part.inline_data?.data);
    const inlineData = imagePart?.inlineData || imagePart?.inline_data;

    if (!inlineData?.data) {
        const outputTypes = partsOutput
            .map((part) => Object.keys(part).join('+'))
            .filter(Boolean)
            .join(', ');
        rememberRequest({
            elapsedMs,
            id: requestId,
            message: `No Gemini image output. output: ${outputTypes || 'none'}`,
            provider: 'gemini',
            status: 'error',
        });
        return {
            body: {
                message: `Gemini 응답에서 생성 이미지를 찾지 못했습니다. output: ${outputTypes || 'none'}`,
            },
            statusCode: 502,
        };
    }

    rememberRequest({
        elapsedMs,
        id: requestId,
        imageBytes: inlineData.data.length,
        provider: 'gemini',
        status: 'success',
    });

    return {
        body: {
            imageDataUrl: await finalizeImageDataUrl(
                `data:${inlineData.mimeType || inlineData.mime_type || 'image/png'};base64,${
                    inlineData.data
                }`,
                payload,
            ),
            prompt,
        },
        statusCode: 200,
    };
}

async function generateCardImage(payload) {
    if (payload.provider === 'gemini') {
        return generateGeminiCardImage(payload);
    }

    return generateOpenAiCardImage(payload);
}

async function checkTls() {
    const [openai, gemini] = await Promise.all([
        fetch('https://api.openai.com/v1/models', {
            headers: {
                Authorization: 'Bearer invalid',
            },
        }).then((response) => ({
            ok: true,
            status: response.status,
        })),
        fetch('https://generativelanguage.googleapis.com/v1beta/models?key=invalid').then((response) => ({
            ok: true,
            status: response.status,
        })),
    ]);

    return {
        gemini,
        openai,
    };
}

loadDotEnv();

const server = createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
        sendJson(response, 200, {});
        return;
    }

    if (request.method === 'GET' && request.url === '/api/health') {
        sendJson(response, 200, {
            execArgv: process.execArgv,
            geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
            nodeVersion: process.version,
            ok: true,
            openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
            pid: process.pid,
            recentRequests,
            usingSystemCa: process.execArgv.includes('--use-system-ca'),
        });
        return;
    }

    if (request.method === 'GET' && request.url === '/api/tls-check') {
        try {
            sendJson(response, 200, await checkTls());
        } catch (error) {
            sendJson(response, 500, describeError(error));
        }
        return;
    }

    if (request.method === 'POST' && request.url === '/api/generate-card-image') {
        try {
            const payload = await readJsonBody(request);
            const result = await generateCardImage(payload);
            sendJson(response, result.statusCode, result.body);
        } catch (error) {
            const cause = error?.cause?.code || error?.cause?.message;
            sendJson(response, 500, {
                message:
                    error instanceof Error
                        ? [error.message, cause].filter(Boolean).join(': ')
                        : '서버 오류가 발생했습니다.',
            });
        }
        return;
    }

    sendJson(response, 404, {
        message: 'Not found',
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`OpenAI card image API listening on http://127.0.0.1:${PORT}`);
});
