type GenerateCardImagePayload = {
    backgroundOnly?: boolean;
    bannerSize?: {
        height?: number;
        id?: string;
        label?: string;
        name?: string;
        width?: number;
    };
    baseCompositionDataUrl?: string;
    brandCorner?: string;
    brandText?: string;
    categoryDirective?: string;
    campaignStyleReferenceImageDataUrls?: string[];
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
    imageQuality?: string;
    logoDataUrl?: string;
    provider?: 'gemini' | 'openai';
    rawText?: string;
    referenceLibraryImageDataUrls?: string[];
    skipServerLogoOverlay?: boolean;
    seriesStyleReferenceImageDataUrls?: string[];
    styleDirective?: string;
    templateDirection?: string;
    templateName?: string;
};

type FunctionContext = {
    request: Request;
    env: Record<string, string | undefined>;
};

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
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

function getBannerDimensions(bannerSize: GenerateCardImagePayload['bannerSize']) {
    return {
        height: bannerSize?.height || 1254,
        width: bannerSize?.width || 1254,
    };
}

function getLogoOverlayBox(bannerSize: GenerateCardImagePayload['bannerSize']) {
    if (bannerSize?.id === 'bottom') {
        return { height: 76, width: 220, x: 92, y: 76 };
    }

    return { height: 92, width: 220, x: 84, y: 84 };
}

function escapeXml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function encodeSvgDataUrl(svg: string) {
    const bytes = new TextEncoder().encode(svg);
    let binary = '';

    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });

    return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function wrapImageWithSvg(
    imageDataUrl: string,
    bannerSize: GenerateCardImagePayload['bannerSize'],
    overlayMarkup = '',
) {
    const { height, width } = getBannerDimensions(bannerSize);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#ffffff"/>
<image href="${escapeXml(imageDataUrl)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>
${overlayMarkup}
</svg>`;

    return encodeSvgDataUrl(svg);
}

function getCoverOverlayBox(bannerSize: GenerateCardImagePayload['bannerSize']) {
    const box = getLogoOverlayBox(bannerSize);
    const padding = 24;

    return {
        height: box.y + box.height + padding,
        width: box.x + box.width + padding,
        x: 0,
        y: 0,
    };
}

function overlayTopLeftCoverOnImage(
    imageDataUrl: string,
    payload: GenerateCardImagePayload,
) {
    const box = getCoverOverlayBox(payload.bannerSize);
    const fillColor = payload.form?.backgroundColor || '#ffffff';
    const overlayMarkup = `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${escapeXml(fillColor)}"/>`;

    return wrapImageWithSvg(imageDataUrl, payload.bannerSize, overlayMarkup);
}

function overlayLogoOnImage(
    imageDataUrl: string,
    logoDataUrl: string,
    bannerSize: GenerateCardImagePayload['bannerSize'],
) {
    const box = getLogoOverlayBox(bannerSize);
    const overlayMarkup = `<image href="${escapeXml(logoDataUrl)}" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid meet"/>`;

    return wrapImageWithSvg(imageDataUrl, bannerSize, overlayMarkup);
}

function overlayBrandMarkOnImage(imageDataUrl: string, payload: GenerateCardImagePayload) {
    const coveredImageDataUrl = overlayTopLeftCoverOnImage(imageDataUrl, payload);

    if (payload.logoDataUrl) {
        if (payload.skipServerLogoOverlay) {
            return coveredImageDataUrl;
        }

        return overlayLogoOnImage(coveredImageDataUrl, payload.logoDataUrl, payload.bannerSize);
    }

    return coveredImageDataUrl;
}

function dataUrlToBuffer(dataUrl: string) {
    const imagePart = splitDataUrl(dataUrl);

    if (!imagePart) {
        return null;
    }

    return Buffer.from(imagePart.data, 'base64');
}

// Cloudflare Workers 런타임은 네이티브 sharp를 지원하지 않고, 합성은 모두 클라이언트가 처리하므로
// 서버에서는 sharp를 사용하지 않는다(빌드 시 sharp 번들링 회피).
async function getSharp(): Promise<null> {
    return null;
}

