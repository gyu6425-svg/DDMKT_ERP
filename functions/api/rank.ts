// 순위 즉시검색 — 1단계 타당성 진단.
// 목적: Cloudflare(데이터센터 IP)에서 m.search.naver.com 이 정상 응답(entry.bootstrap JSON 포함)하는지,
//       아니면 차단/축약 HTML 을 주는지 판가름한다. (개발환경에선 네이버 TLS 차단으로 직접 확인 불가)
// 사용: 배포 후 브라우저에서  /api/rank?kw=석남동 누수탐지  열기.
//   - integrated.bootstrapCount >= 10 & ssc='tab.m.all'  → 통합탭 정상
//   - blogtab.ssc 에 'm_blog' 포함 & htmlLen 수백KB         → 블로그탭 정상 (블록은 1개가 정상)
//   - htmlLen 이 수KB거나 ssc=null 이면 → 차단 (서버리스 즉시검색 불가 → 사무실 PC 폴백)

// @ts-expect-error — .mjs 단일소스 파서(node 테스트와 공유). 타입 없이 import.
import { rankInPopular, rankInBlogtab, TI_URL, BL_URL, MOBILE_UA, OUT_OF_RANK } from '../lib/naverRank.mjs';

type FunctionContext = {
    request: Request;
    env: Record<string, string | undefined>;
};

const UA = MOBILE_UA;

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        status,
    });
}

async function fetchText(url: string): Promise<string | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
        if (res.status !== 200) return null;
        return await res.text();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

// 같은 blogId|keyword 단기 메모이즈(네이버 호출/차단 완화). isolate 수명 동안만 유지.
const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_TTL = 90_000;

// 측정: POST /api/rank  { keyword, blogId, logNo? } → { ti, bl, ti_status, bl_status }
export async function onRequestPost({ request }: FunctionContext) {
    let body: { keyword?: string; blogId?: string; logNo?: string };
    try {
        body = (await request.json()) as typeof body;
    } catch {
        return jsonResponse({ error: 'invalid json' }, 400);
    }
    const keyword = (body.keyword || '').trim();
    const blogId = (body.blogId || '').trim();
    const logNo = (body.logNo || '').trim();
    if (!keyword || !blogId) {
        return jsonResponse({ error: 'keyword, blogId 가 필요합니다' }, 400);
    }

    const key = `${blogId}|${logNo}|${keyword}`; // logNo 포함 — 같은 블로그·키워드라도 글마다 별도 캐시(글 단위 측정).
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) {
        return jsonResponse(hit.data);
    }

    const [tiHtml, blHtml] = await Promise.all([fetchText(TI_URL(keyword)), fetchText(BL_URL(keyword))]);
    const ti = tiHtml ? rankInPopular(tiHtml, blogId) : { rank: OUT_OF_RANK, status: 'fail' };
    const bl = blHtml ? rankInBlogtab(blHtml, blogId, logNo) : { rank: OUT_OF_RANK, status: 'fail' };
    const data = {
        keyword,
        blogId,
        ti: ti.rank,
        ti_status: ti.status,
        bl: bl.rank,
        bl_status: bl.status,
    };
    cache.set(key, { at: Date.now(), data });
    return jsonResponse(data);
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
