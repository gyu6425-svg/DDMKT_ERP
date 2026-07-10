// 카페 원고 자동생성 — 키워드/지역을 받아 '9장 카드'에 들어갈 구조화 JSON(원고)을 생성.
//   AI 이미지가 아니라 텍스트만 생성(카드는 프론트에서 HTML/CSS 템플릿으로 렌더). generate-blog 와 동일한
//   OpenAI responses API 사용. 반환 content = Partial<CafeContent>(프론트 mergeCafeContent 로 기본값 병합).

type GenerateCafePayload = {
    keyword?: string; // 예: 과천 누수탐지
    region?: string; // 지역명(과천). 없으면 keyword 에서 유추.
    brand?: string; // 든든한 누수탐지
    branch?: string; // 과천점
    phone?: string; // 010-4614-4424
    business?: string; // 업종(기본: 누수탐지)
    mode?: 'cards' | 'review'; // cards=카드용 구조화 JSON / review=후기성 카페 본문
    content?: Record<string, unknown>; // review 모드에서 소재(카드 콘텐츠) 참고
    tone?: string; // review 톤: review(후기)·info(정보)·story(스토리)·talk(대화)·notice(공지)
};

// 후기 본문 톤 5종 — 시작 말투/문체 지시. 기본 review(후기형).
export const REVIEW_TONES: Record<string, { name: string; guide: string }> = {
    review: {
        name: '후기형',
        guide: '직접 경험한 사람이 후기를 공유하는 말투. 시작 예: "안녕하세요 :) 얼마 전 누수 때문에 든든한 누수탐지 불러봤는데, 정리해서 공유해야겠다 싶어 글 남깁니다."',
    },
    info: {
        name: '정보형',
        guide: '업체가 정보를 정리해 안내하는 말투. 시작 예: "안녕하세요, 든든한 누수탐지입니다. 상담을 진행하며 자주 받는 질문들을 중심으로 안내드립니다."',
    },
    story: {
        name: '스토리형',
        guide: '이야기를 풀어가는 말투. 시작 예: "처음엔 별것 아닌 것처럼 보입니다. 그런데 시간이 지나면 이야기가 달라지죠."',
    },
    talk: {
        name: '대화형',
        guide: '독자에게 질문을 던지며 대화하듯 이끄는 말투. 시작 예: "혹시 지금 이런 고민 하고 계신가요?"',
    },
    notice: {
        name: '공지형',
        guide: '간결한 브리핑/공지 말투. 핵심만 짧게, 군더더기 없이 항목 위주로.',
    },
};

type FunctionContext = {
    request: Request;
    env: Record<string, string | undefined>;
};

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        status,
    });
}