async function makeLogoOverlayBuffer(logoDataUrl: string, maxWidth: number, maxHeight: number) {
    const sharp = await getSharp();
    const logoBuffer = dataUrlToBuffer(logoDataUrl);

    if (!sharp || !logoBuffer) {
        return null;
    }

    const rawLogo = await sharp(logoBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
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

function makeCoverOverlaySvg(
    bannerSize: GenerateCardImagePayload['bannerSize'],
    fillColor = '#ffffff',
) {
    const box = getLogoOverlayBox(bannerSize);
    const padding = 24;
    const width = box.x + box.width + padding;
    const height = box.y + box.height + padding;

    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(fillColor)}"/>
</svg>`);
}

async function finalizeImageDataUrl(imageDataUrl: string, payload: GenerateCardImagePayload) {
    // 클라이언트가 리사이즈/커버/로고를 모두 합성하므로 서버 후처리(sharp)를 건너뛴다(지연·끊김 방지).
    if (payload.backgroundOnly || payload.skipServerLogoOverlay) {
        return imageDataUrl;
    }

    const sharp = await getSharp();

    if (!sharp) {
        return overlayBrandMarkOnImage(imageDataUrl, payload);
    }

    const imageBuffer = dataUrlToBuffer(imageDataUrl);

    if (!imageBuffer) {
        return overlayBrandMarkOnImage(imageDataUrl, payload);
    }

    const { height, width } = getBannerDimensions(payload.bannerSize);
    const composites: Array<{ input: Buffer; left: number; top: number }> = [];
    composites.push({
        input: makeCoverOverlaySvg(payload.bannerSize, payload.form?.backgroundColor || '#ffffff'),
        left: 0,
        top: 0,
    });

    if (payload.logoDataUrl && !payload.skipServerLogoOverlay) {
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

function buildRefinePrompt(
    payload: GenerateCardImagePayload,
    width: number,
    height: number,
    formatName: string,
) {
    const { form = {} } = payload;

    return `Refine an existing, fully-composed Korean ${formatName}.
The FIRST attached image is the BASE design: it already has the correct layout, Korean text, colors, and image placement.

Hard rules:
- Keep the EXACT same layout, composition, text wording, text position, size hierarchy, and color scheme as the base.
- Do NOT move, rewrite, translate, re-typeset, restyle, add, or remove any Korean text. Every character must stay identical and in the same place.
- Do NOT change the overall composition or element positions.
- Keep the top-left brand/logo area clean and empty; it will be replaced by an overlay afterward.

Enhance ONLY:
- Background quality: subtle gradients, depth, soft lighting, and gentle decorative shapes consistent with the base palette.
- The main photo/image area: make it realistic, clean, and well integrated.
- Overall polish so it looks like a premium version of the SAME design.

Canvas:
- ${width}x${height}, 0px corner radius, fill all four edges, perfectly square corners.

Required colors (must match the base exactly):
- Background ${form.backgroundColor || '#ffffff'}
- Main text ${form.textColor || '#111827'}
- Accent ${form.accentColor || '#1457ff'}

Output one polished image. Do not add extra English text, captions, or watermarks.`;
}

function buildBackgroundPrompt(
    payload: GenerateCardImagePayload,
    width: number,
    height: number,
    formatName: string,
) {
    const { form = {}, templateDirection, templateName } = payload;
    const backgroundColor = form.backgroundColor || '#ffffff';
    const accentColor = form.accentColor || '#1457ff';

    return `Create a clean Korean ${formatName} BACKGROUND image (no text). ${width}x${height}px, fill all four edges, perfectly square corners, no frame or border.

ABSOLUTELY NO text, letters, words, numbers, hangul, captions, labels, or typography anywhere — this is a background only. If unsure, leave it empty.

- Render only decorative visuals: soft shapes, gentle gradients, simple icons/illustrations or 3D objects, subtle texture.
- Keep the LEFT ~60% calm, simple, and low-detail (mostly the background color) so text can be placed there later and stay readable. Put any richer visuals toward the RIGHT side.
- Dominant fill color exactly ${backgroundColor}. Accent details in ${accentColor}. Clean, uncluttered, premium.
- Selected style: ${templateName || 'Template 1'}.${templateDirection ? ` ${templateDirection}` : ''}
- Vary the composition and decoration so each background looks distinct.`;
}

function buildPrompt({
    form = {},
    backgroundOnly,
    baseCompositionDataUrl,
    brandCorner,
    imageDataUrl,
    imageDataUrls,
    logoDataUrl,
    rawText = '',
    referenceLibraryImageDataUrls,
    campaignStyleReferenceImageDataUrls,
    seriesStyleReferenceImageDataUrls,
    categoryDirective,
    styleDirective,
    templateDirection,
    templateName,
    bannerSize,
}: GenerateCardImagePayload) {
    const width = bannerSize?.width || 1254;
    const height = bannerSize?.height || 1254;
    const isSquare = width === height;
    const formatName = bannerSize?.name || (isSquare ? 'square card banner' : 'bottom banner');

    if (backgroundOnly) {
        return buildBackgroundPrompt(
            { form, templateDirection, templateName },
            width,
            height,
            formatName,
        );
    }

    if (baseCompositionDataUrl) {
        return buildRefinePrompt(
            {
                bannerSize,
                baseCompositionDataUrl,
                form,
            },
            width,
            height,
            formatName,
        );
    }
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

    const styleDirection = styleDirective
        ? `
PRIMARY LAYOUT DIRECTION (must follow):
- ${styleDirective}
- Build the whole composition around this layout archetype instead of defaulting to a generic centered card template.
- Vary the composition, spacing, decorative motifs, and visual arrangement to match this direction. Keep the Korean text exact and the required colors as specified.`
        : '';

    const logoReservationDirection = logoDataUrl
        ? `\n- A small brand logo will be composited into the TOP-RIGHT corner AFTER generation. Keep that small top-right area calm and uncluttered: no title, body text, icons, numbers, or important graphics there.
- Do NOT paint a solid color block, white box, plate, badge, border, or frame in that corner. Let the normal card background continue there so a transparent logo can sit cleanly on top.
- Keep the title and body in the left/lower area with a normal tight margin. Do NOT leave a large empty band.`
        : '';

    const usageLabel = isSquare ? '광고 썸네일' : '가로형 배너';
    const cornerKo =
        brandCorner === 'top-right'
            ? '우측 상단'
            : brandCorner === 'top-center'
              ? '상단 중앙'
              : '좌측 상단';
    const brandLine =
        logoDataUrl || form.badge
            ? `${cornerKo} 모서리에 브랜드(로고/브랜드명)가 들어갈 작은 빈 자리만 비워두기 (그 자리엔 글자·그림·아이콘을 넣지 말 것 — 브랜드는 생성 후 고정 위치에 합성됨). 메인 제목과 본문은 그 아래·왼쪽 영역에 배치.`
            : `${cornerKo} 모서리는 단정하게 비우기`;
    const subtitleLine = form.subtitle ? `\n· 본문: ${form.subtitle}` : '';
    const emphasisLine = form.emphasis
        ? `\n· 강조 문구(포인트 컬러로 가장 눈에 띄게, 필요하면 박스나 배지 안에): ${form.emphasis}`
        : '';
    const ctaLine = form.cta ? `\n· 하단 CTA: 검정색 바 안에 흰 글씨로 '${form.cta}'` : '';
    const templateLine = templateDirection ? `\n- 스타일: ${templateDirection}` : '';
    const styleLine = styleDirective ? `\n- 레이아웃 방향: ${styleDirective}` : '';
    const categoryMoodBlock = categoryDirective
        ? `\n[업종·분위기 가이드 — 색감/이미지 무드에만 반영. 아래 영문 설명은 절대 이미지에 글자로 넣지 말 것]\n- ${categoryDirective}\n`
        : '';

    return `한국어 ${usageLabel}을(를) 만들어줘. 깔끔하고 신뢰감 있는 마케팅 디자인, 광고 클릭을 유도하는 구조.

[색상]
배경은 ${form.backgroundColor || '#ffffff'} 계열, 강조(포인트) 색은 ${form.accentColor || '#1457ff'}, 본문 글자색은 ${form.textColor || '#111827'}. 강한 대비로 핵심이 한눈에 들어오게.

[브랜드]
${brandLine}.
${categoryMoodBlock}
[들어갈 한글 텍스트 — 아래 문구를 철자와 띄어쓰기 그대로, 글자 깨짐 없이 정확히 렌더]
· 메인 제목(가장 크고 굵게): ${form.title || ''}${subtitleLine}${emphasisLine}${ctaLine}

[디자인 규칙]
- 굵고 가독성 높은 한글 타이포그래피. 핵심 문구가 한눈에 보이게.
- 위에 적은 한글만 정확히 넣고, 그 외 영어 라벨·캡션·워터마크는 넣지 마.
- 과하게 복잡하지 않게, 여백과 대비로 깔끔하게.${templateLine}${styleLine}

[캔버스]
${width}x${height}px. 가장자리까지 꽉 채우고 네 모서리는 완전한 직각(둥근 모서리·테두리·여백 금지). ${isSquare ? '정사각형 구성.' : '가로로 넓은 배너 구성.'}`;
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

function getBaseCompositionImages(
    payload: Pick<GenerateCardImagePayload, 'baseCompositionDataUrl'>,
): string[] {
    return payload.baseCompositionDataUrl ? [payload.baseCompositionDataUrl] : [];
}

function getReferenceImages(
    payload: Pick<GenerateCardImagePayload, 'imageDataUrl' | 'imageDataUrls'>,
): string[] {
    return Array.isArray(payload.imageDataUrls)
        ? payload.imageDataUrls.filter(isNonEmptyString).slice(0, 1)
        : [payload.imageDataUrl].filter(isNonEmptyString).slice(0, 1);
}

function getSeriesStyleReferenceImages(
    payload: Pick<GenerateCardImagePayload, 'seriesStyleReferenceImageDataUrls'>,
): string[] {
    return Array.isArray(payload.seriesStyleReferenceImageDataUrls)
        ? payload.seriesStyleReferenceImageDataUrls.filter(isNonEmptyString).slice(0, 1)
        : [];
}

function getCampaignStyleReferenceImages(
    payload: Pick<GenerateCardImagePayload, 'campaignStyleReferenceImageDataUrls'>,
): string[] {
    return Array.isArray(payload.campaignStyleReferenceImageDataUrls)
        ? payload.campaignStyleReferenceImageDataUrls.filter(isNonEmptyString).slice(0, 1)
        : [];
}

function getReferenceLibraryImages(
    payload: Pick<GenerateCardImagePayload, 'referenceLibraryImageDataUrls'>,
): string[] {
    return Array.isArray(payload.referenceLibraryImageDataUrls)
        ? payload.referenceLibraryImageDataUrls.filter(isNonEmptyString).slice(0, 3)
        : [];
}

async function generateOpenAiCardImage(payload: GenerateCardImagePayload, env: FunctionContext['env']) {
    const apiKey = env.OPENAI_API_KEY;
    const outputSize = payload.bannerSize?.id === 'bottom' ? '1536x1024' : '1024x1024';

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
    const requestedQuality = payload.imageQuality || env.OPENAI_IMAGE_QUALITY || 'medium';
    const quality = ['low', 'medium', 'high'].includes(requestedQuality)
        ? requestedQuality
        : 'medium';

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

    [
        ...getBaseCompositionImages(payload),
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

    // GPT-5.5(추론 모델) + image_generation 툴 경로 — 한글 렌더 품질이 직접 호출보다 좋다.
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
                    quality,
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
        return jsonResponse(
            {
                message:
                    result?.error?.message || 'OpenAI 응답에서 생성 이미지를 찾지 못했습니다.',
            },
            502,
        );
    }

    const imageDataUrl = await finalizeImageDataUrl(`data:image/png;base64,${imageBase64}`, payload);

    return jsonResponse({
        imageDataUrl,
        prompt,
        usage: result.usage ?? null,
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

    [
        ...getBaseCompositionImages(payload),
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

    const imageDataUrl = await finalizeImageDataUrl(
        `data:${inlineData.mimeType || inlineData.mime_type || 'image/png'};base64,${
            inlineData.data
        }`,
        payload,
    );

    return jsonResponse({
        imageDataUrl,
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
