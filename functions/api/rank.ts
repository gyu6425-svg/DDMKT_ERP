// 순위 즉시검색 — 1단계 타당성 진단.
// 목적: Cloudflare(데이터센터 IP)에서 m.search.naver.com 이 정상 응답(entry.bootstrap JSON 포함)하는지,
//       아니면 차단/축약 HTML 을 주는지 판가름한다. (개발환경에선 네이버 TLS 차단으로 직접 확인 불가)
// 사용: 배포 후 브라우저에서  /api/rank?kw=석남동 누수탐지  열기.
//   - integrated.bootstrapCount >= 10 & ssc='tab.m.all'  → 통합탭 정상
//   - blogtab.ssc 에 'm_blog' 포함 & htmlLen 수백KB         → 블로그탭 정상 (블록은 1개가 정상)
//   - htmlLen 이 수KB거나 ssc=null 이면 → 차단 (서버리스 즉시검색 불가 → 사무실 PC 폴백)

type FunctionContext = {
    request: Request;
    env: Record<string, string | undefined>;
};

const UA =
    'Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        status,
    });
}

async function probe(url: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
        const html = await res.text();
        const bootstrapCount = (html.match(/bootstrap\(/g) || []).length;
        const sscMatch = html.match(/"ssc"\s*:\s*"([^"]+)"/);
        const blocked = /captcha|자동입력 방지|비정상적인 검색/i.test(html);
        return {
            httpStatus: res.status,
            htmlLen: html.length,
            bootstrapCount,
            ssc: sscMatch ? sscMatch[1] : null,
            blockedHint: blocked,
        };
    } catch (err) {
        return { error: String((err as Error)?.message || err) };
    } finally {
        clearTimeout(timer);
    }
}

// 진단: GET /api/rank?kw=키워드
export async function onRequestGet({ request }: FunctionContext) {
    const url = new URL(request.url);
    const kw = (url.searchParams.get('kw') || '').trim();
    if (!kw) {
        return jsonResponse({ error: 'kw 파라미터가 필요합니다. 예: /api/rank?kw=석남동 누수탐지' }, 400);
    }
    const q = encodeURIComponent(kw);
    const [integrated, blogtab] = await Promise.all([
        probe(`https://m.search.naver.com/search.naver?query=${q}`),
        probe(`https://m.search.naver.com/search.naver?ssc=tab.m_blog.all&query=${q}`),
    ]);
    return jsonResponse({
        keyword: kw,
        note: 'integrated.bootstrapCount>=10 & blogtab.ssc 에 m_blog 포함이면 Cloudflare→네이버 정상(즉시검색 가능). htmlLen 수KB/ssc=null 이면 차단.',
        integrated,
        blogtab,
    });
}
