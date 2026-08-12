type GenerateBlogPayload = {
    topic?: string;
    industry?: string;
    tone?: string;
    length?: string;
    keywords?: string;
    includeHashtags?: boolean;
    audience?: string;
    mode?: string;                 // 'caseStudy' = 현장 설치 사례 템플릿(섹션태그 산문만)
    caseStudy?: CaseStudyInput;
};

// 범용 현장/사례 템플릿 입력 — AI는 "산문만" 쓰고 마커·표·소제목·보일러플레이트는 클라이언트가 조립.
//   업종 고정 없음: 본문은 "텍스트 섹션" 자유 리스트(순서대로). 표/사진 위치는 클라이언트가 처리.
type CaseStudyInput = {
    keyword?: string;      // 지역+카테고리 주 키워드
    keyword2?: string;     // 보조 키워드
    keywordCount?: number; // 반복 목표(기본 6)
    subjectType?: string;  // 대상/현장 유형(업종 무관 자유: 마라탕 전문점, 누수 현장 등)
    introHook?: string;    // 도입 팩트 훅 seed
    overview?: string;     // 현장/대상 개요·상황
    sections?: Array<{ title?: string; notes?: string }>; // 본문 텍스트 섹션(순서대로, AI가 산문 작성)
    takeaway?: string;     // 마무리 seed
    freeform?: boolean;    // 간편 모드 — brief 한 곳에 다 적으면 AI가 소제목까지 나눠 구조화
    brief?: string;        // 간편 모드 입력(내용 전부)
};

