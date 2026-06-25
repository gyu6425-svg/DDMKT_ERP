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
// 블로그 '프로필(홈) 링크' — 글번호 없는 blog.naver.com/<id>. 통합탭 상단 대표 카드가 특정 글이 아니라
//   블로그 홈으로 링크되는 경우(경기광주 인테리어필름 vision1803 = 화면 2위 프로필 카드)를 잡는다.
//   id 뒤가 /?# 또는 끝이라야 함(PostView.naver 등은 '.'에서 끊겨 매칭 안 됨). 파이썬 _BLOG_HOME_RE 1:1.
const BLOG_HOME_RE = /(?:m\.)?blog\.naver\.com\/([A-Za-z0-9_-]+)(?=[/?#]|$)/;
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

// 블록(카드) 1개에서 { posts:[[bid,lno]...], profiles:Set(bid) }. (파이썬 _block_blog_entries 1:1)
//   profiles = 블로그 홈 링크만 있고 그 블로그 글 링크는 없는 '프로필 카드'(통합탭 상단 대표 카드).
//   같은 블록에 그 블로그 글 링크가 있으면 profiles 에서 뺀다 → 칠곡식 '같은 블로그 다른 글' 순위 전염 방지.
function blockBlogEntries(node) {
    const posts = [];
    const home = new Set();
    const walk = (o) => {
        if (Array.isArray(o)) {
            for (const x of o) walk(x);
        } else if (o && typeof o === 'object') {
            for (const [k, v] of Object.entries(o)) {
                if (PRIMARY_EXCLUDE_KEYS.has(k)) continue;
                if (typeof v === 'string') {
                    if (PRIMARY_NAV_FIELDS.has(k)) {
                        const m = v.match(BLOG_POST_RE);
                        if (m) {
                            posts.push([m[1], m[2]]);
                        } else {
                            const mh = v.match(BLOG_HOME_RE);
                            if (mh) home.add(mh[1]);
                        }
                    }
                } else {
                    walk(v);
                }
            }
        }
    };
    walk(node);
    const postIds = new Set(posts.map((p) => p[0]));
    const profiles = new Set([...home].filter((id) => !postIds.has(id)));
    return { posts, profiles };
}

// 이 카드가 우리 블로그/글이면 true. (파이썬 _entry_match 1:1)
//   logNo 있으면: 그 글(정확 일치) 또는 그 블로그 '프로필 카드'면 매칭. 없으면: 그 블로그 글/프로필이면 매칭.
function entryMatch(blogId, logNo, posts, profiles) {
    if (logNo) {
        if (posts.some(([, lno]) => lno === logNo)) return true;
        return profiles.has(blogId);
    }
    return posts.some(([bid]) => bid === blogId) || profiles.has(blogId);
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

// 이 노드 자체 clickLog(content/title/image).r 최솟값(=이 카드 화면순위). 없으면 null. (파이썬 _node_min_r 1:1)
function nodeMinR(d) {
    const cl = d && d.clickLog;
    if (!cl || typeof cl !== 'object') return null;
    let min = null;
    for (const k of ['content', 'title', 'image']) {
        const ct = cl[k];
        if (ct && typeof ct === 'object' && typeof ct.r === 'number' && Number.isFinite(ct.r)) {
            if (min === null || ct.r < min) min = ct.r;
        }
    }
    return min;
}
// 이 노드 직속 네비링크의 [blogId, logNo]. (파이썬 _node_primary 1:1)
function nodePrimary(d) {
    const out = [];
    for (const k of PRIMARY_NAV_FIELDS) {
        const v = d[k];
        if (typeof v === 'string') {
            const m = v.match(BLOG_POST_RE);
            if (m) out.push([m[1], m[2]]);
        }
    }
    return out;
}
// ugB 블록(한 블록=여러 카드) → r별 카드 [[r, [[bid,lno],...]], ...] r 오름차순. afterArticles 제외, r=0 헤더 스킵.
function ugbCards(j) {
    const bucket = new Map();
    const walk = (o) => {
        if (Array.isArray(o)) {
            for (const x of o) walk(x);
        } else if (o && typeof o === 'object') {
            const r = nodeMinR(o);
            if (r !== null && r !== 0) {
                if (!bucket.has(r)) bucket.set(r, new Set());
                const set = bucket.get(r);
                for (const p of nodePrimary(o)) set.add(p[0] + '|' + p[1]);
            }
            for (const [k, v] of Object.entries(o)) {
                if (PRIMARY_EXCLUDE_KEYS.has(k)) continue;
                walk(v);
            }
        }
    };
    walk(j);
    return [...bucket.keys()]
        .sort((a, b) => a - b)
        .map((r) => [r, [...bucket.get(r)].map((s) => s.split('|'))]);
}

// 통합탭(ti): '그 블로그가 속한 섹션 안에서의 순위'(섹션마다 1부터 재시작). 파이썬 _rank_in_popular 1:1.
// (2026-06-24: 사용자 확인 — 통합검색은 섹션(area)이 여러 개고 블로그 순위는 '자기 섹션 안' 기준.
//   예) 안산 푸르지오9차: 오늘의집/부동산으로 시작하는 urB_coR=웹사이트/문서 섹션이 위에 있고,
//   design_do_ 는 아래 urB_boR(블로그) 섹션 첫 카드 → 통합탭 1위. 누적이면 6위로 잘못 나옴.)
//   섹션 = area 가 같은 연속 블록. area 바뀌면 1부터 다시. web*·ader·비결과(r없음) 제외, 매칭은 대표글로만.
export function rankInPopular(html, blogId, logNo = '') {
    const blocks = extractBootstrapJson(html);
    if (!blocks.length) return { rank: OUT_OF_RANK, status: 'fail' };
    let prevArea = null;
    let rank = 0;
    for (const b of blocks) {
        let j;
        try {
            j = JSON.parse(b);
        } catch {
            continue;
        }
        if (b.includes('ader.naver.com')) continue; // 광고(ader) 제외
        const area = blockArea(j);
        if (isWebArea(area)) continue; // 웹사이트(문서)탭 섹션 제외 — 통합탭 순위 아님
        if (blockMinR(j) >= 999) continue; // 비-결과 블록(AI/이미지/연관검색어) 제외
        if (area !== prevArea) {
            // 새 섹션 → 순위 1부터 재시작
            rank = 0;
            prevArea = area;
        }
        // ugB_*(한 블록=여러 카드, 예 ugB_bsR)은 블록 안 카드를 r 순서로 한 칸씩 — 같은 블록의 다른
        //   카드(예 서천: sd44422 1위 … limebuffet 5위)에 순위가 1로 뭉개지지 않게.
        // urB_*(블록=카드 1개)은 블록 등장 순서로 한 칸씩(블록 내부 r 무시 — 화면 위치와 1:1).
        if (area.startsWith('ugB')) {
            for (const [, prims] of ugbCards(j)) {
                rank += 1;
                for (const [bid, lno] of prims) {
                    if ((logNo && lno === logNo) || (!logNo && bid === blogId)) return { rank, status: 'ok' };
                }
            }
        } else {
            rank += 1; // 같은 섹션 안에서 보이는 카드 한 칸
            const { posts, profiles } = blockBlogEntries(j);
            if (entryMatch(blogId, logNo, posts, profiles)) return { rank, status: 'ok' };
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
    // 블로그탭은 단일 랭킹 리스트라 '그 글의 clickLog r'이 곧 화면 순위(파이썬 _rank_in_blogtab 1:1).
    //   수집 글들의 '몇 번째'(position)가 아님 — contentHref 글만 모으면 중간 글을 놓쳐 순위가 작게 나오는
    //   버그(미유외과 r=12를 4위로 오인). 2026-06-25 사용자 확인: r 값이 실제 순위.
    posts.sort((a, b) => a[0] - b[0]); // 블로그 단위(logNo 없음)일 때 최소 r(가장 좋은 순위) 먼저
    for (const [r, pid, plog] of posts) {
        if ((logNo && plog === logNo) || (!logNo && pid === blogId)) return { rank: r, status: 'ok' };
    }
    return { rank: OUT_OF_RANK, status: 'out' };
}

export const TI_URL = (kw) => `https://m.search.naver.com/search.naver?query=${encodeURIComponent(kw)}`;
export const BL_URL = (kw) =>
    `https://m.search.naver.com/search.naver?ssc=tab.m_blog.all&query=${encodeURIComponent(kw)}`;
