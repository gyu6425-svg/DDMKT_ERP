import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
// 순위 즉시검색 파서(단일소스 — Cloudflare 함수와 동일 파일 공유).
import { rankInPopular, rankInBlogtab, TI_URL, BL_URL, MOBILE_UA, OUT_OF_RANK } from '../functions/lib/naverRank.mjs';
import {
    parseRss,
    deriveKeyword,
    extractHashtagsFromHtml,
    parseBlogUrl,
    extractLogNo,
    todayKST,
    upsertToday,
    sbGet,
    sbInsert,
    sbPatch,
} from '../functions/lib/crawlLib.mjs';

// dev 용 crawl-blog — Cloudflare crawl-blog.ts 와 동일 로직(헬퍼 공유). env 는 process.env(.env 로드됨).
async function crawlBlogLocal({ blogAccountId }) {
    const env = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY };
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
        return { statusCode: 500, body: { error: '.env 에 SUPABASE_URL / SUPABASE_SERVICE_KEY 필요' } };
    }
    blogAccountId = (blogAccountId || '').trim();
    if (!blogAccountId) return { statusCode: 400, body: { error: 'blogAccountId 필요' } };
    const today = todayKST();
    const errors = [];
    const get = async (url) => {
        try {
            const r = await fetch(url, { headers: { 'User-Agent': MOBILE_UA } });
            return r.status === 200 ? await r.text() : null;
        } catch {
            return null;
        }
    };
    // 분할 측정 — Cloudflare crawl-blog.ts 와 동일. 한 요청당 글 MEASURE_BATCH개(오늘 미측정/실패분, 최신 우선).
    const MEASURE_BATCH = 5;
    const THROTTLE_MS = 300;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const needsMeasure = (ms) => {
        const rec = (Array.isArray(ms) ? ms : []).find((m) => m && m.date === today);
        if (!rec) return true;
        return rec.ti_status === 'fail' || rec.bl_status === 'fail';
    };
    const measureOne = async (url, parse) => {
        const h = await get(url);
        let r = h ? parse(h) : { rank: OUT_OF_RANK, status: 'fail' };
        if (r.status === 'fail') {
            await sleep(700);
            const h2 = await get(url);
            r = h2 ? parse(h2) : { rank: OUT_OF_RANK, status: 'fail' };
        }
        return r;
    };
    const measure = async (kw, blogId, logNo) => {
        const tp = await measureOne(TI_URL(kw), (h) => rankInPopular(h, blogId));
        const bp = await measureOne(BL_URL(kw), (h) => rankInBlogtab(h, blogId, logNo));
        return { ti: tp.rank, ti_status: tp.status, bl: bp.rank, bl_status: bp.status };
    };
    try {
        const accs = await sbGet(env, 'blog_accounts', { id: `eq.${blogAccountId}`, select: '*' });
        if (!accs.length) return { statusCode: 404, body: { error: '블로그 없음' } };
        const acc = accs[0];
        const blogId = acc.blog_id || parseBlogUrl(acc.blog_url || '')[0];
        if (!blogId) return { statusCode: 400, body: { error: 'blog_id 없음' } };
        let postsMeasured = 0;
        let postsRemaining = 0;
        const rss = await get(`https://rss.blog.naver.com/${blogId}.xml`);
        if (!rss) errors.push('RSS 실패');
        else {
            const items = parseRss(rss, 15).filter((p) => p.url);
            const rows = items.map((p) => ({
                blog_account_id: blogAccountId,
                post_url: p.url,
                title: p.title,
                keyword: deriveKeyword(p.title, p.tags || []),
                published_date: p.published_date,
            }));
            const up = rows.length ? await sbInsert(env, 'blog_posts', rows, 'blog_account_id,post_url') : [];
            // 수동 지정 키워드(keyword_manual) 우선. 오늘 성공 측정 없는 글만 최신순으로 MEASURE_BATCH개.
            const pending = up
                .filter((p) => (p.keyword_manual || p.keyword || '').trim() && needsMeasure(p.measurements))
                .sort((a, b) => String(b.published_date || '').localeCompare(String(a.published_date || '')));
            postsRemaining = Math.max(0, pending.length - MEASURE_BATCH);
            for (const post of pending.slice(0, MEASURE_BATCH)) {
                const logNo = extractLogNo(post.post_url || '');
                let kw = (post.keyword_manual || post.keyword || '').trim();
                let kwChanged = false;
                if (!post.keyword_manual) {
                    const phtml = await get(`https://m.blog.naver.com/${blogId}/${logNo}`);
                    const derived = deriveKeyword(post.title || '', phtml ? extractHashtagsFromHtml(phtml) : []).trim();
                    if (derived && derived !== kw) {
                        kw = derived;
                        kwChanged = true;
                    }
                }
                const r = await measure(kw, blogId, logNo);
                const recs = upsertToday(post.measurements, { date: today, ...r }, today);
                await sbPatch(env, 'blog_posts', { id: `eq.${post.id}` }, kwChanged ? { measurements: recs, keyword: kw } : { measurements: recs });
                postsMeasured++;
                await sleep(THROTTLE_MS);
            }
        }
        let keywordsMeasured = 0;
        const kws = await sbGet(env, 'blog_keywords', { blog_account_id: `eq.${blogAccountId}`, select: '*' });
        for (const row of kws.slice(0, 3)) {
            const kw = (row.keyword || '').trim();
            if (!kw || !needsMeasure(row.measurements)) continue;
            const r = await measure(kw, blogId, '');
            await sbPatch(env, 'blog_keywords', { id: `eq.${row.id}` }, { measurements: upsertToday(row.measurements, { date: today, ...r }, today) });
            keywordsMeasured++;
            await sleep(THROTTLE_MS);
        }
        return { statusCode: 200, body: { blogAccountId, blogId, postsMeasured, postsRemaining, keywordsMeasured, errors } };
    } catch (e) {
        return { statusCode: 500, body: { error: e instanceof Error ? e.message : '크롤 오류', errors } };
    }
}

