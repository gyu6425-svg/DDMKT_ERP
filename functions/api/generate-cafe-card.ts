// 카페 카드 이미지 생성(OpenAI, 레퍼런스 무드) — 원고의 각 「사진 N」에 대응하는 카드 1장을 GPT로 생성.
//   지역/제목(topic)/전화/서비스 텍스트를 정확히 렌더, 첨부 현장사진(refs)을 무드 참고로 사용.
//   이전 배너 프롬프트와 무관한 '깨끗한' 전용 프롬프트.

type FunctionContext = { request: Request; env: Record<string, string | undefined> };
type Payload = { region?: string; topic?: string; phone?: string; services?: string; refs?: string[]; quality?: string; mode?: string };

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json; charset=utf-8' }, status });
}

export function buildCafeCardPrompt(p: Payload): string {
    const region = (p.region || '').trim();
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
    return [
        `Create a 1024x1024 square Korean local "leak detection" promotional card (누수탐지 홍보 카드).`,
        `Match this EXACT visual style (professional Korean local-service thumbnail):`,
        `- Deep navy blue background with a bright blue rounded panel.`,
        `- TOP: a collage of 2~3 realistic on-site plumbing/leak-repair job photos (bathroom under repair, gray PVC pipes, a leak detection device with a small screen).`,
        `- A small yellow starburst seal badge reading "신속출동" at the upper-left of the panel.`,
        `- Location line in bold WHITE outlined text: "${region}".`,
        `- Main title in HUGE bold YELLOW outlined text (thick dark stroke, drop shadow): "${topic}".`,
        `- A rounded pill bar with the services.`,
        `- A yellow accent line "탐지부터 공사까지".`,
        `- BOTTOM: a phone bar with a blue circle phone icon and a big YELLOW phone number "${phone}".`,
        `- A bottom white pill row of service tags: "${services}".`,
        ``,
        `CRITICAL: Render ALL Korean text crisply and 100% correctly (exact characters, no garbling, no typos, no fake/English letters). The phone number must be exactly "${phone}".`,
        `No English words, no watermark, no logo lettering. Bold, high-contrast, trustworthy Korean marketing look.`,
    ].join('\n');
}

export async function generateCafeCard(p: Payload, env: FunctionContext['env']) {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return json({ message: 'Cloudflare 환경변수 OPENAI_API_KEY가 필요합니다.' }, 500);
    const model = env.OPENAI_IMAGE_MODEL || 'gpt-5.5';
    const quality = ['low', 'medium', 'high'].includes(p.quality || '') ? (p.quality as string) : 'high';

    const content: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }> = [
        { type: 'input_text', text: buildCafeCardPrompt(p) },
    ];
    for (const u of (Array.isArray(p.refs) ? p.refs : []).slice(0, 2)) {
        if (typeof u === 'string' && u.startsWith('data:')) content.push({ type: 'input_image', image_url: u });
    }

    const body = JSON.stringify({
        input: [{ role: 'user', content }],
        model,
        tools: [{ type: 'image_generation', size: '1024x1024', quality }],
    });

    let base64: string | undefined;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const res = await fetch(OPENAI_API_URL, {
            body,
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            method: 'POST',
        });
        const text = await res.text();
        let result: Record<string, unknown> = {};
        try {
            result = text ? JSON.parse(text) : {};
        } catch {
            return json({ message: 'OpenAI 응답을 해석하지 못했습니다.' }, 502);
        }
        if (!res.ok) {
            if ((res.status === 429 || res.status >= 500) && attempt < 2) continue;
            return json({ message: (result.error as { message?: string } | undefined)?.message || 'OpenAI 카드 생성 실패' }, res.status);
        }
        const out = (result.output as Array<{ type?: string; result?: string }> | undefined)?.find((it) => it.type === 'image_generation_call');
        base64 = out?.result;
        if (base64) break;
    }
    if (!base64) return json({ message: 'OpenAI 응답에 이미지가 없습니다. 다시 시도해 주세요.' }, 502);
    return json({ imageDataUrl: `data:image/png;base64,${base64}` });
}

export async function onRequestPost({ request, env }: FunctionContext) {
    const p = (await request.json()) as Payload;
    return generateCafeCard(p, env);
}
