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
        const tp = await measureOne(TI_URL(kw), (h) => rankInPopular(h, blogId, logNo));
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
    const ti = await measureOne(TI_URL(keyword), (h) => rankInPopular(h, blogId, logNo));
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

// ── 카페 원고 자동생성(로컬) — functions/api/generate-cafe.ts 와 동일 로직 ──
function buildCafePrompt(payload) {
    const keyword = (payload.keyword || '').trim();
    const region = (payload.region || '').trim() || keyword.replace(/\s*누수탐지.*$/, '').trim() || keyword;
    const business = (payload.business || '누수탐지').trim();
    const brand = (payload.brand || '든든한 누수탐지').trim();
    return [
        `너는 한국 지역 서비스업 카드뉴스(카페 홍보글) 카피라이터다.`,
        `아래 업체의 "${keyword}" 홍보용 9장 카드뉴스 원고를 작성한다. 지역은 "${region}", 업종은 "${business}", 업체명은 "${brand}"이다.`,
        ``,
        `반드시 **JSON 객체 하나만** 출력한다(마크다운·코드펜스·설명 금지). 아래 키를 모두 채운다:`,
        `{`,
        `  "region": "지역명(예: ${region})",`,
        `  "coverSub": "상단 소제목(예: 수도권 ${business} 전문)",`,
        `  "coverTitle": "브랜드 큰제목(예: ${brand}) — 공백 1개로 두 줄 표기됨",`,
        `  "coverEmphasisPre": "물이 새는", "coverEmphasisHi": "강조 구절(예: 지금이 가장 저렴하게)", "coverEmphasisPost": "해결할 수 있는 순간입니다", "coverCta": "24시간 출동 가능",`,
        `  "situations": ["고객이 겪는 상황 3개(한 줄, 20자 내외)"] , "situationWarn": "경고 한 줄",`,
        `  "damages": [{"period":"하루","text":"..."},{"period":"일주일","text":"..."},{"period":"한 달","text":"..."}], "damagePunch1": "지금이", "damagePunch2": "가장 저렴한 순간",`,
        `  "wayIntroPre": "누수는", "wayIntroHi": "보이지 않는 원인 부위들을 · 로 나열", "wayIntroPost": "처럼 보이지 않는 곳에서 생기는 경우가 훨씬 많습니다. 그래서 저희는,",`,
        `  "waySteps": ["진단 원칙 3개(한 줄)"] , "wayFooter": "필요한 경우에만 공사를 안내드립니다",`,
        `  "checklist": ["바로 점검이 필요한 증상 7개(한 줄, 15자 내외)"] ,`,
        `  "whyIntroPre": "같은 ${business}라도", "whyIntroHi": "언제 발견하느냐", "whyIntroPost": "에 따라 결과가 완전히 달라집니다.", "whyEarlyLabel": "초기에 발견하면", "whyEarly": "간단한 보수로 끝나는 경우가 많습니다", "whyLateLabel": "방치하면", "whyLate": "바닥 철거와 배관 교체까지 이어질 수 있습니다",`,
        `  "buildingTypes": ["건물 유형 4~5개"] , "leakTypes": ["누수 부위/종류 6~7개"] , "serviceFooter": "건물 유형 · 부위 관계없이 진단 가능",`,
        `  "faqs": [{"q":"질문?","a":"답변."}] (4개, 공사 강요 없음·최소 범위·아랫집 확인·보험처리),`,
        `  "promises": ["약속 항목 5개(한 줄)"] , "promiseClose1": "누수는 발견 시기가 가장 중요합니다.", "promiseClose2": "지금 확인하는 것이 가장 비용을 아끼는 방법입니다."`,
        `}`,
        ``,
        `규칙: 과장·허위 금지, 지역명 자연 반영, 담백하고 신뢰감 있게. 값은 순수 텍스트(이모지·마크다운 금지).`,
    ].join('\n');
}