async function measureRankLocal({ keyword, blogId, logNo = '' }) {
    keyword = (keyword || '').trim();
    blogId = (blogId || '').trim();
    if (!keyword || !blogId) {
        return { statusCode: 400, body: { error: 'keyword, blogId 가 필요합니다' } };
    }
    const get = async (url) => {
        try {
            const r = await fetch(url, { headers: { 'User-Agent': MOBILE_UA } });
            return r.status === 200 ? await r.text() : null;
        } catch {
            return null;
        }
    };
    // 파싱 실패(네이버 일시차단/빈응답)면 잠깐 쉬고 1회 재시도.
    const measureOne = async (url, parse) => {
        const h = await get(url);
        let r = h ? parse(h) : { rank: OUT_OF_RANK, status: 'fail' };
        if (r.status === 'fail') {
            await new Promise((res) => setTimeout(res, 1500));
            const h2 = await get(url);
            r = h2 ? parse(h2) : { rank: OUT_OF_RANK, status: 'fail' };
        }
        return r;
    };
    const ti = await measureOne(TI_URL(keyword), (h) => rankInPopular(h, blogId));
    const bl = await measureOne(BL_URL(keyword), (h) => rankInBlogtab(h, blogId, logNo));
    return {
        statusCode: 200,
        body: { keyword, blogId, ti: ti.rank, ti_status: ti.status, bl: bl.rank, bl_status: bl.status },
    };
}

const PORT = Number(process.env.OPENAI_LOCAL_API_PORT || 8787);
const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
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

function getBaseCompositionImages(payload) {
    return payload.baseCompositionDataUrl ? [payload.baseCompositionDataUrl] : [];
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
    const padding = 24;
    const width = box.x + box.width + padding;
    const height = box.y + box.height + padding;

    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(fillColor)}"/>
