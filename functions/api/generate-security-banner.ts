// 보안업체(더맨시스템) 배너 생성 — 지역·보안종류·제목(3줄) 입력 → 하단 3개 항목 자동 결정 + 저화질 이미지 1장.
//   비용 최소화(품질 유지):
//     ① 하단 3개 = '보안종류' 프리셋 매칭 시 즉시 사용(0원·안깨짐). 미매칭 시에만 텍스트 모델로 생성(~2원).
//     ② 이미지 프롬프트를 '고정 지시문 먼저 / 변수(지역·제목·항목) 나중' 순서로 배치 → OpenAI 프리픽스 캐싱 유도
//        (반복 생성 시 앞부분 입력토큰이 1/10 단가로 청구). 지시문 자체는 그대로라 품질 동일.

type FunctionContext = { request: Request; env: Record<string, string | undefined> };
type Item = { title: string; subtitle: string; icon: string };
type Payload = { region?: string; secType?: string; titleLines?: string[]; quality?: string; style?: string; items?: Item[]; model?: string };
// 오케스트레이션 모델 화이트리스트(A/B용). 기본 gpt-5.5, mini 만 허용. 전역 env(공유)는 건드리지 않는다.
const ALLOWED_SEC_MODELS = ['gpt-5.5', 'gpt-5-mini'];

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json; charset=utf-8' }, status });
}

// ── 보안종류별 하단 3개 프리셋(0원·즉시·글자 안깨짐). {region} → 지역명 치환. ──
const PRESETS: { match: string[]; items: Item[] }[] = [
    {
        match: ['회사', '건물', '사무', '오피스', '기업', '상가', '아파트'],
        items: [
            { title: '24시 관제', subtitle: '실시간 모니터링', icon: 'monitor' },
            { title: '출입 관리', subtitle: '직원·방문 통제', icon: 'keycard' },
            { title: '긴급 출동', subtitle: '{region} 신속 대응', icon: 'shield' },
        ],
    },
    {
        match: ['야외', '행사', '축제', '공연', '이벤트', '페스티벌'],
        items: [
            { title: '현장 관제', subtitle: '실시간 모니터링', icon: 'monitor' },
            { title: '관람객 동선', subtitle: '체계적 관리', icon: 'people' },
            { title: '안전 운영', subtitle: '즉시 대응', icon: 'shield' },
        ],
    },
    {
        match: ['공사', '산업', '현장', '물류', '창고', '공장'],
        items: [
            { title: '상시 순찰', subtitle: '24시 감시', icon: 'walk' },
            { title: '출입 통제', subtitle: '자재·장비 보호', icon: 'lock' },
            { title: '사고 예방', subtitle: '{region} 신속 대응', icon: 'shield' },
        ],
    },
    {
        match: ['주차', '차량'],
        items: [
            { title: '차량 관제', subtitle: '실시간 모니터링', icon: 'car' },
            { title: '출입 통제', subtitle: '무단주차 차단', icon: 'barrier' },
            { title: '긴급 출동', subtitle: '{region} 신속 대응', icon: 'shield' },
        ],
    },
];
const DEFAULT_ITEMS: Item[] = [
    { title: '24시 관제', subtitle: '실시간 모니터링', icon: 'monitor' },
    { title: '출입 관리', subtitle: '철저한 통제', icon: 'keycard' },
    { title: '긴급 출동', subtitle: '{region} 신속 대응', icon: 'shield' },
];

function presetFor(secType: string): Item[] | null {
    const s = (secType || '').replace(/\s/g, '');
    for (const p of PRESETS) if (p.match.some((m) => s.includes(m))) return p.items;
    return null;
}
function fillRegion(items: Item[], region: string): Item[] {
    return items.map((it) => ({ ...it, subtitle: (it.subtitle || '').replace('{region}', region || '') }));
}

// 프리셋 미매칭 시에만: 하단 3개를 텍스트 모델로 생성(reasoning low·json_object로 최소 비용).
async function genItems(
    region: string,
    secType: string,
    titleLines: string[],
    model: string,
    apiKey: string,
): Promise<{ items: Item[]; usage: unknown }> {
    const prompt = [
        `너는 한국 지역 보안업체 홍보 배너의 '하단 3개 신뢰 항목'을 만드는 카피라이터다.`,
        `지역: ${region} / 보안 종류: ${secType} / 배너 제목: "${titleLines.join(' ')}".`,
        `이 맥락에 딱 맞는 하단 3개 항목을 만들어라. 각 항목 = 굵은 소제목(2~7자) + 작은 설명(4~12자)`,
        `+ 어울리는 단순 라인아이콘을 나타내는 영어 한 단어(icon: 예 monitor, shield, keycard, people, lock).`,
        `반드시 JSON만 출력: {"items":[{"title":"..","subtitle":"..","icon":".."}, 3개]}`,
    ].join('\n');
    const body = JSON.stringify({
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
        model,
        reasoning: { effort: 'low' },
        text: { format: { type: 'json_object' } },
    });
    const res = await fetch(OPENAI_API_URL, {
        body,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        method: 'POST',
    });
    const result = (await res.json()) as Record<string, unknown>;
    let text = '';
    for (const it of (result.output as Array<{ content?: Array<{ type?: string; text?: string }> }> | undefined) || []) {
        for (const c of it.content || []) if (c.type === 'output_text') text += c.text || '';
    }
    let items: Item[] = [];
    try {
        const parsed = JSON.parse(text) as { items?: Item[] };
        items = (parsed.items || []).slice(0, 3);
    } catch {
        items = [];
    }
    if (items.length < 3) items = DEFAULT_ITEMS; // 파싱 실패 시 안전 프리셋
    return { items, usage: result.usage };
}

