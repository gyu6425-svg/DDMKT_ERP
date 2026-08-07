// 업체 정보 붙여넣기 → 제품/서비스 키워드 추출 + 위치 정규화. 플레이스가 없는 업체의 접수 경로.
//   왜: 인기탭 스캔의 두 축은 '지역 × 제품키워드'인데, 플레이스가 없으면 둘 다 못 뽑는다.
//       고객이 홈페이지 소개글·메뉴판을 그대로 붙여넣으면 GPT 가 검색 가능한 명사구로 정리한다.
//   ★ 결과는 자동 확정하지 않는다 — 프론트가 체크박스로 보여주고 고객이 고른 것만 스캔한다.
//     (GPT 추출은 항상 군더더기가 섞이는데, 자동 확정하면 그게 조용히 스캔 비용·오탐이 된다.)
//   환경변수: OPENAI_API_KEY / OPENAI_CAFE_TEXT_MODEL(기본 gpt-5-mini)
type FunctionContext = { request: Request; env: Record<string, string | undefined> };

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
// 방침: 추출은 최대로 하고, 쓸 만한지는 인기탭 스캔이 판정한다.
//   한 번에 다 넣으면 뒤쪽이 잘리므로(6,000자 시절 블로그 166개 글의 31%만 들어갔다)
//   긴 원문은 조각으로 나눠 병렬 호출하고 합친다. gpt-5-mini 입력은 싸다 — 조각당 약 6원.
const MAX_INPUT = 60000;     // 전체 입력 상한(블로그 전 글 제목 + 사이트 전 페이지)
const CHUNK = 14000;         // 조각 하나의 크기
const MAX_CHUNKS = 4;        // 조각 수 상한 → 최대 약 24원
const MAX_KEYWORDS = 80;     // 반환 상한. 판정은 스캔이 하므로 넉넉히 남긴다

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' },
        status,
    });
}

