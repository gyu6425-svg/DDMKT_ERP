// 플레이스 주소 → 업체명 추출 → 검색광고 keywordstool(검색량). 접수 '키워드형' 인기글 조회용.
//   브라우저는 place.naver 를 CORS 로 못 긁으므로 이 CF 함수가 대신 fetch(데이터센터 IP도 place 페이지는 접근 가능).
//   naver.me 단축링크는 리다이렉트 자동 추적. 환경변수: NAVER_AD_API_KEY / SECRET_KEY / CUSTOMER_ID.
type FunctionContext = { request: Request; env: Record<string, string | undefined> };
const BASE_URL = 'https://api.searchad.naver.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' },
        status,
    });
}

async function makeSignature(secret: string, timestamp: string, method: string, path: string) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { hash: 'SHA-256', name: 'HMAC' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${method}.${path}`));
    let binary = '';
    const bytes = new Uint8Array(sig);
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function toInt(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const c = value.replace(/</g, '').replace(/,/g, '').trim();
        if (c === '10' || c === '') return 5;
        const n = Number(c);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

// 플레이스 페이지 HTML → 업체명. og:title 우선, <title> 폴백. " : 네이버…" 등 꼬리 제거.
function extractName(html: string): string {
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    let name = og?.[1] || (html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? '');
    name = name.replace(/\s*[:|\-–]\s*네이버.*$/i, '').replace(/\s*:\s*방문자.*$/i, '').trim();
    return name;
}

async function keywordstool(env: Record<string, string | undefined>, hint: string) {
    const apiKey = env.NAVER_AD_API_KEY, secretKey = env.NAVER_AD_SECRET_KEY, customerId = env.NAVER_AD_CUSTOMER_ID;
    if (!apiKey || !secretKey || !customerId) throw new Error('검색량 API 미설정(NAVER_AD_*)');
    const path = '/keywordstool', method = 'GET', timestamp = Date.now().toString();
    const signature = await makeSignature(secretKey, timestamp, method, path);
    const cleaned = hint.split(',').map((k) => k.trim().replace(/\s+/g, '')).filter(Boolean).slice(0, 5).join(',');
    const query = new URLSearchParams({ hintKeywords: cleaned, showDetail: '1' }).toString();
    const resp = await fetch(`${BASE_URL}${path}?${query}`, {
        headers: { 'X-API-KEY': apiKey, 'X-Customer': String(customerId), 'X-Signature': signature, 'X-Timestamp': timestamp },
        method: 'GET',
    });
    const text = await resp.text();
    const data = text ? JSON.parse(text) : {};
    if (!resp.ok) throw new Error(`네이버 API 오류 ${resp.status}`);
    const out = (data.keywordList || []).map((row: Record<string, unknown>) => {
        const pc = toInt(row.monthlyPcQcCnt), mobile = toInt(row.monthlyMobileQcCnt);
        return { keyword: row.relKeyword ?? '', pc, mobile, total: pc + mobile, comp: row.compIdx ?? '' };
    });
    out.sort((a: { total: number }, b: { total: number }) => b.total - a.total);
    return out;
}

export async function onRequestGet({ request, env }: FunctionContext) {
    const url = new URL(request.url);
    const placeUrl = (url.searchParams.get('url') || '').trim();
    if (!placeUrl) return jsonResponse({ error: '플레이스 주소(url)가 비어 있습니다.' }, 400);

    // 1) 플레이스 페이지 fetch(naver.me 리다이렉트 자동 추적) → 업체명 추출
    let name = '';
    try {
        const r = await fetch(placeUrl.startsWith('http') ? placeUrl : `https://${placeUrl}`, {
            headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR' }, redirect: 'follow',
        });
        name = extractName(await r.text());
    } catch {
        return jsonResponse({ error: '플레이스 페이지를 불러오지 못했습니다. 주소를 확인해 주세요.' }, 502);
    }
    if (!name) return jsonResponse({ error: '업체명을 찾지 못했습니다. 플레이스 주소가 맞는지 확인해 주세요.' }, 404);

    // 2) 업체명 → 검색량 키워드
    try {
        const keywords = await keywordstool(env, name);
        return jsonResponse({ name, keywords });
    } catch (e) {
        return jsonResponse({ name, error: e instanceof Error ? e.message : '검색량 조회 실패' }, 502);
    }
}

export function onRequestOptions() {
    return new Response(null, {
        headers: { 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Origin': '*' },
        status: 204,
    });
}