// 이미지 프롬프트 — 고정 지시문(캐시 대상) 먼저, 변수는 맨 끝 VARIABLES 블록에만. 값은 아래에서만 등장.
function buildSecurityPrompt(region: string, secType: string, titleLines: string[], items: Item[]): string {
    const STATIC = [
        `Immediately call the image_generation tool. Do NOT write any text, plan, or revised prompt — output the image only.`,
        `Create a 1024x1024 square Korean corporate/event SECURITY company promotional card.`,
        `Fixed layout & style (identical for every banner):`,
        `- Large sweeping DARK FOREST GREEN curved panel on the RIGHT; light green-white on the LEFT.`,
        `- RIGHT SIDE (~50%): one large realistic photo of a Korean male security guard in a dark suit/security uniform with an earpiece, standing confidently; the background scene fits SECURITY_TYPE (office lobby/glass building for corporate, outdoor festival stage for events, construction site for industrial).`,
        `- TOP-LEFT: a small dark rounded pill in white text = REGION + " " + SECURITY_TYPE.`,
        `- Below the pill: the MAIN TITLE, large bold dark-navy Korean text on three lines = the three TITLE_LINES in order. Use a rounded modern Korean gothic font with NORMAL, well-proportioned letters (each character about as wide as it is tall — NOT vertically stretched or condensed), comfortable line spacing, a short green underline accent.`,
        `- Under the title: "더맨시스템" in medium gray Korean text.`,
        `- BOTTOM-LEFT: exactly three trust items side by side. Each item = a simple green line ICON inside a rounded dark-green box + a bold navy TITLE + a small gray SUBTITLE, taken in order from BOTTOM_ITEMS.`,
        `- No company logo or brand lettering at the very top. Green palette, high-contrast, trustworthy Korean marketing look.`,
        `CRITICAL: render ALL Korean text 100% correctly — exact characters, no garbling, no typos, no fake or English letters, horizontal text only (never vertical).`,
    ];
    const VARS = [
        ``,
        `VARIABLES (only these change per banner):`,
        `- REGION = "${region}"`,
        `- SECURITY_TYPE = "${secType}"`,
        `- TITLE_LINES = ${JSON.stringify(titleLines)}`,
        `- BOTTOM_ITEMS = ${JSON.stringify(items.map((i) => ({ title: i.title, subtitle: i.subtitle, icon: i.icon })))}`,
    ];
    return [...STATIC, ...VARS].join('\n');
}

// 파란 레퍼런스 스타일(누수탐지 배너 무드) — 전화번호 없음. 고정 지시문 먼저 / 변수 뒤(캐싱 유도).
function buildSecurityPromptBlue(region: string, secType: string, titleLines: string[], items: Item[]): string {
    const STATIC = [
        `Immediately call the image_generation tool. Do NOT write any text, plan, or revised prompt — output the image only.`,
        `Create a 1024x1024 square Korean local SECURITY/guard company promotional card (보안·경비 홍보 카드).`,
        `Fixed layout & style (identical for every banner), bright high-trust local-service look:`,
        `- Bright clean WHITE/light background with vivid BLUE geometric swoosh accents (a deep-blue curved ribbon along the top-left corner and across the bottom). Palette: vivid blue #1e5bd8, dark navy #0a2a66, white, small highlight.`,
        `- TOP-LEFT: a small blue SHIELD icon, and to its right ONE short tagline line rendered in a SINGLE UNIFORM font — every character the exact SAME size, SAME semi-bold weight and SAME dark-navy color, evenly spaced on a single line, absolutely no mixed sizes/weights/styles: "믿을 수 있는 보안, 정확한 관리가 답입니다!".`,
        `- Under the tagline: the MAIN TITLE in HUGE bold Korean text with a thick blue outline and subtle 3D drop-shadow, stacked on the TITLE_LINES in order (first line dark navy, the following lines vivid blue). Use a rounded modern Korean gothic font with NORMAL well-proportioned letters (each character about as wide as it is tall, NOT vertically stretched), comfortable line spacing.`,
        `- Under the title: a blue rounded pill with a small stopwatch icon reading "빠른 출동 · 정확한 현장 대응".`,
        `- Below that, one dark-navy line: REGION + " " + SECURITY_TYPE + " 전문 관리".`,
        `- A white rounded panel with exactly THREE trust items side by side, taken in order from BOTTOM_ITEMS; each item = a blue line ICON + bold navy TITLE + small gray SUBTITLE.`,
        `- RIGHT SIDE (fills right ~45%): one large realistic photo of a Korean male security guard in a dark navy uniform with an earpiece, alert and professional; the background fits SECURITY_TYPE (office lobby / glass building for corporate, outdoor event stage for events, construction site for industrial, parking lot for parking).`,
        `- BOTTOM: a wide vivid-BLUE band. Centered white text "24시간 상담 · 신속 출동 · 확실한 대응", and at the far right a round white badge with blue text on two lines "더맨시스템" / "보안 전문".`,
        `- Do NOT put any phone number anywhere.`,
        `CRITICAL: render ALL Korean text 100% correctly — exact characters, no garbling, no typos, no fake or English letters, horizontal text only (never vertical).`,
    ];
    const VARS = [
        ``,
        `VARIABLES (only these change per banner):`,
        `- REGION = "${region}"`,
        `- SECURITY_TYPE = "${secType}"`,
        `- TITLE_LINES = ${JSON.stringify(titleLines)}`,
        `- BOTTOM_ITEMS = ${JSON.stringify(items.map((i) => ({ title: i.title, subtitle: i.subtitle, icon: i.icon })))}`,
    ];
    return [...STATIC, ...VARS].join('\n');
}