function extractOutputText(result: {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}): string {
    if (typeof result.output_text === 'string' && result.output_text.trim()) return result.output_text.trim();
    const parts: string[] = [];
    (result.output || []).forEach((item) => {
        (item.content || []).forEach((c) => {
            if (c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
        });
    });
    return parts.join('').trim();
}

function parseJsonLoose(text: string): Record<string, unknown> | null {
    const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
    if (s < 0 || e <= s) return null;
    try {
        return JSON.parse(cleaned.slice(s, e + 1)) as Record<string, unknown>;
    } catch {
        return null;
    }
}

// 지역어가 섞인 제품키워드는 스캔 축이 겹쳐 '강남 강남네일' 같은 조합을 만든다 → 지역 접두를 떼어낸다.
const REGION_TAIL = /(특별자치시|특별자치도|특별시|광역시|시|군|구|동|읍|면|리|로|길|역)$/;

function cleanProduct(raw: unknown): string {
    let t = String(raw ?? '').replace(/[^가-힣a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    // '강남 네일' 처럼 앞에 지역이 붙어 오면 지역만 제거(뒤 단어가 실제 제품).
    const parts = t.split(' ');
    if (parts.length > 1 && REGION_TAIL.test(parts[0]) && parts[0].length <= 5) {
        t = parts.slice(1).join(' ');
    }
    return t.length >= 2 && t.length <= 20 ? t : '';
}

const PROMPT = (text: string, hint: string) => `너는 네이버 카페 인기글 마케팅의 키워드 리서처다.
아래는 어떤 업체의 소개/메뉴/서비스 설명 원문이다. 여기에서 **고객이 네이버에 실제로 검색할 만한
제품·서비스 키워드**만 뽑아라.

규칙:
1. 지역명(시/구/동/역 이름)은 절대 넣지 마라. 지역은 별도로 붙인다. "강남 네일" → "네일" 만.
2. 업체 고유 브랜드명·상호·사람 이름은 제외한다. 일반명사구만.
3. 검색되는 형태로 정규화한다. "저희만의 특별한 속눈썹 연장술" → "속눈썹연장".
4. 너무 일반적인 말(서비스, 상담, 문의, 안내, 소개, 오시는길)은 제외한다.
5. 2~20자, 최대 30개. 중요한 것부터. 원문에 근거가 있으면 최대한 많이 뽑아라(누락이 더 나쁘다).
6. 원문에 근거 없는 키워드를 지어내지 마라.

각 키워드에 kind 를 붙여라: "core"(업종 대표어) | "menu"(개별 시술/메뉴/품목) | "niche"(세부 상황·문제).

업종 힌트: ${hint || '(없음)'}

원문:
"""
${text}
"""

JSON 만 출력: {"products":[{"kw":"속눈썹연장","kind":"menu"}],"biz":"업종 한 줄 요약"}`;

// 긴 원문을 조각으로 자른다 — 줄 경계에서만 자른다(블로그 글 제목이 한 줄이라 중간을 끊으면 망가진다).
function chunkText(text: string): string[] {
    if (text.length <= CHUNK) return [text];
    const out: string[] = [];
    let cur = '';
    for (const line of text.split('\n')) {
        if (cur.length + line.length + 1 > CHUNK && cur) { out.push(cur); cur = ''; }
        cur += (cur ? '\n' : '') + line.slice(0, CHUNK);
        if (out.length >= MAX_CHUNKS - 1 && cur.length >= CHUNK) break;
    }
    if (cur) out.push(cur);
    return out.slice(0, MAX_CHUNKS);
}

async function extractOnce(chunk: string, hint: string, apiKey: string, model: string) {
    let response: Response;
    try {
        response = await fetch(OPENAI_API_URL, {
            body: JSON.stringify({
                input: PROMPT(chunk, hint),
                model,
                reasoning: { effort: 'low' },
                text: { format: { type: 'json_object' } },
            }),
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            method: 'POST',
        });
    } catch {
        return { error: '추출 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', status: 502 };
    }
    const raw = await response.text();
    let result: Record<string, unknown> = {};
    try {
        result = raw ? JSON.parse(raw) : {};
    } catch {
        return { error: '추출 응답을 해석하지 못했습니다.', status: 502 };
    }
    if (!response.ok) {
        return { error: (result.error as { message?: string } | undefined)?.message || '키워드 추출에 실패했습니다.', status: response.status };
    }
    const parsed = parseJsonLoose(extractOutputText(result as Parameters<typeof extractOutputText>[0]));
    if (!parsed) return { error: '추출 결과(JSON)를 해석하지 못했습니다.', status: 502 };
    return { parsed, usage: (result as { usage?: { input_tokens?: number; output_tokens?: number } }).usage };
}

export async function onRequestPost({ request, env }: FunctionContext) {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return jsonResponse({ message: 'Cloudflare 환경변수 OPENAI_API_KEY가 필요합니다.' }, 500);

    let payload: { text?: string; hint?: string };
    try {
        payload = await request.json();
    } catch {
        return jsonResponse({ message: '요청 본문(JSON)을 해석하지 못했습니다.' }, 400);
    }
    const text = (payload.text || '').trim().slice(0, MAX_INPUT);
    if (text.length < 10) return jsonResponse({ message: '업체 정보를 붙여넣어 주세요(10자 이상).' }, 400);

    const model = env.OPENAI_CAFE_TEXT_MODEL || 'gpt-5-mini';
    const hint = (payload.hint || '').trim();
    const chunks = chunkText(text);
    const runs = await Promise.all(chunks.map((c) => extractOnce(c, hint, apiKey, model)));

    // 조각이 하나라도 성공했으면 진행한다 — 전부 실패했을 때만 에러로 돌린다.
    const okRuns = runs.filter((r): r is { parsed: Record<string, unknown>; usage?: { input_tokens?: number; output_tokens?: number } } => 'parsed' in r);
    if (!okRuns.length) {
        const first = runs[0] as { error?: string; status?: number };
        return jsonResponse({ message: first?.error || '키워드 추출에 실패했습니다.' }, first?.status || 502);
    }

    const seen = new Set<string>();
    const products: { kw: string; kind: string }[] = [];
    for (const run of okRuns) {
        for (const row of (run.parsed.products as unknown[]) || []) {
            const r = row as { kw?: unknown; kind?: unknown };
            const kw = cleanProduct(typeof row === 'string' ? row : r.kw);
            const key = kw.replace(/\s/g, '');
            if (!kw || seen.has(key)) continue;
            seen.add(key);
            const kind = String(r.kind ?? 'menu');
            products.push({ kw, kind: ['core', 'menu', 'niche'].includes(kind) ? kind : 'menu' });
            if (products.length >= MAX_KEYWORDS) break;
        }
        if (products.length >= MAX_KEYWORDS) break;
    }
    if (!products.length) {
        return jsonResponse({ message: '검색 가능한 제품·서비스 키워드를 찾지 못했습니다. 메뉴나 시술명이 담긴 문구를 붙여넣어 주세요.' }, 422);
    }
    const usage = okRuns.reduce((a, r) => ({
        input_tokens: a.input_tokens + (r.usage?.input_tokens || 0),
        output_tokens: a.output_tokens + (r.usage?.output_tokens || 0),
    }), { input_tokens: 0, output_tokens: 0 });
    return jsonResponse({
        biz: String(okRuns[0].parsed.biz ?? ''), chars: text.length, chunks: chunks.length,
        model, products, usage,
    });
}

export function onRequestOptions() {
    return new Response(null, {
        headers: { 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Origin': '*' },
        status: 204,
    });
}