function parseCafeJson(text) {
    const cleaned = String(text || '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
        return null;
    }
}

const REVIEW_TONES = {
    review: { name: '후기형', guide: '직접 경험한 사람이 후기를 공유하는 말투. 시작 예: "안녕하세요 :) 얼마 전 누수 때문에 든든한 누수탐지 불러봤는데, 정리해서 공유해야겠다 싶어 글 남깁니다."' },
    info: { name: '정보형', guide: '업체가 정보를 정리해 안내하는 말투. 시작 예: "안녕하세요, 든든한 누수탐지입니다. 상담을 진행하며 자주 받는 질문들을 중심으로 안내드립니다."' },
    story: { name: '스토리형', guide: '이야기를 풀어가는 말투. 시작 예: "처음엔 별것 아닌 것처럼 보입니다. 그런데 시간이 지나면 이야기가 달라지죠."' },
    talk: { name: '대화형', guide: '독자에게 질문을 던지며 대화하듯 이끄는 말투. 시작 예: "혹시 지금 이런 고민 하고 계신가요?"' },
    notice: { name: '공지형', guide: '간결한 브리핑/공지 말투. 핵심만 짧게, 군더더기 없이 항목 위주로.' },
};

function buildReviewPrompt(payload) {
    const keyword = (payload.keyword || '').trim();
    const region = (payload.region || '').trim() || keyword.replace(/\s*누수탐지.*$/, '').trim() || keyword;
    const business = (payload.business || '누수탐지').trim();
    const brand = (payload.brand || '든든한 누수탐지').trim();
    const branch = (payload.branch || '').trim();
    const phone = (payload.phone || '').trim();
    const c = payload.content || {};
    const arr = (k) => (Array.isArray(c[k]) ? c[k].map(String) : []);
    const material = [
        `상황: ${arr('situations').join(' / ')}`,
        `자가점검: ${arr('checklist').join(' / ')}`,
        `진단원칙: ${arr('waySteps').join(' / ')}`,
        `서비스: ${arr('buildingTypes').join(' ')} / ${arr('leakTypes').join(' ')}`,
        `약속: ${arr('promises').join(' / ')}`,
        Array.isArray(c.faqs) ? `FAQ: ${c.faqs.map((f) => `${f.q}→${f.a}`).join(' / ')}` : '',
    ].filter(Boolean).join('\n');
    const tone = REVIEW_TONES[payload.tone || 'review'] || REVIEW_TONES.review;
    const count = Math.max(1, Math.min(9, Number(payload.count) || 9));
    return [
        `너는 네이버 카페 지역글 전문 카피라이터다. 아래 업체의 "${keyword}" 홍보를 위한 카페 본문을 **[${tone.name}]** 문체로 쓴다.`,
        `업체명 "${brand} ${branch}", 지역 "${region}", 업종 "${business}", 전화 "${phone}".`,
        ``,
        `[문체 지시 · ${tone.name}] ${tone.guide}`,
        ``,
        `[반드시 지킬 형식]`,
        `- 위 문체를 유지하되 담백하고 자연스럽게. 과장·허위·별점·가짜 이름 금지.`,
        `- ${count}장의 카드 이미지가 함께 올라간다. 본문 흐름에 맞춰 「사진 1」 ~ 「사진 ${count}」 마커를 순서대로 각각 한 줄 단독으로 넣어라(정확히 ${count}개).`,
        `- 소제목(부제목): 「사진 N」 마커 바로 다음 줄에, 이어질 문단에 어울리는 소제목을 "부제목 : <내용>" 형식(한 줄 단독)으로 넣어라. 전부는 아니고 사진들 중 절반가량에만(질문형 "~일까요?" 과 핵심 혜택형을 섞어서). 그중 1~2개는 지역명(${region})+키워드를 자연스럽게 포함해 검색 노출에 도움되게. 첫 사진(사진 1)은 소제목 없이 인사말로 시작하고, 마지막 상담 유도 문장 바로 앞에도 마무리형 "부제목 : ..." 한 줄을 넣어라.`,
        `- 업체명과 전화(${phone})는 정확히 표기. 마지막에 상담 유도 한 줄. **분량 2000~2500자(공백 포함, 부제목 줄 제외)로 충분히 상세하게**. 마크다운·이모지 금지.`,
        ``,
        `[본문에 자연스럽게 녹일 소재]`,
        material,
        ``,
        `- 추가로 topics 배열(정확히 ${count}개, 순서 일치): topics[0]=업종("${business}"), 나머지는 각 사진 자리 핵심 주제 6~10자.`,
        `반드시 **JSON 객체 하나만** 출력(코드펜스·설명 금지): {"title":"제목 1개","body":"본문 전체(줄바꿈·「사진 N」 마커 포함)","topics":["${count}개"]}`,
    ].join('\n');
}

