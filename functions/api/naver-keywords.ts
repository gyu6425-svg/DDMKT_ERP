// 파워링크 키워드 추천 — 네이버 검색광고 keywordstool 프록시.
// 로컬 naver_keyword_server.py 와 동일 동작을 Cloudflare Functions(Web Crypto)로 포팅.
// 환경변수: NAVER_AD_API_KEY / NAVER_AD_SECRET_KEY / NAVER_AD_CUSTOMER_ID (미설정 시 추천만 비활성).

type FunctionContext = {
    request: Request;
    env: Record<string, string | undefined>;
};

const BASE_URL = 'https://api.searchad.naver.com';

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json; charset=utf-8',
        },
        status,
    });
}

// 네이버 API HMAC-SHA256 서명: base64(HMAC(secret, `${timestamp}.${method}.${path}`))
async function makeSignature(secret: string, timestamp: string, method: string, path: string) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { hash: 'SHA-256', name: 'HMAC' },
        false,
        ['sign'],
    );
    const sigBuffer = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(`${timestamp}.${method}.${path}`),
    );
    let binary = '';
    const bytes = new Uint8Array(sigBuffer);
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// 검색량 정규화: "< 10" → 5, 콤마 제거.
function toInt(value: unknown): number {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === 'string') {
        const cleaned = value.replace(/</g, '').replace(/,/g, '').trim();
        if (cleaned === '10' || cleaned === '') {
            return 5;
        }
        const n = Number(cleaned);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

export async function onRequestGet({ request, env }: FunctionContext) {
    const url = new URL(request.url);
    const hint = (url.searchParams.get('q') || '').trim();
    if (!hint) {
        return jsonResponse({ error: '키워드(q)가 비어 있습니다.' }, 400);
    }

    const apiKey = env.NAVER_AD_API_KEY;
    const secretKey = env.NAVER_AD_SECRET_KEY;
    const customerId = env.NAVER_AD_CUSTOMER_ID;
    if (!apiKey || !secretKey || !customerId) {
        return jsonResponse(
            {
                error: '추천 기능 미설정 — Cloudflare 환경변수 NAVER_AD_API_KEY / NAVER_AD_SECRET_KEY / NAVER_AD_CUSTOMER_ID 를 등록하세요.',
            },
            503,
        );
    }

    const path = '/keywordstool';
    const method = 'GET';
    const timestamp = Date.now().toString();
    const signature = await makeSignature(secretKey, timestamp, method, path);

    // 네이버는 힌트 키워드의 공백을 제거해야 정상 동작. 콤마로 최대 5개.
    const cleaned = hint
        .split(',')
        .map((k) => k.trim().replace(/\s+/g, ''))
        .filter(Boolean)
        .slice(0, 5)
        .join(',');
    const query = new URLSearchParams({ hintKeywords: cleaned, showDetail: '1' }).toString();

    let resp: Response;
    try {
        resp = await fetch(`${BASE_URL}${path}?${query}`, {
            headers: {
                'X-API-KEY': apiKey,
                'X-Customer': String(customerId),
                'X-Signature': signature,
                'X-Timestamp': timestamp,
            },
            method: 'GET',
        });
    } catch {
        return jsonResponse({ error: '네이버 API 연결 실패' }, 502);
    }

    const text = await resp.text();
    let data: { keywordList?: Array<Record<string, unknown>>; title?: string; message?: string } = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        return jsonResponse({ detail: text.slice(0, 300), error: '네이버 응답 해석 실패' }, 502);
    }
    if (!resp.ok) {
        return jsonResponse(
            { detail: data?.title || data?.message || '', error: `네이버 API 오류 ${resp.status}` },
            resp.status,
        );
    }

    const out = (data.keywordList || []).map((row) => {
        const pc = toInt(row.monthlyPcQcCnt);
        const mobile = toInt(row.monthlyMobileQcCnt);
        return {
            avgDepth: row.plAvgDepth ?? 0,
            comp: row.compIdx ?? '',
            keyword: row.relKeyword ?? '',
            mobile,
            pc,
            total: pc + mobile,
        };
    });
    out.sort((a, b) => b.total - a.total);

    return jsonResponse({ keywords: out });
}

export function onRequestOptions() {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Origin': '*',
        },
        status: 204,
    });
}
