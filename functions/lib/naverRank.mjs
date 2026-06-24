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
                    // r = 화면순위(유한수). 파이썬 _block_min_r 와 1:1(불리언/NaN 제외).
                    if (ct && typeof ct === 'object' && typeof ct.r === 'number' && Number.isFinite(ct.r)) {
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

// 카드 '대표글' 판별 — 제목/본문 네비링크만 보고 관련글 묶음 하위는 배제(파이썬 _primary_blog_posts 와 1:1).
//   2026-06-24 실측(칠곡 업소용가구 pjyysh): 카드 본문글은 5/15글(contentHref·titleHref)인데 같은 카드의
//   afterArticles('이 블로그 다른 글') 안에 6/11글이 먼저 등장 → raw 첫 링크(6/11글) 매칭이 6월글에
//   5위를 잘못 부여. 발행일 다른 글끼리 순위 전염되던 버그 → 대표 네비링크로만 매칭.
const BLOG_POST_RE = /blog\.naver\.com\/([^/?#"\\]+)\/(\d{6,})/; // 글 단위 매칭용(blogId+logNo)
const PRIMARY_NAV_FIELDS = new Set(['href', 'titleHref', 'contentHref']); // 카드 본문 이동 링크
const PRIMARY_EXCLUDE_KEYS = new Set([
    'afterArticles', 'clusters', 'series', 'relatedContents', 'subItems',
]); // 관련글/클러스터 묶음 — 대표글 아님
function primaryBlogPosts(node) {
    const out = [];
    const walk = (o) => {
        if (Array.isArray(o)) {
            for (const x of o) walk(x);
        } else if (o && typeof o === 'object') {
            for (const [k, v] of Object.entries(o)) {
                if (PRIMARY_EXCLUDE_KEYS.has(k)) continue; // 관련글 묶음 하위는 통째로 건너뜀
                if (typeof v === 'string') {
                    if (PRIMARY_NAV_FIELDS.has(k)) {
                        const m = v.match(BLOG_POST_RE);
                        if (m) out.push([m[1], m[2]]);
                    }
                } else {
                    walk(v);
                }
            }
        }
    };
    walk(node);
    return out;
}

// 블록 섹션 코드(meta.area 우선, 없으면 refs.blockId).
function blockArea(j) {
    const a = (j && j.meta && j.meta.area) || (j && j.refs && j.refs.blockId) || '';
    return a || '';
}
// web* 섹션 = '웹사이트/문서' 탭. 통합탭(인기글) 순위와 별개 → 통합탭 카운트에서 제외(파이썬 _is_web_area 1:1).
//   2026-06-24 실측(김포 경호업체): web_gen(sks303040 문서)이 인기글 위에 잡혀 더맨시스템을 2위로
//   밀어냄. 사용자 확인: 그 위치는 '웹사이트탭' → 통합탭에서 빼고 존재 여부만 표기.
function isWebArea(area) {
    return area.toLowerCase().startsWith('web');
}

// 통합탭(ti): 광고(ader/파워링크)만 제외하고, 화면에 보이는 '모든 결과 카드'를 문서(=화면) 순서대로
// 카운트한 위치 = 순위. (2026-06-23: 사용자 요청 — 인기글 섹션만 보던 것을 전 섹션으로 확장.
//   urB_coR·urB_boR 등 섹션마다 r 이 1부터 재시작하므로 r 정렬 금지, 블록 등장 순서로 카운트.)
//   결과 카드 판정 = clickLog.r 이 있는 블록(blockMinR<999). AI답변·이미지캐러셀·연관검색어(r 없음)는 제외.
//   파워링크 광고는 bootstrap JSON 밖(서버렌더)이라 애초에 블록에 안 들어오고, ader 링크는 안전망으로 한 번 더 제외.
//   매칭은 카드 '대표글'(primaryBlogPosts)로만 — 관련글 묶음(afterArticles 등) 링크에 순위 전염 방지.
export function rankInPopular(html, blogId, logNo = '') {
    const blocks = extractBootstrapJson(html);
    if (!blocks.length) return { rank: OUT_OF_RANK, status: 'fail' };
    let rank = 0;
    for (const b of blocks) {
        let j;
        try {
            j = JSON.parse(b);
        } catch {
            continue;
        }
        if (b.includes('ader.naver.com')) continue; // 광고(ader) 제외
        if (isWebArea(blockArea(j))) continue; // 웹사이트(문서)탭 섹션 제외 — 통합탭 순위 아님
        if (blockMinR(j) >= 999) continue; // 비-결과 블록(AI/이미지/연관검색어) 제외
        rank += 1; // 화면에 보이는 결과 카드 한 칸
        // logNo 있으면 '그 글'만 매칭(통합탭도 글 단위) — 같은 블로그 다른 글에 순위 오인 방지.
        for (const [bid, lno] of primaryBlogPosts(j)) {
            if (logNo) {
                if (lno === logNo) return { rank, status: 'ok' };
            } else if (bid === blogId) {
                return { rank, status: 'ok' };
            }
        }
    }
    return { rank: OUT_OF_RANK, status: 'out' };
}

// 웹사이트(문서)탭 존재 여부 — 통합검색 HTML 의 web* 섹션에 우리 글/블로그가 있으면 '있음', 없으면 '없음'.
//   같은 통합탭 HTML 에서 추출(추가 요청 X). 차단/빈응답이면 'fail'. (파이썬 _website_present 1:1)
export function websitePresent(html, blogId, logNo = '') {
    const blocks = extractBootstrapJson(html);
    if (!blocks.length) return 'fail';
    for (const b of blocks) {
        let j;
        try {
            j = JSON.parse(b);
        } catch {
            continue;
        }
        if (b.includes('ader.naver.com')) continue;
        if (!isWebArea(blockArea(j))) continue; // 웹사이트(문서) 섹션만
        for (const [bid, lno] of primaryBlogPosts(j)) {
            if ((logNo && lno === logNo) || (!logNo && bid === blogId)) return '있음';
        }
    }
    return '없음';
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
