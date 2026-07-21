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
    count?: number; // 카드(이미지) 장수 = 본문 「사진 N」 마커 개수
    layout?: 'markers' | 'bottom'; // markers=본문에 「사진 N」 인터리브 / bottom=이미지 상단 일괄 + 본문 하단(마커 없음, [출처] 끝)
    variant?: 'info-guide'; // 더맨시스템 정보형 — 별도 프롬프트(functions/lib/cafeInfoGuide.mjs). 없으면 기존 경로 그대로.
    facts?: string[];       // 사용자가 확인해 준 사실(허가·자격 등). 모델이 자격을 지어내지 못하게 하는 근거 블록.
};

// 정보형은 별도 모듈 — 배포본과 로컬 dev 서버가 같은 프롬프트를 쓰게 하기 위함(복붙 드리프트 방지).
import { buildInfoGuidePrompt, bodyLen as infoBodyLen, INFO_GUIDE_LEN } from '../lib/cafeInfoGuide.mjs';

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
    const count = Math.max(1, Math.min(9, Number(payload.count) || 9));
    // 하단형(누수탐지2) — 이미지는 상단 일괄, 본문은 마커 없이 하나의 후기 글 + [출처] 마무리.
    if (payload.layout === 'bottom') {
        return [
            `너는 네이버 카페 지역글 전문 카피라이터다. 아래 업체의 "${keyword}" 홍보 카페 본문을 **[${tone.name}]** 문체로 쓴다.`,
            `업체명 "${brand} ${branch}", 지역 "${region}", 업종 "${business}", 전화 "${phone}".`,
            ``,
            `[문체 지시 · ${tone.name}] ${tone.guide}`,
            ``,
            `[반드시 지킬 형식]`,
            `- 이미지는 본문 위에 모두 배치되므로 「사진 N」 같은 마커를 절대 넣지 마라. 본문은 하나의 이어지는 자연스러운 후기 글이다.`,
            `- 소제목 2~3개를 "부제목 : <내용>" 형식(한 줄 단독)으로 자연스럽게 배치. 그중 1개는 지역명(${region})+키워드를 포함해 검색 노출에 도움되게.`,
            `- 업체명과 전화(${phone})는 정확히 표기. 과장·허위·별점·가짜 이름 금지. 마크다운·이모지 금지, 순수 텍스트.`,
            `- **분량 2000~2500자(공백 포함)로 충분히 상세하게** 작성. 마지막에 상담 유도 한 줄 뒤, 맨 끝에 반드시 "[출처] ${brand} ${branch}" 한 줄로 마무리.`,
            ``,
            `[본문에 자연스럽게 녹일 소재]`,
            material,
            ``,
            `반드시 **JSON 객체 하나만** 출력한다(코드펜스·설명 금지): {"title":"클릭을 부르는 제목 1개","body":"본문 전체(줄바꿈 포함, 마커 없음, 끝에 [출처] 줄)","topics":[]}`,
        ].join('\n');
    }
    return [
        `너는 네이버 카페 지역글 전문 카피라이터다. 아래 업체의 "${keyword}" 홍보를 위한 카페 본문을 **[${tone.name}]** 문체로 쓴다.`,
        `업체명 "${brand} ${branch}", 지역 "${region}", 업종 "${business}", 전화 "${phone}".`,
        ``,
        `[문체 지시 · ${tone.name}] ${tone.guide}`,
        ``,
        `[반드시 지킬 형식]`,
        `- 위 문체를 유지하되 담백하고 자연스럽게. 과장·허위·별점·가짜 이름 금지.`,
        `- **맨 처음은 사진 마커 없이 인사말 문단으로 시작한다.** 그 인사말 문단 다음 줄에 「사진 1」을 넣고, 이후 「사진 2」~「사진 ${count}」를 본문 흐름에 맞춰 순서대로 각각 한 줄 단독으로 배치(마커 정확히 ${count}개, 그 이상도 이하도 아님). 즉 순서는 [인사말 문단]→「사진 1」→(부제목/문단)→「사진 2」→… 이다.`,
        `- **각 「사진 N」 마커 다음에는 반드시 본문 문단(3~5문장, 구체적·서술적으로)을 이어 쓴다.** 부제목만 있고 본문이 없는 사진이 하나도 없게 한다(부제목 나열 금지).`,
        `- 소제목(부제목): 사진들 중 절반가량만 "부제목 : <내용>"(한 줄 단독)을 그 사진의 본문 문단 바로 앞에 넣어라(질문형 "~일까요?"·핵심 혜택형 섞어). 그중 1~2개는 지역명(${region})+키워드 포함(검색 노출). 인사말(첫 문단)에는 부제목 없음. **형식은 정확히 "부제목 : 내용" 한 번만 — "부제목"이라는 단어를 절대 두 번 쓰지 마라.**`,
        `- 업체명과 전화(${phone})는 정확히 표기. 마지막에 상담 유도 한 줄.`,
        `- **분량은 공백 포함 2,000~2,300자. 반드시 2,000자 이상(2,000자 미만은 규칙 위반), 2,300자를 크게 넘기지 말 것.** 각 문단을 적당히 충실하게(한두 문장으로 끝내지 말 것). 마크다운·이모지 금지, 순수 텍스트.`,
        ``,
        `[본문에 자연스럽게 녹일 소재]`,
        material,
        ``,
        `- 추가로, 위 「사진 1」~「사진 ${count}」 각 자리에 들어갈 카드 이미지의 큰 제목을 "topics" 배열로 준다(정확히 ${count}개, 순서 일치). topics[0]은 커버라 업종("${business}"), 나머지는 각 사진 자리의 핵심 주제를 6~10자로 짧게(예: "이런 누수 아니신가요", "빠를수록 저렴").`,
        `반드시 **JSON 객체 하나만** 출력한다(코드펜스·설명 금지): {"title":"클릭을 부르는 제목 1개","body":"본문 전체(줄바꿈 포함, 「사진 N」 마커 포함)","topics":["${count}개"]}`,
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
    const isReview = payload.mode === 'review';
    // 후기 원고 = 저렴한 미니 모델(gpt-5.4-mini) — 품질 유지하며 출력 단가 20x↓. 카드/구조화 JSON 은 기존 모델.
    const model = isReview
        ? (env.OPENAI_CAFE_TEXT_MODEL || 'gpt-5-mini')
        : (env.OPENAI_TEXT_MODEL || env.OPENAI_IMAGE_MODEL || 'gpt-5.5');
    const isInfoGuide = isReview && payload.variant === 'info-guide';
    const basePrompt = isInfoGuide
        ? buildInfoGuidePrompt(payload)
        : isReview ? buildReviewPrompt(payload) : buildCafePrompt(payload);
    // 정보형은 구조 제약이 많아 기존 하한(2,000)으로는 짧게 끝난다 → 자체 하한을 쓴다.
    const minLen = isInfoGuide ? INFO_GUIDE_LEN.min : 2000;

    // OpenAI 1회 호출 + 파싱. reasoning 'low'.
    async function callModel(promptStr: string) {
        const response = await fetch(OPENAI_API_URL, {
            body: JSON.stringify({ input: promptStr, model, reasoning: { effort: 'low' } }),
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            method: 'POST',
        });
        const text = await response.text();
        let result: Record<string, unknown> = {};
        try {
            result = text ? JSON.parse(text) : {};
        } catch {
            return { error: 'OpenAI 응답을 해석하지 못했습니다.', status: 502 };
        }
        if (!response.ok) {
            return { error: (result.error as { message?: string } | undefined)?.message || '원고 생성에 실패했습니다.', status: response.status };
        }
        const parsed = parseCafeJson(extractOutputText(result as Parameters<typeof extractOutputText>[0]));
        return { parsed, usage: (result as { usage?: Record<string, number> }).usage ?? null };
    }

    // 순수 글자수(「사진 N」·줄바꿈 제외) — 최소 분량 판정용.
    const bodyLen = (p: Record<string, unknown> | null | undefined) =>
        String((p?.body ?? '')).replace(/「사진\s*\d+」/g, '').replace(/[\r\n]/g, '').length;
    const sumUsage = (a: Record<string, number> | null, b: Record<string, number> | null) => {
        if (!a) return b; if (!b) return a;
        const out: Record<string, number> = { ...a };
        for (const k of ['input_tokens', 'output_tokens', 'total_tokens']) out[k] = (a[k] || 0) + (b[k] || 0);
        return out;
    };

    let r1 = await callModel(basePrompt);
    if ('error' in r1 && r1.error) return jsonResponse({ message: r1.error }, r1.status);
    let parsed = r1.parsed;
    let usage = r1.usage;
    let prompt = basePrompt;
    // 후기 원고 최소 분량 보장(사용자: 2,000자 미만 금지) — 짧으면 1회 재생성 후 더 긴 쪽 채택.
    if (isReview && parsed && bodyLen(parsed) < minLen) {
        const longer = basePrompt + `\n\n[매우 중요] 방금 결과가 ${bodyLen(parsed)}자로 ${minLen.toLocaleString()}자 미만이라 규칙 위반이다. 형식(사진 마커 개수·부제목 개수)은 그대로 두고, 각 「사진」 뒤 본문만 4~5문장으로 더 길고 구체적으로 늘려서 반드시 공백 포함 ${minLen.toLocaleString()}자 이상으로 다시 작성하라.`;
        const r2 = await callModel(longer);
        if (!('error' in r2) && r2.parsed && bodyLen(r2.parsed) > bodyLen(parsed)) {
            parsed = r2.parsed; usage = sumUsage(usage, r2.usage); prompt = longer;
        } else {
            usage = sumUsage(usage, ('error' in r2) ? null : r2.usage);
        }
    }
    if (!parsed) {
        return jsonResponse({ message: '생성 결과(JSON)를 해석하지 못했습니다. 다시 시도해 주세요.' }, 502);
    }
    if (isReview) {
        return jsonResponse({
            title: parsed.title ?? '',
            reviewBody: parsed.body ?? '',
            topics: Array.isArray(parsed.topics) ? parsed.topics : [],
            prompt,
            usage,
            model,
        });
    }
    return jsonResponse({ content: parsed, prompt, usage });
}

export async function onRequestPost({ request, env }: FunctionContext) {
    const payload = (await request.json()) as GenerateCafePayload;
    return generateCafe(payload, env);
}