// 섹션태그 산문만 출력. 사진/표/해시태그/CTA 전부 금지.
//   상세: ===INTRO=== / ===S1===… / ===TAKEAWAY===
//   간편(freeform): ===INTRO=== / ===SUB===(첫줄=소제목|부제, 이후 산문) 반복 / ===TAKEAWAY===
export function buildCaseStudyPrompt(cs: CaseStudyInput): string {
    const kw = (cs.keyword || '').trim();
    const nk = cs.keywordCount && cs.keywordCount > 0 ? cs.keywordCount : 6;
    if (cs.freeform) {
        return [
            '너는 한국어 "현장/사례" 블로그 카피라이터다. 아래 [내용]을 바탕으로 네이버 블로그 본문 산문을 소제목으로 나눠 구조화해 작성한다(업종 자유).',
            '',
            `[주 키워드] ${kw}`,
            cs.keyword2 ? `[보조 키워드] ${cs.keyword2}` : '',
            cs.subjectType ? `[대상/현장 유형] ${cs.subjectType}` : '',
            (cs.brief || '').trim() ? `[내용]\n${(cs.brief || '').trim()}` : '[내용] (없음 — 아래 규칙대로 스스로 구성)',
            '',
            '규칙(엄수):',
            '- 격식체(~습니다/~입니다), 3인칭. 인사말(안녕하세요 등) 절대 금지 — 사실로 바로 시작.',
            '- 도입부는 사실로 시작하고, [주 키워드]를 3번째 문장쯤에 자연스럽게 넣는다(첫 문장 금지).',
            `- [주 키워드]를 본문 전체에 약 ${nk}회 자연스럽게 반복(억지 금지).`,
            '- [내용]이 있으면 그것을, 없으면 [주 키워드]·[대상/현장 유형]에 맞는 현실적이고 구체적인 현장 사례를 스스로 구성해 작성한다.',
            '- 흐름에 맞게 3~6개 소제목 섹션으로 나눈다. 소제목은 짧고 명확히(예: "탐지 과정 | 비파괴 위치 특정").',
            '- 해시태그·CTA·문의유도·제목후보·요약·이모지·마크다운 전부 금지.',
            '- "사진","이미지","「 」","부제목", 표는 쓰지 마라(시스템이 넣는다).',
            '- 확인되지 않은 수치·상호명·주소·날짜는 지어내지 않는다(과장·허위 금지).',
            '',
            '출력 형식 — 아래 태그를 그 줄에 그대로 쓴다:',
            '===INTRO===',
            '(도입 산문 3~4문장)',
            '===SUB===',
            '소제목 | 부제',
            '(그 섹션 산문 2~4문장)',
            '===SUB===',
            '다음 소제목 | 부제',
            '(산문)',
            '(필요한 만큼 ===SUB=== 반복)',
            '===TAKEAWAY===',
            '(핵심을 요약하는 한 줄)',
        ]
            .filter((line) => line !== '')
            .join('\n');
    }
    const secs = cs.sections || [];
    const secMemo = secs
        .map((s, i) => `  섹션 ${i + 1} [${(s.title || '').trim() || `섹션${i + 1}`}] 메모: ${(s.notes || '').trim()}`)
        .join('\n');
    const secTags = secs
        .map((_, i) => `===S${i + 1}===\n(섹션 ${i + 1}의 산문 2~4문장, 그 섹션 메모에 충실히)`)
        .join('\n');
    const n = cs.keywordCount && cs.keywordCount > 0 ? cs.keywordCount : 6;

    return [
        '너는 한국어 "현장/사례" 블로그 카피라이터다. 아래 정보로 네이버 블로그 본문의 "산문 부분만" 작성한다.',
        '이 글은 업체가 특정 현장/작업 사례를 정보/전문 톤으로 설명하는 글이다(업종은 자유).',
        '',
        `[주 키워드] ${kw}`,
        cs.keyword2 ? `[보조 키워드] ${cs.keyword2}` : '',
        cs.subjectType ? `[대상/현장 유형] ${cs.subjectType}` : '',
        cs.introHook ? `[도입 팩트 훅 seed] ${cs.introHook}` : '',
        cs.overview ? `[현장/대상 개요·상황] ${cs.overview}` : '',
        secMemo ? `[본문 섹션별 메모]\n${secMemo}` : '',
        cs.takeaway ? `[마무리 한 줄 seed] ${cs.takeaway}` : '',
        '',
        '규칙(엄수):',
        '- 격식체(~습니다/~입니다), 3인칭. 인사말(안녕하세요 등) 절대 금지 — 업종/대상 사실로 바로 시작.',
        '- 도입부는 사실로 시작하고, [주 키워드]를 3번째 문장쯤에 자연스럽게 넣는다(첫 문장에는 넣지 마라).',
        `- [주 키워드]를 본문 전체에 약 ${n}회 자연스럽게 반복(억지 반복 금지).`,
        '- 해시태그·CTA·문의유도 문장·제목후보·요약·이모지·마크다운(**,##) 전부 금지.',
        '- "사진","이미지","「 」","부제목", 표는 쓰지 마라(그건 시스템이 넣는다). 산문 문단만 써라.',
        '- 섹션 메모가 있으면 충실히 반영하고, 없으면 [대상/현장 유형]·섹션 소제목·[주 키워드]에 맞는 구체적이고 전문적인 내용을 자연스럽게 작성한다(막연한 일반론 금지).',
        '- 입력이 적어도 실제 사례처럼 상황·과정·판단 근거를 구체적으로 쓰되, 확인되지 않은 수치·상호명·주소·날짜는 지어내지 않는다(과장·허위 금지).',
        '',
        '출력 형식 — 아래 태그를 각 줄에 그대로 쓰고, 태그 다음 줄부터 그 섹션 산문만 써라(다른 텍스트 금지):',
        '===INTRO===',
        '(도입 산문 3~4문장)',
        secTags,
        '===TAKEAWAY===',
        '(핵심을 요약하는 한 줄)',
    ]
        .filter((line) => line !== '')
        .join('\n');
}

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

const LENGTH_GUIDE: Record<string, string> = {
    long: '2000~2800자 분량으로 깊이 있게',
    medium: '1200~1800자 분량으로',
    short: '600~900자 분량으로 간결하게',
};

const TONE_GUIDE: Record<string, string> = {
    info: '정보 전달 중심의 전문적이고 신뢰감 있는',
    promo: '구매·문의를 유도하는 설득력 있는 홍보',
    review: '실제 사용 후기처럼 생생하고 친근한',
    story: '스토리텔링으로 몰입감 있게 풀어가는',
};