async function generateCafe(payload) {
    if (!payload?.keyword || !payload.keyword.trim()) {
        return { body: { message: '키워드를 입력해주세요.' }, statusCode: 400 };
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { body: { message: '.env 의 OPENAI_API_KEY 가 필요합니다.' }, statusCode: 500 };
    const model = process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_IMAGE_MODEL || 'gpt-5.5';
    const isReview = payload.mode === 'review';
    const prompt = isReview ? buildReviewPrompt(payload) : buildCafePrompt(payload);
    const apiResponse = await fetch(OPENAI_API_URL, {
        // reasoning effort 'low' — 후기 원고는 깊은 추론 불필요 → 추론 토큰(=출력가) 크게 절감.
        body: JSON.stringify({ input: prompt, model, reasoning: { effort: 'low' } }),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        method: 'POST',
    });
    const result = await readJsonResponse(apiResponse);
    rememberRequest({ ok: apiResponse.ok, route: 'generate-cafe', status: apiResponse.status });
    if (!apiResponse.ok) {
        return { body: { message: result?.error?.message || '원고 생성에 실패했습니다.' }, statusCode: apiResponse.status };
    }
    const parsed = parseCafeJson(extractOutputText(result));
    if (!parsed) return { body: { message: '생성 결과(JSON)를 해석하지 못했습니다. 다시 시도해 주세요.' }, statusCode: 502 };
    if (isReview) {
        return { body: { title: parsed.title ?? '', reviewBody: parsed.body ?? '', topics: Array.isArray(parsed.topics) ? parsed.topics : [], prompt, usage: result.usage ?? null }, statusCode: 200 };
    }
    return { body: { content: parsed, prompt, usage: result.usage ?? null }, statusCode: 200 };
}

// ── 카페 원본 이미지 글자 교체(로컬) — functions/api/generate-cafe-edit.ts 와 동일 ──
function splitCafeDataUrl(u) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(u || '');
    return m ? { mimeType: m[1], data: m[2] } : null;
}
function buildCafeEditPrompt(p) {
    const lines = [
        '첨부된 한국 지역 홍보 카드 이미지를 편집한다. 아래 지정한 "텍스트만" 교체하고,',
        '나머지(사진·배경·색·레이아웃·물방울/뱃지/바 등 그래픽 효과·다른 텍스트·요소 위치와 크기)는 100% 그대로 유지한다.',
        '',
        '[교체할 텍스트]',
    ];
    if (p.region) lines.push(`- 지역/동 이름 텍스트를 정확히 "${p.region}" 로 바꾼다.`);
    if (p.keyword) lines.push(`- 중앙의 가장 큰 제목 텍스트를 정확히 "${p.keyword}" 로 바꾼다.`);
    if (p.phone) lines.push(`- 전화번호를 정확히 "${p.phone}" 로 바꾼다.`);
    if (p.services) lines.push(`- 하단 서비스 태그 텍스트를 "${p.services}" 로 바꾼다.`);
    lines.push(
        '',
        '[규칙]',
        '- 모든 한글을 또렷하고 정확하게 렌더한다(오타·깨짐·영어 변환 금지).',
        '- 요소를 이동·재배치·재디자인하지 않는다. 사진을 바꾸지 않는다.',
        '- 워터마크·영어 캡션·설명 텍스트를 추가하지 않는다.',
        '- 지정한 텍스트만 바뀐, 원본과 동일한 이미지를 1장 출력한다.',
    );
    return lines.join('\n');
}
async function generateCafeEdit(p) {
    if (!p?.image) return { statusCode: 400, body: { message: '원본 이미지가 필요합니다.' } };
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { statusCode: 500, body: { message: '.env 의 GEMINI_API_KEY 가 필요합니다.' } };
    const img = splitCafeDataUrl(p.image);
    if (!img) return { statusCode: 400, body: { message: '이미지 형식 오류(dataURL 필요).' } };
    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash';
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: buildCafeEditPrompt(p) }, { inlineData: { data: img.data, mimeType: img.mimeType } }] }],
                generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
            }),
        },
    );
    const result = await readJsonResponse(res);
    rememberRequest({ ok: res.ok, route: 'generate-cafe-edit', status: res.status });
    if (!res.ok) {
        const m = res.status === 429 ? '무료 티어 요청 제한. 잠시 후 재시도.' : result?.error?.message || '이미지 편집 실패';
        return { statusCode: res.status, body: { message: m } };
    }
    const parts = result?.candidates?.[0]?.content?.parts || [];
    const ip = parts.find((pt) => pt?.inlineData?.data || pt?.inline_data?.data);
    const inline = ip?.inlineData || ip?.inline_data;
    if (!inline?.data) return { statusCode: 502, body: { message: 'Gemini 응답에 편집 이미지가 없습니다. 다시 시도해 주세요.' } };
    const mime = inline.mimeType || inline.mime_type || 'image/png';
    return { statusCode: 200, body: { imageDataUrl: `data:${mime};base64,${inline.data}` } };
}

