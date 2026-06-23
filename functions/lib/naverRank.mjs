// 네이버 순위 파서 — crawler/blog_rank_crawler.py 의 검증된 파서를 JS 단일소스로 포팅.
// Cloudflare Function(functions/api/rank.ts)·dev 서버·node 테스트가 이 한 파일을 공유 → 파이썬↔JS
// 외 추가 분기(TS/mjs 두 벌) 위험 제거. 골든 회귀: naverRank.test.mjs (석남동 ti=3/bl=out, 인천 ti=1).
//
// 측정 URL: 통합탭= m.search.naver.com/search.naver?query=KW, 블로그탭= ...?ssc=tab.m_blog.all&query=KW
// 모바일 UA 여야 entry.bootstrap JSON 이 내려온다.

export const OUT_OF_RANK = 99;
export const MOBILE_UA =
    'Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

const BLOG_RE = /blog\.naver\.com\/([^/?#"\\]+)/;
const POST_RE = /blog\.naver\.com\/([^/?#]+)\/?(\d+)?/;

// script 안의 ...bootstrap({...}) 호출에서 JSON 인자를 brace-counting(문자열/이스케이프 인지)으로 추출.
export function extractBootstrapJson(html) {
    const results = [];
    const marker = 'bootstrap(';
    let idx = 0;
    while (true) {
        const p = html.indexOf(marker, idx);
        if (p === -1) break;
        const b = html.indexOf('{', p);
        idx = p + marker.length;
        if (b === -1) continue;
        let depth = 0;
        let i = b;
        let inStr = false;
        let esc = false;
        while (i < html.length) {
            const c = html[i];
            if (inStr) {
                if (esc) esc = false;
                else if (c === '\\') esc = true;
                else if (c === '"') inStr = false;
            } else if (c === '"') inStr = true;
            else if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) {
                    results.push(html.slice(b, i + 1));
                    break;
                }
            }
            i++;
        }
    }
    return results;
}

function blockMinR(node) {
    let min = null;
    const w = (o) => {
        if (Array.isArray(o)) {
            for (const x of o) w(x);
        } else if (o && typeof o === 'object') {
            const cl = o.clickLog;
            if (cl && typeof cl === 'object') {
                for (const key of ['content', 'title', 'image']) {
                    const ct = cl[key];
                    if (ct && typeof ct === 'object' && typeof ct.r === 'number') {
                        if (min === null || ct.r < min) min = ct.r;
                    }
                }
            }
            for (const v of Object.values(o)) w(v);
        }
    };
    w(node);
    return min === null ? 999 : min;
}

function iterBlogPosts(node) {
    const out = [];
    const walk = (o) => {
        if (Array.isArray(o)) {
            for (const x of o) walk(x);
        } else if (o && typeof o === 'object') {
            const ch = o.contentHref;
            if (typeof ch === 'string' && ch.includes('blog.naver.com') && !ch.includes('ader.naver.com')) {
                const cl = o.clickLog || {};
                const cont = cl && typeof cl === 'object' ? cl.content : null;
                const r = cont && typeof cont === 'object' && typeof cont.r === 'number' ? cont.r : 999;
                const m = ch.match(POST_RE);
                if (m) out.push([r, m[1], m[2] || '']);
            }
            for (const v of Object.values(o)) walk(v);
        }
    };
    walk(node);
    return out;
}

// 외부(비네이버) 사이트 링크가 블록에 있는지 — 웹문서/사이트 항목 판별용.
function hasExternalSite(raw) {
    const urls = raw.match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
    return urls.some((u) => !/(naver\.com|pstatic\.net|nstatic\.net|w3\.org)/i.test(u));
}

// 통합탭(ti): 인기글(meta.area=urB_coR) 섹션에서 '광고(ader)만 제외'하고
// 사이트(웹문서)+카페+블로그+당근 전부를 r(화면순)으로 카운트. (2026-06-23: 당근도 카운트 포함으로 변경)
export function rankInPopular(html, blogId) {
    const blocks = extractBootstrapJson(html);
    if (!blocks.length) return { rank: OUT_OF_RANK, status: 'fail' };
    const items = [];
    for (const b of blocks) {
        let j;
        try {
            j = JSON.parse(b);
        } catch {
            continue;
        }
        if (((j.meta && j.meta.area) || '') !== 'urB_coR') continue;
        const r = blockMinR(j);
        const mb = b.match(BLOG_RE);
        if (mb) {
            items.push([r, mb[1]]); // 블로그(우리 포함)
        } else if (b.includes('ader.naver.com')) {
            continue; // 광고(ader)만 제외
        } else if (b.includes('cafe.naver.com')) {
            items.push([r, '(cafe)']); // 카페
        } else if (b.includes('daangn')) {
            items.push([r, '(daangn)']); // 당근 — 사용자 요청으로 카운트 포함
        } else if (hasExternalSite(b)) {
            items.push([r, '(site)']); // 외부 웹문서 사이트
        }
        // 그 외(식별 불가) 제외
    }
    items.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < items.length; i++) {
        if (items[i][1] === blogId) return { rank: i + 1, status: 'ok' };
    }
    return { rank: OUT_OF_RANK, status: 'out' };
}

// 블로그탭(bl): 진짜 블로그탭(ssc=tab.m_blog.all) blog 블록의 글 r순 → {rank,status}
export function rankInBlogtab(html, blogId, logNo = '') {
    const blocks = extractBootstrapJson(html);
    if (!blocks.length) return { rank: OUT_OF_RANK, status: 'fail' };
    const posts = [];
    const seen = new Set();
    for (const b of blocks) {
        let j;
        try {
            j = JSON.parse(b);
        } catch {
            continue;
        }
        if (!(((j.refs && j.refs.blockId) || '').includes('blog'))) continue;
        for (const [r, pid, plog] of iterBlogPosts(j)) {
            const key = pid + '|' + plog;
            if (!seen.has(key)) {
                seen.add(key);
                posts.push([r, pid, plog]);
            }
        }
    }
    posts.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < posts.length; i++) {
        const [, pid, plog] = posts[i];
        if ((logNo && plog === logNo) || (!logNo && pid === blogId)) return { rank: i + 1, status: 'ok' };
    }
    return { rank: OUT_OF_RANK, status: 'out' };
}

export const TI_URL = (kw) => `https://m.search.naver.com/search.naver?query=${encodeURIComponent(kw)}`;
export const BL_URL = (kw) =>
    `https://m.search.naver.com/search.naver?ssc=tab.m_blog.all&query=${encodeURIComponent(kw)}`;
