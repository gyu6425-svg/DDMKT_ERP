type GenerateBlogPayload = {
    topic?: string;
    industry?: string;
    tone?: string;
    length?: string;
    keywords?: string;
    includeHashtags?: boolean;
    audience?: string;
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
        `요구사항:`,
        `- 첫 줄에 클릭을 부르는 제목을 "제목: ..." 형식으로 작성`,
        `- 본문은 2~4개의 소제목(■ 로 시작)으로 구조화`,
        `- 핵심 키워드를 제목과 본문 앞부분에 자연스럽게 배치(SEO)`,
        `- 과장·허위 표현은 피하고 신뢰감 있게`,
        `- 마지막에 문의/방문을 유도하는 한 문장 CTA`,
        payload.includeHashtags === false ? '' : `- 글 맨 끝에 관련 해시태그 8~12개(#로 시작, 한 줄)`,
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
    if (!payload.topic || !payload.topic.trim()) {
        return jsonResponse({ message: '주제를 입력해주세요.' }, 400);
    }

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
        return jsonResponse({ message: 'Cloudflare 환경변수 OPENAI_API_KEY가 필요합니다.' }, 500);
    }

    const model = env.OPENAI_TEXT_MODEL || env.OPENAI_IMAGE_MODEL || 'gpt-5.5';
    const prompt = buildBlogPrompt(payload);

    const response = await fetch(OPENAI_API_URL, {
        body: JSON.stringify({ input: prompt, model }),
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