export async function generateSecurityBanner(p: Payload, env: FunctionContext['env']) {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return json({ message: 'Cloudflare 환경변수 OPENAI_API_KEY가 필요합니다.' }, 500);
    // 요청이 허용목록 모델을 명시하면 그걸(A/B), 아니면 기존 기본(gpt-5.5). genItems·이미지 양쪽에 동일 적용.
    const model = p.model && ALLOWED_SEC_MODELS.includes(p.model) ? p.model : env.OPENAI_IMAGE_MODEL || 'gpt-5.5';
    const quality = ['low', 'medium', 'high'].includes(p.quality || '') ? (p.quality as string) : 'low';
    const region = (p.region || '').trim();
    const secType = (p.secType || '').trim();
    const titleLines = (Array.isArray(p.titleLines) ? p.titleLines : []).map((s) => (s || '').trim()).filter(Boolean).slice(0, 3);
    if (!region || !secType || titleLines.length === 0) {
        return json({ message: '지역·보안종류·제목(최소 1줄)을 입력하세요.' }, 400);
    }

    // ① 하단 3개 항목 결정 — 직접 입력(manual) 우선 → 프리셋(0원) → AI 생성(~2원).
    let items: Item[];
    let source: 'preset' | 'ai' | 'manual';
    let textUsage: unknown = null;
    const manual = (Array.isArray(p.items) ? p.items : [])
        .map((i) => ({ title: (i.title || '').trim(), subtitle: (i.subtitle || '').trim(), icon: (i.icon || 'shield').trim() }))
        .filter((i) => i.title);
    const preset = presetFor(secType);
    if (manual.length === 3) {
        items = fillRegion(manual, region); // {region} 치환은 유지(사용자가 넣었다면)
        source = 'manual';
    } else if (preset) {
        items = fillRegion(preset, region);
        source = 'preset';
    } else {
        const gen = await genItems(region, secType, titleLines, model, apiKey);
        items = fillRegion(gen.items, region);
        textUsage = gen.usage;
        source = 'ai';
    }

    // ② 이미지 생성(저화질 기본). 이미지 토큰은 usage에 없음 → 프론트가 토큰표로 산출. style=blue면 파란 레퍼런스 무드.
    const prompt =
        p.style === 'blue'
            ? buildSecurityPromptBlue(region, secType, titleLines, items)
            : buildSecurityPrompt(region, secType, titleLines, items);
    const body = JSON.stringify({
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
        model,
        reasoning: { effort: 'low' }, // 오케스트레이션 출력 토큰 절감(품질 동일, 출력 ~39%↓ 실측)
        tools: [{ type: 'image_generation', size: '1024x1024', quality }],
    });
    let base64: string | undefined;
    let imageUsage: unknown;
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
            return json({ message: (result.error as { message?: string } | undefined)?.message || 'OpenAI 이미지 생성 실패' }, res.status);
        }
        const out = (result.output as Array<{ type?: string; result?: string }> | undefined)?.find((it) => it.type === 'image_generation_call');
        base64 = out?.result;
        imageUsage = result.usage;
        if (base64) break;
    }
    if (!base64) return json({ message: 'OpenAI 응답에 이미지가 없습니다. 다시 시도해 주세요.' }, 502);
    return json({ imageDataUrl: `data:image/png;base64,${base64}`, items, model, source, textUsage, imageUsage });
}

export async function onRequestPost({ request, env }: FunctionContext) {
    const p = (await request.json()) as Payload;
    return generateSecurityBanner(p, env);
}
