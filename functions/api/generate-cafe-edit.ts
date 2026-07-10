// 카페 카드 '원본 이미지 글자 교체'(실험) — 업로드한 완성 카드 이미지에서 텍스트만 교체(사진·디자인 유지).
//   Gemini 이미지 편집(generateContent, responseModalities IMAGE) 사용. 한글 정확도는 모델 한계로 불안정할 수 있음.

type FunctionContext = { request: Request; env: Record<string, string | undefined> };
type Payload = { image?: string; region?: string; keyword?: string; phone?: string; services?: string };

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        status,
    });
}

function splitDataUrl(u: string): { mimeType: string; data: string } | null {
    const m = /^data:([^;]+);base64,(.+)$/.exec(u || '');
    return m ? { mimeType: m[1], data: m[2] } : null;
}

export function buildEditPrompt(p: Payload): string {
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

export async function generateCafeEdit(p: Payload, env: FunctionContext['env']) {
    if (!p.image) return json({ message: '원본 이미지가 필요합니다.' }, 400);
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) return json({ message: 'Cloudflare 환경변수 GEMINI_API_KEY가 필요합니다.' }, 500);
    const img = splitDataUrl(p.image);
    if (!img) return json({ message: '이미지 형식 오류(dataURL 필요).' }, 400);
    const model = env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash';

    const res = await fetch(`${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${apiKey}`, {
        body: JSON.stringify({
            contents: [{ parts: [{ text: buildEditPrompt(p) }, { inlineData: { data: img.data, mimeType: img.mimeType } }] }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
    });
    const text = await res.text();
    let result: Record<string, unknown> = {};
    try {
        result = text ? JSON.parse(text) : {};
    } catch {
        return json({ message: 'Gemini 응답을 해석하지 못했습니다.' }, 502);
    }
    if (!res.ok) {
        const err = (result.error as { message?: string } | undefined)?.message;
        const message =
            res.status === 429 ? '무료 티어 요청 제한에 걸렸습니다. 잠시 후 다시 시도하세요.' : err || '이미지 편집에 실패했습니다.';
        return json({ message }, res.status);
    }
    const parts =
        ((result.candidates as Array<{ content?: { parts?: Array<Record<string, unknown>> } }> | undefined)?.[0]?.content?.parts) || [];
    const ip = parts.find((pt) => (pt.inlineData as { data?: string })?.data || (pt.inline_data as { data?: string })?.data) as
        | { inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }
        | undefined;
    const inline = ip?.inlineData || ip?.inline_data;
    if (!inline?.data) return json({ message: 'Gemini 응답에 편집 이미지가 없습니다. 다시 시도해 주세요.' }, 502);
    const mime = (inline as { mimeType?: string; mime_type?: string }).mimeType || (inline as { mime_type?: string }).mime_type || 'image/png';
    return json({ imageDataUrl: `data:${mime};base64,${inline.data}` });
}

export async function onRequestPost({ request, env }: FunctionContext) {
    const p = (await request.json()) as Payload;
    return generateCafeEdit(p, env);
}