</svg>`);
}

async function finalizeImageDataUrl(imageDataUrl, payload) {
    // 클라이언트가 리사이즈/커버/로고를 모두 합성하므로 서버 후처리(sharp)를 건너뛴다(지연·끊김 방지).
    if (payload.backgroundOnly || payload.skipServerLogoOverlay) {
        return imageDataUrl;
    }

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

function buildBackgroundPrompt(form = {}, width, height, formatName, templateName, templateDirection) {
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

function buildRefinePrompt(form = {}, width, height, formatName) {
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

function buildPrompt({
    backgroundOnly,
    bannerSize,
    baseCompositionDataUrl,
    brandCorner,
    customPrompt,
    campaignStyleReferenceImageDataUrls,
    campaignConsistency = 'exact',
    referenceUsage = 'recreate',
    categoryDirective,
    form,
    imageDataUrl,
    imageDataUrls,
    logoDataUrl,
    rawText,
    referenceLibraryImageDataUrls,
    seriesStyleReferenceImageDataUrls,
    styleDirective,
    templateDirection,
    templateName,
}) {
    const width = bannerSize?.width || 1254;
    const height = bannerSize?.height || 1254;
    const isSquare = width === height;
    const formatName = bannerSize?.name || (isSquare ? 'square card banner' : 'bottom banner');

    if (backgroundOnly) {
        return buildBackgroundPrompt(form, width, height, formatName, templateName, templateDirection);
    }

    if (baseCompositionDataUrl) {
        return buildRefinePrompt(form, width, height, formatName);
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
        ? referenceUsage === 'product'
            ? `- ${referenceImages.length} reference image(s) were uploaded, and they are REAL PRODUCT PHOTOS of the actual product being advertised.
- PRESERVE the uploaded product faithfully and treat it as the genuine hero of this ad — exactly like a real product advertisement where the real photographed product is the main visual.
- Do NOT redraw, repaint, re-render, recolor, restyle, relight, smooth, "improve", or replace the product. Do NOT invent a different or similar-looking product, variant, size, or cap. Keep its EXACT shape, proportions, materials, finish, colors, and all label/packaging text and logos unchanged — do not change, translate, add, or remove any text on the packaging.
- Keep it photographic. Do NOT turn it into an illustration, 3D render, cartoon, or stylized version.
- The product must look like the SAME real photograph, just placed into the new ad — not an AI re-drawing.
- Integrate it naturally so it does NOT look pasted, cut-out, or like a sticker: match the lighting direction and color temperature between product and background, add a soft realistic contact shadow / gentle reflection, and blend edges cleanly into a cohesive scene. The product and background should feel photographed together in one shot.
- Build the advertisement layout AROUND the product: Korean copy in a clean text area beside or below it, with a tasteful background and light decorations and strong contrast so both product and text read clearly. Keep the product prominent, fully visible, and uncropped.
- Keep the TOP-RIGHT corner area clear and calm for a brand logo composited later.
- (업로드된 이미지는 실제 광고할 '실사 제품 사진'이다. 절대 다시 그리거나 재해석하지 말고 사진 원본 그대로 — 모양·비율·재질·라벨/패키지 글자·색·디테일 100% 동일 — 광고의 주인공으로 사용한다. 일러스트·3D·만화·스타일 변형 금지, 비슷한 다른 제품으로 바꾸지 말 것. '붙인/누끼 스티커' 느낌이 나지 않게: 제품과 배경의 빛 방향·색온도를 맞추고, 부드러운 접지 그림자/은은한 반사를 넣어 한 장면에서 함께 촬영된 것처럼 자연스럽게 융화시킨다. 한글 문구·배경·장식은 제품을 돋보이게 하는 보조로 그 주위에 배치하고, 우측 상단 모서리는 로고를 위해 비워둔다.)`
            : `- ${referenceImages.length} reference image(s) were uploaded.