// 생성할 JSON 키 목록(프론트 CafeContent 와 일치, 고정값 brand/branch/phone 은 프론트에서 주입).
export function buildCafePrompt(payload: GenerateCafePayload): string {
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
        `  "coverTitle": "브랜드 큰제목(예: ${brand}) — 6~10자, 공백 1개로 두 줄 표기됨",`,
        `  "coverEmphasisPre": "물이 새는",`,
        `  "coverEmphasisHi": "강조 구절(예: 지금이 가장 저렴하게)",`,
        `  "coverEmphasisPost": "해결할 수 있는 순간입니다",`,
        `  "coverCta": "24시간 출동 가능",`,
        `  "situations": ["고객이 겪는 상황 3개(한 줄, 20자 내외)"] ,`,
        `  "situationWarn": "경고 한 줄(예: 누수는 시간이 지나도 저절로 해결되지 않습니다)",`,
        `  "damages": [{"period":"하루","text":"..."},{"period":"일주일","text":"..."},{"period":"한 달","text":"..."}],`,
        `  "damagePunch1": "지금이", "damagePunch2": "가장 저렴한 순간",`,
        `  "wayIntroPre": "누수는",`,
        `  "wayIntroHi": "보이지 않는 원인 부위들을 · 로 나열(예: 벽 속 배관 · 바닥 속 배관 · 천장 내부 · 방수층 · 난방배관)",`,
        `  "wayIntroPost": "처럼 보이지 않는 곳에서 생기는 경우가 훨씬 많습니다. 그래서 저희는,",`,
        `  "waySteps": ["진단 원칙 3개(한 줄)"] ,`,
        `  "wayFooter": "필요한 경우에만 공사를 안내드립니다",`,
        `  "checklist": ["바로 점검이 필요한 증상 7개(한 줄, 15자 내외)"] ,`,
        `  "whyIntroPre": "같은 ${business}라도", "whyIntroHi": "언제 발견하느냐", "whyIntroPost": "에 따라 결과가 완전히 달라집니다.",`,
        `  "whyEarlyLabel": "초기에 발견하면", "whyEarly": "간단한 보수로 끝나는 경우가 많습니다",`,
        `  "whyLateLabel": "방치하면", "whyLate": "바닥 철거와 배관 교체까지 이어질 수 있습니다",`,
        `  "buildingTypes": ["건물 유형 4~5개(아파트/빌라/주택/상가/공장 등)"] ,`,
        `  "leakTypes": ["누수 부위/종류 6~7개(화장실 누수/천장 누수/수도배관 등)"] ,`,
        `  "serviceFooter": "건물 유형 · 부위 관계없이 진단 가능",`,
        `  "faqs": [{"q":"질문?","a":"답변."}] (자주 묻는 질문 4개, 공사 강요 없음·최소 범위·아랫집 확인·보험처리 위주),`,
        `  "promises": ["업체가 약속하는 항목 5개(한 줄)"] ,`,
        `  "promiseClose1": "누수는 발견 시기가 가장 중요합니다.", "promiseClose2": "지금 확인하는 것이 가장 비용을 아끼는 방법입니다."`,
        `}`,
        ``,
        `규칙: 과장·허위 금지, 지역명을 자연스럽게 반영, 각 항목은 실제 예시처럼 담백하고 신뢰감 있게. 값은 순수 텍스트(이모지·마크다운 금지).`,
    ].join('\n');
}

// 후기성 카페 본문 프롬프트 — 카드 소재(content)를 바탕으로 실제 경험/후기 톤의 글 + 「사진 N」 마커.
export function buildReviewPrompt(payload: GenerateCafePayload): string {
    const keyword = (payload.keyword || '').trim();
    const region = (payload.region || '').trim() || keyword.replace(/\s*누수탐지.*$/, '').trim() || keyword;
    const business = (payload.business || '누수탐지').trim();
    const brand = (payload.brand || '든든한 누수탐지').trim();
    const branch = (payload.branch || '').trim();
    const phone = (payload.phone || '').trim();
    const c = (payload.content || {}) as Record<string, unknown>;
    const arr = (k: string) => (Array.isArray(c[k]) ? (c[k] as unknown[]).map(String) : []);
    const material = [
        `상황: ${arr('situations').join(' / ')}`,
        `자가점검: ${arr('checklist').join(' / ')}`,
        `진단원칙: ${arr('waySteps').join(' / ')}`,
        `서비스: ${arr('buildingTypes').join(' ')} / ${arr('leakTypes').join(' ')}`,
        `약속: ${arr('promises').join(' / ')}`,
        Array.isArray(c.faqs)
            ? `FAQ: ${(c.faqs as Array<{ q?: string; a?: string }>).map((f) => `${f.q}→${f.a}`).join(' / ')}`
            : '',
    ]
        .filter(Boolean)
        .join('\n');

    const tone = REVIEW_TONES[payload.tone || 'review'] || REVIEW_TONES.review;
    return [
        `너는 네이버 카페 지역글 전문 카피라이터다. 아래 업체의 "${keyword}" 홍보를 위한 카페 본문을 **[${tone.name}]** 문체로 쓴다.`,
        `업체명 "${brand} ${branch}", 지역 "${region}", 업종 "${business}", 전화 "${phone}".`,
        ``,
        `[문체 지시 · ${tone.name}] ${tone.guide}`,
        ``,
        `[반드시 지킬 형식]`,
        `- 위 문체를 유지하되 담백하고 자연스럽게. 과장·허위·별점·가짜 이름 금지.`,
        `- 9장의 카드 이미지가 함께 올라간다. 본문 흐름에 맞춰 「사진 1」 ~ 「사진 9」 마커를 순서대로 각각 한 줄 단독으로 넣어라(누락 없이 9개).`,
        `- 업체명과 전화(${phone})는 정확히 표기. 마지막에 상담 유도 한 줄.`,
        `- **분량 2000~2500자(공백 포함)로 충분히 상세하게** 작성. 마크다운·이모지 금지, 순수 텍스트.`,
        ``,
        `[본문에 자연스럽게 녹일 소재]`,
        material,
        ``,
        `반드시 **JSON 객체 하나만** 출력한다(코드펜스·설명 금지): {"title":"클릭을 부르는 제목 1개","body":"본문 전체(줄바꿈 포함, 「사진 N」 마커 포함)"}`,
    ].join('\n');
}