export function buildBlogPrompt(payload: GenerateBlogPayload): string {
    const topic = (payload.topic || '').trim();
    const industry = (payload.industry || '').trim();
    const audience = (payload.audience || '').trim();
    const keywords = (payload.keywords || '').trim();
    const lengthGuide = LENGTH_GUIDE[payload.length || 'medium'] || LENGTH_GUIDE.medium;
    const toneGuide = TONE_GUIDE[payload.tone || 'info'] || TONE_GUIDE.info;

    const lines = [
        `너는 한국어 블로그/SEO 카피라이터다. 아래 조건으로 네이버 블로그에 올릴 한국어 글을 작성해줘.`,
        ``,
        `[주제] ${topic}`,
        industry ? `[업종] ${industry}` : '',
        audience ? `[타깃 독자] ${audience}` : '',
        keywords ? `[반드시 자연스럽게 포함할 키워드] ${keywords}` : '',
        `[톤] ${toneGuide} 어조`,
        `[분량] ${lengthGuide}`,
        ``,
        `요구사항(순서대로):`,
        `- 첫 줄 "제목 후보:" 에 클릭을 부르는 제목 3개를 1) 2) 3) 으로 제시.`,
        `- 다음 줄에 그중 가장 좋은 하나를 "제목: ..." 형식으로 작성.`,
        `- 제목 아래 2~3문장의 도입부(요약)로 시작하고, 핵심 키워드를 도입부 첫 문장에 자연스럽게 포함(네이버는 첫 문장을 검색 미리보기로 노출).`,
        `- 본문은 2~4개의 소제목(■ 로 시작)으로 구조화하고, 소제목 사이에 "(이미지)" 표시로 이미지 들어갈 위치를 제안.`,
        `- 핵심 키워드를 제목·도입부·본문에 총 3~5회 자연스럽게 배치(과도한 반복 금지, SEO).`,
        `- 과장·허위 표현은 피하고 신뢰감 있게.`,
        `- 마지막에 문의/방문을 유도하는 한 문장 CTA.`,
        `- 그 다음 줄에 "[요약]" 으로 시작하는 80~100자 한 줄 요약(검색 설명용).`,
        payload.includeHashtags === false ? '' : `- 글 맨 끝에 관련 해시태그 8~12개(#로 시작, 한 줄).`,
        ``,
        `마크다운 기호(**, ## 등)는 쓰지 말고 순수 텍스트로 출력해줘.`,
    ];

    return lines.filter((line) => line !== '').join('\n');
}

export function extractOutputText(result: {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}): string {
    if (typeof result.output_text === 'string' && result.output_text.trim()) {
        return result.output_text.trim();
    }

    const parts: string[] = [];
    (result.output || []).forEach((item) => {
        (item.content || []).forEach((content) => {
            if (content.type === 'output_text' && typeof content.text === 'string') {
                parts.push(content.text);
            }
        });
    });
    return parts.join('').trim();
}

export async function generateBlog(payload: GenerateBlogPayload, env: FunctionContext['env']) {
    const isCaseStudy = payload.mode === 'caseStudy';
    if (isCaseStudy) {
        if (!payload.caseStudy || !(payload.caseStudy.keyword || '').trim()) {
            return jsonResponse({ message: '주 키워드를 입력해주세요.' }, 400);
        }
    } else if (!payload.topic || !payload.topic.trim()) {
        return jsonResponse({ message: '주제를 입력해주세요.' }, 400);
    }

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
        return jsonResponse({ message: 'Cloudflare 환경변수 OPENAI_API_KEY가 필요합니다.' }, 500);
    }

    // 현장/사례 템플릿은 구조가 정해져 있어 gpt-5-mini(출력 $2/M, gpt-5.5의 1/20) + 추론 low 로 충분.
    //   env OPENAI_CASE_MODEL 로 되돌리기·상향 가능.
    const model = isCaseStudy
        ? (env.OPENAI_CASE_MODEL || 'gpt-5-mini')
        : (env.OPENAI_TEXT_MODEL || env.OPENAI_IMAGE_MODEL || 'gpt-5.5');
    const prompt = isCaseStudy ? buildCaseStudyPrompt(payload.caseStudy!) : buildBlogPrompt(payload);
    const reqBody: Record<string, unknown> = { input: prompt, model };
    if (isCaseStudy) reqBody.reasoning = { effort: 'low' };

    const response = await fetch(OPENAI_API_URL, {
        body: JSON.stringify(reqBody),
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
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
        const message =
            (result.error as { message?: string } | undefined)?.message ||
            '블로그 생성에 실패했습니다.';
        return jsonResponse({ message }, response.status);
    }

    const content = extractOutputText(result as Parameters<typeof extractOutputText>[0]);
    if (!content) {
        return jsonResponse({ message: '생성된 글이 비어 있습니다.' }, 502);
    }

    return jsonResponse({
        prompt,
        text: content,
        usage: (result as { usage?: unknown }).usage ?? null,
    });
}

export async function onRequestPost({ request, env }: FunctionContext) {
    const payload = (await request.json()) as GenerateBlogPayload;
    return generateBlog(payload, env);
}