// ── 카페 카드 이미지 생성(OpenAI, 레퍼런스 무드) — 새 프롬프트(이전 기록과 무관, 깨끗이) ──
function buildCafeCardPrompt(p) {
    const region = (p.region || '').trim();
    const district = (p.district || '').trim(); // 구/시 (예: 송파구) — 상단 작은 배지
    const topic = (p.topic || '누수탐지').trim();
    const phone = (p.phone || '').trim();
    const services = (p.services || '누수탐지 · 공압검사 · 배관교체').trim();
    // 고정 카드(2~8번용): 같은 브랜드 무드지만 지역·전화번호 없이, 현장 사진 위주.
    if (p.mode === 'fixed') {
        return [
            `Create a 1024x1024 square Korean local "leak detection / plumbing repair" photo card (누수탐지·배관공사 현장 카드).`,
            `Follow this EXACT fixed layout (top to bottom), professional Korean local-service thumbnail mood:`,
            `1) TOP HEADER on a deep navy blue bar: the main title in HUGE bold WHITE text "누수탐지 · 배관공사", and directly under it a smaller yellow line "탐지부터 공사까지".`,
            `2) A yellow starburst seal badge reading "신속출동" placed at the TOP-RIGHT corner.`,
            `3) MIDDLE: one wide horizontal collage strip made of exactly 2 realistic on-site work photos side by side, based on the reference image(s): demolition rubble in a bathroom, gray PVC pipes, a technician using a leak-detection device, a water-stained ceiling, pressure-test gauges, etc.`,
            `4) BOTTOM: a single white rounded pill bar with service tags "${services}" in navy text.`,
            ``,
            `The exact arrangement MAY vary slightly between cards, but the TEXT SIZE, TEXT COLORS, fonts, and overall brand mood MUST stay identical across all cards: HUGE bold white title, yellow accent line, yellow starburst "신속출동" badge, white pill tags, on deep navy + bright blue + yellow accents.`,
            `CRITICAL: Do NOT include any location/region text. Do NOT include any phone number. Do NOT invent an address.`,
            `Render all Korean text crisply and 100% correctly (exact characters, no garbling, no typos, no fake/English letters).`,
            `No English words, no watermark, no logo lettering. Bold, high-contrast, trustworthy Korean marketing look.`,
        ].join('\n');
    }
    // 'hero' 템플릿(테스트2): 큰 인물 사진 + 대형 구/동 타이틀 + 신뢰 3항목 + 하단 문구 + 전화번호.
    if (p.mode === 'hero') {
        return [
            `Create a 1024x1024 square Korean local leak-detection (누수탐지) promotional card. Reproduce this EXACT layout and style:`,
            `- Bright clean white/light background with subtle blue tech accents. Palette: dark navy (#0a2a66), vivid blue (#1e6fff), white, small yellow highlight.`,
            `- RIGHT SIDE (fills right ~45%): one large realistic photo of a masked technician in a navy work uniform looking UP and holding a handheld endoscope/leak-detection wand against a water-stained apartment ceiling near a bright window; he also holds a device with a small screen.`,
            `- TOP-LEFT: the MAIN TITLE in VERY large bold Korean text on two lines with a thick 3D outline and drop shadow — first line the region "${region}" in dark navy, second line "${topic}" in vivid blue. A glossy blue water-drop icon next to the title.`,
            `- Under the title: a blue rounded pill with a stopwatch icon reading "빠른 출동 · 정확한 원인 진단".`,
            `- Below that, one line in dark navy: "아파트 · 빌라 · 상가 누수 해결".`,
            `- A white rounded panel with THREE trust items side by side, each = a blue line icon + bold navy title + small gray subtitle: "빠른 출동 / 신속한 현장 대응", "정확한 진단 / 첨단 장비 분석", "확실한 해결 / 꼼꼼한 복구 지원".`,
            `- BOTTOM blue band: on the left a small photo of a leaking pipe joint spraying water; center text "보이지 않는 누수, 정확한 탐지가 해답입니다!" (the word 탐지 highlighted yellow); and a phone row with a white phone icon and a big phone number "${phone}".`,
            ``,
            `CRITICAL: Render ALL Korean text 100% correctly (exact characters, no garbling, no typos, no fake or English letters). The phone number must be exactly "${phone}". Only change the region word "${region}" — keep everything else identical in style. High-contrast, trustworthy Korean marketing look.`,
        ].join('\n');
    }
    return [
        `Create a 1024x1024 square Korean local leak-detection (누수탐지) promotional thumbnail card. Reproduce this EXACT professional layout and style:`,
        `- Bright, clean white/light background with subtle blue geometric accents; modern high-trust local-service look. Palette: vivid blue (#1e5bd8), white, dark navy.`,
        `- TOP-LEFT: a small round badge (circle) containing a water-drop + magnifier icon and two short lines of blue text "누수" / "전문".`,
        `- RIGHT COLUMN: two stacked rounded-corner real on-site photos. Top photo = a pipe endoscope/borescope inspection with a small handheld screen showing inside a pipe, and a small dark-navy label pill under it reading "배관 내시경 검사". Bottom photo = gloved hands working on exposed ceiling/pipes, with a label pill reading "누수 원인 정확 진단".`,
        `- LEFT/CENTER: one large photo of a masked technician kneeling on an apartment floor using a leak-detection device.`,
        `- A small dark-navy rounded pill with white text showing the district: "${district}".`,
        `- The MAIN TITLE in VERY large bold WHITE Korean text with a thick blue outline and subtle 3D drop-shadow, on two lines: first line "${region}", second line "${topic}".`,
        `- Just under the title, a thin rounded pill: "정밀 점검 · 신속 출동".`,
        `- Near the bottom, a big rounded BLUE phone bar with a white phone icon in a rounded square on the left and a HUGE phone number "${phone}".`,
        `- BOTTOM white strip with three trust items each with a small blue line icon: "정확한 누수탐지", "최소한의 보수", "신속한 출동".`,
        ``,
        `CRITICAL: Render ALL Korean text 100% correctly (exact characters, no garbling, no typos, no fake or English letters). The phone number must be exactly "${phone}". Only change the region words "${district}"/"${region}" — keep everything else identical in style. High-contrast, trustworthy Korean marketing look.`,
    ].join('\n');
}
async function generateCafeCard(p) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { statusCode: 500, body: { message: '.env 의 OPENAI_API_KEY 가 필요합니다.' } };
    // 호출부가 고른 모델(웹 UI 'mini' 토글 / crawler CAFE_BANNER_MODEL)을 존중한다.
    //   기존엔 payload.model 을 무시하고 .env 값만 써서, 화면에서 mini 를 골라도 gpt-5.5 로 생성됐다.
    const ALLOWED_MODELS = ['gpt-5.5', 'gpt-5-mini'];
    const model = ALLOWED_MODELS.includes(p.model)
        ? p.model
        : process.env.OPENAI_IMAGE_MODEL || 'gpt-5.5';
    const quality = ['low', 'medium', 'high'].includes(p.quality) ? p.quality : 'high';
    const content = [{ type: 'input_text', text: buildCafeCardPrompt(p) }];
    for (const u of (Array.isArray(p.refs) ? p.refs : []).slice(0, 2)) {
        if (typeof u === 'string' && u.startsWith('data:')) content.push({ type: 'input_image', image_url: u });
    }
    const res = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: [{ role: 'user', content }], model, tools: [{ type: 'image_generation', size: '1024x1024', quality }] }),
    });
    const result = await readJsonResponse(res);
    // 어떤 모델/화질로 실제 생성했는지 + 토큰 사용량을 남긴다(비용 추적).
    //   예전엔 기록이 전혀 없어 '어떤 모델로 얼마 썼는지' 확인 자체가 불가능했다.
    rememberRequest({
        model,
        ok: res.ok,
        quality,
        route: 'generate-cafe-card',
        status: res.status,
        usage: result?.usage ?? null,
    });
    if (!res.ok) return { statusCode: res.status, body: { message: result?.error?.message || 'OpenAI 카드 생성 실패' } };
    const out = (result.output || []).find((it) => it.type === 'image_generation_call');
    if (!out?.result) return { statusCode: 502, body: { message: 'OpenAI 응답에 이미지가 없습니다.' } };
    // 호출부(웹)가 표시/검증할 수 있도록 실제 사용 모델·사용량을 응답에 포함.
    return {
        statusCode: 200,
        body: { imageDataUrl: `data:image/png;base64,${out.result}`, model, usage: result?.usage ?? null },
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

    if (request.method === 'POST' && request.url === '/api/generate-cafe') {
        try {
            const payload = await readJsonBody(request);
            const result = await generateCafe(payload);
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

    if (request.method === 'POST' && request.url === '/api/generate-cafe-edit') {
        try {
            const payload = await readJsonBody(request);
            const result = await generateCafeEdit(payload);
            sendJson(response, result.statusCode, result.body);
        } catch (error) {
            sendJson(response, 500, { message: error instanceof Error ? error.message : '서버 오류가 발생했습니다.' });
        }
        return;
    }

    if (request.method === 'POST' && request.url === '/api/generate-cafe-card') {
        try {
            const payload = await readJsonBody(request);
            const result = await generateCafeCard(payload);
            sendJson(response, result.statusCode, result.body);
        } catch (error) {
            sendJson(response, 500, { message: error instanceof Error ? error.message : '서버 오류가 발생했습니다.' });
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