// output_text 우선, 없으면 output[].content[].text 조합.
function extractOutputText(result: {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}): string {
    if (typeof result.output_text === 'string' && result.output_text.trim()) return result.output_text.trim();
    const parts: string[] = [];
    (result.output || []).forEach((item) => {
        (item.content || []).forEach((content) => {
            if (content.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
        });
    });
    return parts.join('').trim();
}

// 코드펜스/잡텍스트가 섞여도 첫 { … 마지막 } 구간만 파싱.
export function parseCafeJson(text: string): Record<string, unknown> | null {
    const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
        return null;
    }
}

export async function generateCafe(payload: GenerateCafePayload, env: FunctionContext['env']) {
    if (!payload.keyword || !payload.keyword.trim()) {
        return jsonResponse({ message: '키워드를 입력해주세요.' }, 400);
    }
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
        return jsonResponse({ message: 'Cloudflare 환경변수 OPENAI_API_KEY가 필요합니다.' }, 500);
    }
    const model = env.OPENAI_TEXT_MODEL || env.OPENAI_IMAGE_MODEL || 'gpt-5.5';
    const isReview = payload.mode === 'review';
    const prompt = isReview ? buildReviewPrompt(payload) : buildCafePrompt(payload);

    const response = await fetch(OPENAI_API_URL, {
        body: JSON.stringify({ input: prompt, model }),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        method: 'POST',
    });
    const text = await response.text();
    let result: Record<string, unknown> = {};
    try {
        result = text ? JSON.parse(text) : {};
    } catch {
        return jsonResponse({ message: 'OpenAI 응답을 해석하지 못했습니다.' }, 502);
    }
    if (!response.ok) {
        const message = (result.error as { message?: string } | undefined)?.message || '원고 생성에 실패했습니다.';
        return jsonResponse({ message }, response.status);
    }
    const raw = extractOutputText(result as Parameters<typeof extractOutputText>[0]);
    const parsed = parseCafeJson(raw);
    if (!parsed) {
        return jsonResponse({ message: '생성 결과(JSON)를 해석하지 못했습니다. 다시 시도해 주세요.' }, 502);
    }
    const usage = (result as { usage?: unknown }).usage ?? null;
    if (isReview) {
        return jsonResponse({ title: parsed.title ?? '', reviewBody: parsed.body ?? '', prompt, usage });
    }
    return jsonResponse({ content: parsed, prompt, usage });
}

export async function onRequestPost({ request, env }: FunctionContext) {
    const payload = (await request.json()) as GenerateCafePayload;
    return generateCafe(payload, env);
}