- Use uploaded images as visual references, not as exact screenshots.
- Combine the main subject, mood, colors, and context naturally.
- Do not create a collage unless the copy clearly requires it.
- Recompose the visual naturally; remove or simplify messy background if helpful.`
        : `- No source image was uploaded. Create a suitable original visual from the Korean copy.
- Choose clean, relevant card-news imagery such as abstract medical/education/product/service visuals, icons, soft shapes, or professional scene elements.
- Do not invent real people, certificates, or institution marks unless explicitly provided in the copy.
- Keep generated visuals secondary to readable Korean typography.`;
    const campaignStyleDirection = !campaignStyleReferenceImages.length
        ? ''
        : campaignConsistency === 'style'
          ? `
[캠페인 무드 — 유사 무드(그림체·컬러만 유지)] 먼저 이 카드의 한글 문구에 어울리는 '완전히 새로운 장면'을 구상해서 그린다. 첨부된 '기준 카드' 이미지는 오직 '그림체(렌더링 방식)와 컬러(색감)'를 맞추기 위한 무드보드로만 사용하고, 그 안의 장면·인물·사물·구도·텍스트·레이아웃은 절대 따라 그리지 않는다:
- 그림체: 기준 카드의 일러스트/사진 렌더링 처리(선·외곽선, 음영·명암, 질감, 마감 톤)를 똑같이.
- 컬러: 배경색·강조(포인트)색·텍스트색을 포함한 전체 색 팔레트와 색 분위기를 똑같이(위에 지정된 색을 우선 따른다).
- 장면·소재·인물·구도·카메라 앵글·레이아웃은 기준 카드와 '다르게' 새로 만든다. 같은 인물/사물/배치를 재사용하지 말 것.
- 우측 상단 모서리는 비워둔다(브랜드 로고가 나중에 합성됨): 그 영역에 중요한 피사체·글자를 두지 말 것.
- 베끼지 말고, '같은 붓·같은 색으로 그린 다른 그림'처럼 보이게 한다.
(Create a BRAND-NEW scene for THIS card's Korean copy first. Use the attached reference ONLY as a color-and-rendering-style mood board — match its art style (line/outline, shading, texture, finish) and color palette only. Do NOT copy its subject, people, objects, composition, text, or layout. Invent a different subject, composition, and camera angle. Keep the top-right corner clear for a logo composited later. It must look like a DIFFERENT picture painted with the same brush and colors.)`
          : `
[디자인 통일성 — 매우 중요] 첨부된 '기준 카드(디자인 마스터)' 이미지와 똑같은 디자인 시스템으로 만들 것. 한글 문구(내용)만 이번 카드의 것으로 바꾸고, 디자인은 그대로 복제한다:
- 제목·본문·강조 텍스트의 글꼴(서체) 종류, 글자 굵기, 상대적 글자 크기 비율을 기준 카드와 똑같이.
- 글자색·강조(포인트)색·배경색을 기준 카드와 똑같이.
- 자간·행간, 정렬, 여백 리듬, 장식 요소·아이콘 스타일, 전체 톤을 똑같이.
- 새 디자인을 만들지 말고 기준 카드의 '내용만 바뀐 변형'처럼 보이게 한다.
(Match the attached design-master card EXACTLY: same font family, font weights, relative type sizes, text/accent/background colors, spacing and decorative style. Only the Korean copy changes — do not redesign.)`;
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
            ? `${cornerKo} 모서리의 작은 영역은 생성 후 브랜드가 코드로 따로 합성될 자리다. 그 자리에는 제목·본문·아이콘·중요한 그래픽을 넣지 말고, 박스·테두리·프레임·플레이트·배지·사각 칸도 절대 그리지 말며 배경색만 그대로 이어지게 둘 것. 또한 어떤 브랜드명·회사명·로고 글자도 그 자리든 이미지 어디에든 새로 그려 넣지 말 것 — 브랜드는 오직 코드 합성으로만 들어간다. 제목·본문·강조 한글만 그 아래·왼쪽 영역에 배치. (Do NOT draw any box/plate/frame/border there, and do NOT render ANY brand name, company name, or logo lettering anywhere in the image — the brand is composited separately by code. Render only the given title/body/emphasis Korean copy.)`
            : '';
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

${brandLine ? `[브랜드]\n${brandLine}.\n` : ''}${categoryMoodBlock}
[들어갈 한글 텍스트 — 아래 문구를 철자와 띄어쓰기 그대로, 글자 깨짐 없이 정확히 렌더]
· 메인 제목(가장 크고 굵게): ${form.title || ''}${subtitleLine}${emphasisLine}${ctaLine}

[이미지 활용]
${imageDirection}

[디자인 규칙]
- 굵고 가독성 높은 한글 타이포그래피. 핵심 문구가 한눈에 보이게.
- ⚠️ 모든 한글은 반드시 가로쓰기. 세로쓰기·글자 회전·세로로 한 글자씩 쪼개 배치 절대 금지(가독성 최우선). 사이드 세로 띠에 글자를 세워 넣지 말 것.
- 현대적이고 깔끔한 전문 편집 디자인: 명확한 위계, 넉넉한 여백, 정돈된 구성. 조잡한 클립아트풍·과밀 배치 금지. (예: 좌측 굵은 헤드라인 + 한쪽에 깔끔한 사진/그래픽 균형)
- 강조 문구는 포인트 컬러의 둥근 하이라이트 박스(알약형 배지) 안에 넣어 또렷하게.
- 위에 적은 한글만 정확히 넣고, 그 외 영어 라벨·캡션·워터마크는 넣지 마.
${referenceUsage === 'product' && referenceImages.length ? `- 첨부된 제품 사진의 라벨·패키지 글자·로고는 '제품의 일부'이므로 원본 그대로 유지한다(지우거나 바꾸거나 새로 만들지 말 것). 단, 그 글자를 배너의 제목/마케팅 문구로 따로 키워 렌더하지는 말 것 — 배너에 들어가는 문구는 오직 위 [들어갈 한글 텍스트]뿐이다. (Keep the product's own on-package label/text/logo exactly as in the photo — do not erase, change, or regenerate it — but do not turn that on-package text into the banner's headline/marketing copy.)` : `- 첨부된 참고/기준 이미지가 있어도 그 안의 글자·로고·브랜드명·회사명·간판 문구는 절대 따라 그리거나 재현하지 마. 이미지는 피사체·구도·색감·분위기 참고로만 쓰고, 화면에 들어가는 글자는 오직 위 [들어갈 한글 텍스트]뿐이다. (Do NOT copy or recreate any text, letters, logo, or brand/company name from any attached reference/master image — use it only for subject, composition, color, and mood.)`}
- 과하게 복잡하지 않게, 여백과 대비로 깔끔하게.${templateLine}${styleLine}
${campaignStyleDirection}
[캔버스]
${width}x${height}px. 가장자리까지 꽉 채우고 네 모서리는 완전한 직각(둥근 모서리·테두리·여백 금지). ${isSquare ? '정사각형 구성.' : '가로로 넓은 배너 구성.'}`;
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
    const requestedQuality = payload.imageQuality || process.env.OPENAI_IMAGE_QUALITY || 'medium';
    const quality = ['low', 'medium', 'high'].includes(requestedQuality)
        ? requestedQuality
        : 'medium';
    rememberRequest({
        hasImage: getReferenceImages(payload).length > 0,
        id: requestId,
        model,
        provider: 'openai',
        quality,
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

    const requestBody = JSON.stringify({
        input: [{ content, role: 'user' }],
        model,
        tools: [{ quality, size: outputSize, type: 'image_generation' }],
    });

    // 추론모델(gpt-5.5)이 간헐적으로 이미지를 안 내거나(추론만 하고 종료) 일시 오류(429/5xx)면 1회 더 시도.
    let imageBase64 = '';
    let lastResult = null;
    const MAX_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        let openaiResponse;
        try {
            openaiResponse = await fetch(OPENAI_API_URL, {
                body: requestBody,
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

        lastResult = await readJsonResponse(openaiResponse);

        if (!openaiResponse.ok) {
            if ((openaiResponse.status === 429 || openaiResponse.status >= 500) && attempt < MAX_ATTEMPTS) {
                continue;
            }
            rememberRequest({
                elapsedMs: Date.now() - startedAt,
                id: requestId,
                message: lastResult?.error?.message || 'OpenAI request failed',
                openaiStatus: openaiResponse.status,
                status: 'error',
            });
            return {
                body: {
                    message: lastResult?.error?.message || 'OpenAI 이미지 생성 요청에 실패했습니다.',
                },
                statusCode: openaiResponse.status,
            };
        }

        const imageOutput = lastResult.output?.find((item) => item.type === 'image_generation_call');
        imageBase64 = imageOutput?.result || '';
        if (imageBase64) {
            break;
        }
        // 이미지 없음 → 다음 attempt 에서 재시도
    }

    const elapsedMs = Date.now() - startedAt;

    if (!imageBase64) {
        const reason = lastResult?.incomplete_details?.reason || lastResult?.status || '';
        rememberRequest({
            elapsedMs,
            id: requestId,
            message: `No image in response${reason ? ` (${reason})` : ''}`,
            status: 'error',
        });
        return {
            body: {
                message:
                    lastResult?.error?.message ||
                    `재시도 후에도 이미지를 받지 못했습니다${reason ? ` (사유: ${reason})` : ''}. 잠시 후 다시 시도하거나 입력 문구를 줄여보세요.`,
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
            usage: lastResult.usage || null,
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

const BLOG_LENGTH_GUIDE = {
    long: '2000~2800자 분량으로 깊이 있게',
    medium: '1200~1800자 분량으로',
    short: '600~900자 분량으로 간결하게',
};
const BLOG_TONE_GUIDE = {
    info: '정보 전달 중심의 전문적이고 신뢰감 있는',
    promo: '구매·문의를 유도하는 설득력 있는 홍보',
    review: '실제 사용 후기처럼 생생하고 친근한',
    story: '스토리텔링으로 몰입감 있게 풀어가는',
};

function buildBlogPrompt(payload) {
    const topic = (payload.topic || '').trim();
    const industry = (payload.industry || '').trim();
    const audience = (payload.audience || '').trim();
    const keywords = (payload.keywords || '').trim();
    const lengthGuide = BLOG_LENGTH_GUIDE[payload.length || 'medium'] || BLOG_LENGTH_GUIDE.medium;
    const toneGuide = BLOG_TONE_GUIDE[payload.tone || 'info'] || BLOG_TONE_GUIDE.info;

    return [
        '너는 한국어 블로그/SEO 카피라이터다. 아래 조건으로 네이버 블로그에 올릴 한국어 글을 작성해줘.',
        '',
        `[주제] ${topic}`,
        industry ? `[업종] ${industry}` : '',
        audience ? `[타깃 독자] ${audience}` : '',
        keywords ? `[반드시 자연스럽게 포함할 키워드] ${keywords}` : '',
        `[톤] ${toneGuide} 어조`,
        `[분량] ${lengthGuide}`,
        '',
        '요구사항(순서대로):',
        '- 첫 줄 "제목 후보:" 에 클릭을 부르는 제목 3개를 1) 2) 3) 으로 제시.',
        '- 다음 줄에 그중 가장 좋은 하나를 "제목: ..." 형식으로 작성.',
        '- 제목 아래 2~3문장의 도입부(요약)로 시작하고, 핵심 키워드를 도입부 첫 문장에 자연스럽게 포함(네이버는 첫 문장을 검색 미리보기로 노출).',
        '- 본문은 2~4개의 소제목(■ 로 시작)으로 구조화하고, 소제목 사이에 "(이미지)" 표시로 이미지 들어갈 위치를 제안.',
        '- 핵심 키워드를 제목·도입부·본문에 총 3~5회 자연스럽게 배치(과도한 반복 금지, SEO).',
        '- 과장·허위 표현은 피하고 신뢰감 있게.',
        '- 마지막에 문의/방문을 유도하는 한 문장 CTA.',
        '- 그 다음 줄에 "[요약]" 으로 시작하는 80~100자 한 줄 요약(검색 설명용).',
        payload.includeHashtags === false ? '' : '- 글 맨 끝에 관련 해시태그 8~12개(#로 시작, 한 줄).',
        '',
        '마크다운 기호(**, ## 등)는 쓰지 말고 순수 텍스트로 출력해줘.',
    ]
        .filter((line) => line !== '')
        .join('\n');
}

function extractOutputText(result) {
    if (typeof result.output_text === 'string' && result.output_text.trim()) {
        return result.output_text.trim();
    }
    const parts = [];
    (result.output || []).forEach((item) => {
        (item.content || []).forEach((content) => {
            if (content.type === 'output_text' && typeof content.text === 'string') {
                parts.push(content.text);
            }
        });
    });
    return parts.join('').trim();
}

async function generateBlog(payload) {
    if (!payload.topic || !payload.topic.trim()) {
        return { body: { message: '주제를 입력해주세요.' }, statusCode: 400 };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return { body: { message: '.env 의 OPENAI_API_KEY 가 필요합니다.' }, statusCode: 500 };
    }

    const model = process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_IMAGE_MODEL || 'gpt-5.5';
    const prompt = buildBlogPrompt(payload);

    const apiResponse = await fetch(OPENAI_API_URL, {
        body: JSON.stringify({ input: prompt, model }),
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        method: 'POST',
    });

    const result = await readJsonResponse(apiResponse);
    rememberRequest({ ok: apiResponse.ok, route: 'generate-blog', status: apiResponse.status });

    if (!apiResponse.ok) {
        return {
            body: { message: result?.error?.message || '블로그 생성에 실패했습니다.' },
            statusCode: apiResponse.status,
        };
    }

    const text = extractOutputText(result);
    if (!text) {
        return { body: { message: '생성된 글이 비어 있습니다.' }, statusCode: 502 };
    }

    return { body: { prompt, text, usage: result.usage ?? null }, statusCode: 200 };
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

    if (request.method === 'POST' && request.url === '/api/generate-blog') {
        try {
            const payload = await readJsonBody(request);
            const result = await generateBlog(payload);
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

    if (request.method === 'POST' && request.url === '/api/crawl-blog') {
        try {
            const payload = await readJsonBody(request);
            const result = await crawlBlogLocal(payload);
            sendJson(response, result.statusCode, result.body);
        } catch (error) {
            sendJson(response, 500, { error: error instanceof Error ? error.message : '크롤 오류' });
        }
        return;
    }

    if (request.method === 'POST' && request.url === '/api/rank') {
        try {
            const payload = await readJsonBody(request);
            const result = await measureRankLocal(payload);
            sendJson(response, result.statusCode, result.body);
        } catch (error) {
            sendJson(response, 500, {
                error: error instanceof Error ? error.message : '순위 측정 오류',
            });
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

// 이미지 생성은 1~2분 이상 걸릴 수 있으므로 긴 요청 중 소켓이 끊기지 않도록 타임아웃을 해제한다.
server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;
server.keepAliveTimeout = 620000;

server.listen(PORT, '127.0.0.1', () => {
    console.log(`OpenAI card image API listening on http://127.0.0.1:${PORT}`);
});
