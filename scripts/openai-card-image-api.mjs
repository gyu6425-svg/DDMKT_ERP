import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.OPENAI_LOCAL_API_PORT || 8787);
const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const recentRequests = [];

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
        ? payload.imageDataUrls.filter(Boolean)
        : [payload.imageDataUrl].filter(Boolean);
}

function buildPrompt({ form, imageDataUrl, imageDataUrls, rawText, templateDirection, templateName }) {
    const referenceImages = Array.isArray(imageDataUrls)
        ? imageDataUrls.filter(Boolean)
        : [imageDataUrl].filter(Boolean);
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
${form.title}

Supporting copy:
${form.subtitle}

Emphasis:
${form.emphasis}

CTA:
${form.cta}

Raw user copy:
${rawText}

Design direction:
- Make the typography large, clear, and highly readable.
- Use Korean text accurately without changing the meaning.
- Use strong hierarchy: main title, supporting copy, emphasis, CTA.
- Use a refined advertising-card layout with enough margins.
- Main colors: ${form.textColor}, ${form.accentColor}, ${form.backgroundColor}.
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
            imageDataUrl: `data:image/png;base64,${imageBase64}`,
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

    rememberRequest({
        hasImage: getReferenceImages(payload).length > 0,
        id: requestId,
        model,
        provider: 'gemini',
        rawTextLength: payload.rawText?.length || 0,
        status: 'started',
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
            imageDataUrl: `data:${inlineData.mimeType || inlineData.mime_type || 'image/png'};base64,${
                inlineData.data
            }`,
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

loadDotEnv();

const server = createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
        sendJson(response, 200, {});
        return;
    }

    if (request.method === 'GET' && request.url === '/api/health') {
        sendJson(response, 200, {
            geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
            ok: true,
            openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
            recentRequests,
        });
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
