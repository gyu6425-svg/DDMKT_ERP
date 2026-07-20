// 카페 카드 이미지 생성(OpenAI, 레퍼런스 무드) — 원고의 각 「사진 N」에 대응하는 카드 1장을 GPT로 생성.
//   지역/제목(topic)/전화/서비스 텍스트를 정확히 렌더, 첨부 현장사진(refs)을 무드 참고로 사용.
//   이전 배너 프롬프트와 무관한 '깨끗한' 전용 프롬프트.

type FunctionContext = { request: Request; env: Record<string, string | undefined> };
type Payload = { region?: string; district?: string; topic?: string; phone?: string; services?: string; refs?: string[]; quality?: string; mode?: string; model?: string };

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
// 카드 오케스트레이션 모델 화이트리스트. 기본은 gpt-5.5, A/B용으로 gpt-5-mini 만 허용(임의 문자열 주입 차단).
//   ⚠️ 전역 env(OPENAI_IMAGE_MODEL)는 보안배너·블로그·카드이미지가 공유하므로 여기서 바꾸지 않는다.
const ALLOWED_CARD_MODELS = ['gpt-5.5', 'gpt-5-mini'];
// 텍스트/재작성 없이 곧장 이미지를 뱉게 강제(약한 모델이 프롬프트를 축약·재작성하는 위험 완화). security-banner 와 동일 취지.
const IMAGE_ONLY_GUARD = 'Immediately call the image_generation tool and output ONLY the image. Do NOT write any text, plan, or a revised prompt.';

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json; charset=utf-8' }, status });
}

export function buildCafeCardPrompt(p: Payload): string {
    const region = (p.region || '').trim();
    const district = (p.district || '').trim(); // 구/시 (예: 송파구) — 상단 작은 배지
    const topic = (p.topic || '누수탐지').trim();
    const phone = (p.phone || '').trim();
    const services = (p.services || '누수탐지 · 공압검사 · 배관교체').trim();
    // 고정 카드(2~8번용): 같은 브랜드 무드지만 지역·전화번호 없이, 현장 사진 위주.
    if (p.mode === 'fixed') {
        return [
            IMAGE_ONLY_GUARD,
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
            IMAGE_ONLY_GUARD,
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
        IMAGE_ONLY_GUARD,
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

export async function generateCafeCard(p: Payload, env: FunctionContext['env']) {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return json({ message: 'Cloudflare 환경변수 OPENAI_API_KEY가 필요합니다.' }, 500);
    // 요청이 허용목록의 모델을 명시하면 그걸 쓰고(A/B용), 아니면 기존 기본(gpt-5.5) 유지.
    const model = p.model && ALLOWED_CARD_MODELS.includes(p.model) ? p.model : env.OPENAI_IMAGE_MODEL || 'gpt-5.5';
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
        // 추론 토큰↓ → 텍스트 출력비 절감(오케스트레이션만, 이미지 화질 무영향). security-banner 에서 출력 ~39%↓ 실측.
        reasoning: { effort: 'low' },
        tools: [{ type: 'image_generation', size: '1024x1024', quality }],
    });

    let base64: string | undefined;
    let usage: unknown; // Responses API usage(메인 텍스트 토큰). 이미지 토큰은 여기 없음 → 프론트가 토큰표로 산출.
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
        usage = result.usage;
        if (base64) break;
    }
    if (!base64) return json({ message: 'OpenAI 응답에 이미지가 없습니다. 다시 시도해 주세요.' }, 502);
    return json({ imageDataUrl: `data:image/png;base64,${base64}`, model, usage });
}

export async function onRequestPost({ request, env }: FunctionContext) {
    const p = (await request.json()) as Payload;
    return generateCafeCard(p, env);
}
