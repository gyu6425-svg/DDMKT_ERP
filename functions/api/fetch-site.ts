// URL(홈페이지·네이버 블로그) → 키워드 추출용 원문 텍스트. 붙여넣기 대신 주소만 받는 경로.
//   왜: 플레이스가 없는 업체도 홈페이지나 블로그는 있다. 고객에게 "소개글을 붙여넣으세요"라고
//       하면 대부분 안 하거나 인사말만 넣는다. 주소 한 줄이 훨씬 잘 걷힌다.
//   ★ 네이버 블로그는 RSS 로 간다(실측 2026-08-07, 경기간호 blog.naver.com/gyeonggi22):
//     글 51개 제목이 "안양 군포 고관절 골절 이후 장기요양 방문재활" 처럼
//     이미 '지역 × 제품키워드' 형태다 — 우리 스캔 축과 같은 모양이라 가공이 거의 필요 없다.
//     같은 업체 홈페이지는 2,041자였지만 대부분 메뉴·인사말이었다.
//     같은 프롬프트로 뽑아 검색량을 재보면 차이가 분명하다:
//       블로그발  12/12 이 검색됨 · 합계 37,825 (장기요양등급 22,790 · 병원동행서비스 6,000 · 방문재활 2,350)
//       홈페이지발 5/9  만 검색됨 · 제도명(노인장기요양보험)을 빼면 합계 360
//         — 인지간호·통증간호·1대1맞춤케어·퇴원후관리는 검색량 0. 회사 카피지 검색어가 아니다.
//     → 홈페이지도 받되, 화면에서는 블로그를 먼저 권해야 한다.
//   ★ SPA(아임웹 등)는 메인 HTML 에 본문이 없다(ddnusu.imweb.me: HTML 1MB 인데 본문 691자,
//     전부 로그인·알림 UI). 다만 포기할 일은 아니다 — sitemap.xml 의 하위 페이지에는 본문이 있다.
//     실측 2026-08-07: /main·/shop_view/1~9 를 걷어 1,257자 확보, 내용이
//     "계양구 하수누수 · 부천 여월휴먼시아 직수누수" 처럼 지역×제품 형태의 진짜 자료였다.
//     그래도 안 나올 때만 붙여넣기로 안내한다(조용히 빈손으로 돌려보내지 않는다).
//   추출(GPT)은 기존 /api/extract-menu 가 그대로 이어받는다 — 여기선 원문만 만든다.
type FunctionContext = { request: Request; env: Record<string, string | undefined> };

const MAX_BYTES = 3_000_000;   // 응답 상한 — 쇼핑몰 메인은 쉽게 1MB 를 넘는다
const MAX_TEXT = 55_000;       // 반환 상한(추출기가 조각내 병렬 처리하므로 통째로 넘긴다)
const MIN_USEFUL = 300;        // 이 아래면 'JS 렌더라 본문이 없다'고 본다
const BLOG_PAGES = 12;         // 글목록 페이지 상한(30개씩 → 최대 360개)
const SITE_PAGES = 10;         // 서브페이지 상한
const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' },
        status,
    });
}

// 사설망·로컬로 향하는 요청은 막는다(우리 서버를 프록시로 쓰지 못하게).
const PRIVATE_HOST = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1)/i;

function normalizeUrl(raw: string): URL | null {
    let s = raw.trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    let u: URL;
    try {
        u = new URL(s);
    } catch {
        return null;
    }
    if (!/^https?:$/.test(u.protocol) || PRIVATE_HOST.test(u.hostname)) return null;
    return u;
}

// 한국 소상공인 홈페이지엔 아직 EUC-KR 이 흔하다(실측: gyeongginurse.co.kr).
//   UTF-8 로 못박아 읽으면 본문이 통째로 깨져 GPT 가 아무것도 못 뽑는다.
function decodeBody(buf: ArrayBuffer, contentType: string): string {
    const head = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 4096));
    const declared = (/charset=["']?([\w-]+)/i.exec(contentType) || /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1];
    const cs = (declared || '').toLowerCase();
    const order = cs && cs !== 'utf-8' ? [cs, 'utf-8'] : ['utf-8'];
    for (const enc of order) {
        try {
            const t = new TextDecoder(enc, { fatal: false }).decode(buf);
            // 치환문자(U+FFFD)가 많으면 인코딩을 잘못 고른 것이다.
            const bad = (t.match(/�/g) || []).length;
            if (bad < Math.max(20, t.length * 0.002)) return t;
        } catch { /* 지원하지 않는 인코딩이면 다음 후보로 */ }
    }
    return new TextDecoder('euc-kr', { fatal: false }).decode(buf);
}

function htmlToText(html: string): string {
    let h = html.replace(/<(script|style|noscript|svg|head|iframe)\b[\s\S]*?<\/\1>/gi, ' ');
    h = h.replace(/<!--[\s\S]*?-->/g, ' ');
    h = h.replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|td|tr|section|article)>/gi, '\n');
    h = h.replace(/<[^>]+>/g, ' ');
    h = h.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
    h = h.replace(/[ \t ]+/g, ' ').replace(/\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n');
    return h.trim();
}

function cdata(s: string): string {
    return s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

async function grab(url: string, ua = UA_PC): Promise<{ ok: boolean; status: number; body: string }> {
    let r: Response;
    try {
        r = await fetch(url, {
            headers: { 'Accept-Language': 'ko', 'User-Agent': ua },
            redirect: 'follow',
        });
    } catch {
        return { body: '', ok: false, status: 0 };
    }
    const buf = await r.arrayBuffer();
    return {
        body: decodeBody(buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf, r.headers.get('content-type') || ''),
        ok: r.ok,
        status: r.status,
    };
}

// blog.naver.com/아이디 · m.blog.naver.com/아이디 · PostView.naver?blogId=아이디 를 모두 받는다.
function naverBlogId(u: URL): string {
    if (!/(^|\.)blog\.naver\.com$/i.test(u.hostname)) return '';
    const q = u.searchParams.get('blogId');
    if (q) return q.trim();
    const seg = u.pathname.split('/').filter(Boolean);
    const first = seg[0] || '';
    if (!first || /\.(naver|do)$/i.test(first) || /^(PostView|PostList|prologue)$/i.test(first)) return '';
    return first;
}

// 글목록 API — RSS 는 최신 50개뿐이라 전체 글을 못 본다(실측: gyeonggi22 전체 166개 중 50개 = 30%).
//   제목이 이 경로의 핵심 산출물이라 여기서 전량을 걷는다. 30개씩 페이징.
async function blogAllTitles(id: string): Promise<{ titles: string[]; total: number }> {
    const out: string[] = [];
    let total = 0;
    for (let page = 1; page <= BLOG_PAGES; page++) {
        const r = await grab(`https://blog.naver.com/PostTitleListAsync.naver?blogId=${encodeURIComponent(id)}`
            + `&currentPage=${page}&countPerPage=30&categoryNo=0&viewdate=&parentCategoryNo=`);
        if (!r.ok) break;
        if (!total) total = Number((/"totalCount"\s*:\s*"?(\d+)"?/.exec(r.body) || [, '0'])[1]);
        // 응답이 표준 JSON 이 아니다(따옴표 이스케이프가 깨져 있다) → 필드만 정규식으로 뽑는다.
        const got = [...r.body.matchAll(/"title"\s*:\s*"([^"]*)"/g)].map((m) => {
            try {
                return decodeURIComponent(m[1].replace(/\+/g, ' '));
            } catch {
                return m[1].replace(/\+/g, ' ');
            }
        }).filter(Boolean);
        if (!got.length) break;
        out.push(...got);
        if (total && out.length >= total) break;
    }
    return { titles: [...new Set(out)], total: total || out.length };
}

async function fromNaverBlog(id: string) {
    const r = await grab(`https://rss.blog.naver.com/${encodeURIComponent(id)}.xml`);
    const rssTitles = r.ok ? [...r.body.matchAll(/<title>([\s\S]*?)<\/title>/g)].map((m) => cdata(m[1])) : [];
    const blogName = rssTitles[0] || '';
    const { titles: all, total } = await blogAllTitles(id);
    // 글목록 API 가 막히면 RSS 50개로라도 간다.
    const posts = all.length ? all : rssTitles.slice(1);
    if (!posts.length) return null;
    const descs = r.ok ? [...r.body.matchAll(/<description>([\s\S]*?)<\/description>/g)].map((m) => cdata(m[1])) : [];
    // ★ 제목을 먼저·따로 넣는다. 블로그 글 제목은 업체가 이미 노리고 있는 검색어 그 자체라
    //   본문(수식어·인사말이 섞임)보다 키워드 밀도가 훨씬 높다.
    const text = [
        `[${blogName || id} — 네이버 블로그 글 제목 ${posts.length}개${total > posts.length ? ` (전체 ${total}개 중)` : ' (전체)'}]`,
        ...posts,
        '',
        '[최근 글 본문 발췌]',
        htmlToText(descs.slice(1).join('\n')),
    ].join('\n');
    return {
        chars: 0, pages: [`blog.naver.com/${id} · 글 ${posts.length}/${total}`],
        posts: posts.length, source: 'naver_blog', text, title: blogName || id, total,
    };
}

const SKIP_LINK = /(login|join|member|cart|order|privacy|terms|agree|sitemap|admin|adm\/|bbs\/write|logout)/i;
const SKIP_EXT = /\.(jpg|jpeg|png|gif|webp|css|js|ico|svg|zip|pdf|hwp|xls|doc)(\?|$)/i;

// 같은 사이트의 다른 페이지를 찾는다.
//   ★ href="../sub0101.php" 같은 상대경로와 홑따옴표를 놓치면 사이트 대부분을 못 본다
//     (실측 2026-08-07 gyeongginurse.co.kr: 서브 7장을 통째로 놓쳐 본문의 1/7 만 봤다).
function siteLinks(html: string, base: URL): string[] {
    const out = new Set<string>();
    for (const m of html.matchAll(/(?:href|location(?:\.href)?)\s*=\s*["']([^"'#>]{2,120})["']/gi)) {
        const raw = m[1].trim();
        if (!raw || /^(javascript|mailto|tel):/i.test(raw) || SKIP_EXT.test(raw) || SKIP_LINK.test(raw)) continue;
        try {
            const abs = new URL(raw, base);
            if (abs.hostname !== base.hostname || !/^https?:$/.test(abs.protocol)) continue;
            abs.hash = '';
            out.add(abs.toString());
        } catch { /* 깨진 링크는 버린다 */ }
    }
    return [...out];
}

// 페이지마다 반복되는 전역 메뉴(기관소개·인사말·오시는길…)를 걷어낸다.
//   ★ 안 걷어내면 8장을 모아도 같은 네비게이션이 8번 들어가 추출기 입력 상한만 잡아먹는다.
function dedupeLines(chunks: string[]): string {
    const seen = new Map<string, number>();
    const lines = chunks.flatMap((c) => c.split('\n'));
    for (const l of lines) {
        const k = l.trim();
        if (k) seen.set(k, (seen.get(k) || 0) + 1);
    }
    const used = new Set<string>();
    const out: string[] = [];
    for (const l of lines) {
        const k = l.trim();
        if (!k || k.length < 2) continue;
        // 여러 장에 걸쳐 반복되는 줄은 한 번만 남긴다.
        if ((seen.get(k) || 0) > 1 && used.has(k)) continue;
        used.add(k);
        out.push(k);
    }
    return out.join('\n');
}

async function fromWebsite(u: URL) {
    const first = await grab(u.toString());
    if (!first.ok && !first.body) {
        return { error: `사이트에 연결하지 못했습니다(HTTP ${first.status || '연결실패'}).` };
    }
    const title = cdata((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(first.body) || [, ''])[1] || '').trim();
    const chunks = [htmlToText(first.body)];
    const pages = [u.pathname || '/'];
    const done = new Set([u.toString().replace(/#.*$/, '')]);

    // ★ 서브페이지를 항상 걷는다(예전엔 메인이 빈약할 때만 걸어서, 메인만 두툼한 사이트는
    //   회사소개·서비스안내를 통째로 놓쳤다). 링크 → 없으면 sitemap.xml 순.
    let cands = siteLinks(first.body, u);
    if (cands.length < 3) {
        const sm = await grab(new URL('/sitemap.xml', u).toString());
        for (const m of sm.body.matchAll(/<loc>([\s\S]*?)<\/loc>/g)) {
            const l = cdata(m[1]);
            if (SKIP_LINK.test(l) || SKIP_EXT.test(l)) continue;
            try {
                if (new URL(l).hostname === u.hostname) cands.push(l);
            } catch { /* 무시 */ }
        }
        cands = [...new Set(cands)];
    }
    for (const l of cands) {
        if (pages.length > SITE_PAGES) break;
        if (done.has(l)) continue;
        done.add(l);
        const p = await grab(l);
        if (!p.body) continue;
        const t = htmlToText(p.body);
        // 한글이 거의 없는 페이지(본문이 이미지인 곳)는 넣어봐야 추출에 방해만 된다.
        if ((t.match(/[가-힣]/g) || []).length < 40) continue;
        chunks.push(t);
        pages.push(new URL(l).pathname);
    }
    return { chars: 0, pages, source: 'website', text: dedupeLines(chunks), title };
}

async function handle(raw: string) {
    const u = normalizeUrl(raw);
    if (!u) return jsonResponse({ message: '주소를 확인해 주세요. 예) gyeongginurse.co.kr 또는 blog.naver.com/아이디' }, 400);

    const blogId = naverBlogId(u);
    let out = blogId ? await fromNaverBlog(blogId) : null;
    if (blogId && !out) {
        return jsonResponse({ message: `네이버 블로그(${blogId})의 글을 가져오지 못했습니다. 블로그가 비공개이거나 글이 없을 수 있습니다.` }, 422);
    }
    if (!out) {
        let w = await fromWebsite(u);
        // ★ HTTPS 를 안 쓰는 사이트가 아직 많다. 스킴 없이 적어 넣으면 https 로 붙는데,
        //   그게 실패하면 http 로 한 번 더 간다(실측 2026-08-07: gyeongginurse.co.kr 를
        //   'gyeongginurse.co.kr' 로 넣으면 실패, 'http://…' 로 넣으면 8페이지 3,347자 성공.
        //   고객은 스킴을 안 적는 쪽이 훨씬 흔하므로 이걸 막으면 대부분 못 읽는다).
        const weak = (r: typeof w) => 'error' in r || r.text.replace(/\s/g, '').length < MIN_USEFUL;
        if (weak(w) && !/^https?:\/\//i.test(raw.trim()) && u.protocol === 'https:') {
            const alt = new URL(u.toString());
            alt.protocol = 'http:';
            const w2 = await fromWebsite(alt);
            if (!weak(w2)) w = w2;
        }
        if ('error' in w) return jsonResponse({ message: w.error }, 502);
        out = w as NonNullable<typeof out>;
    }

    // 정적 HTML 에 본문이 없는 SPA — 조용히 빈손으로 돌려보내지 않는다.
    if (out.text.replace(/\s/g, '').length < MIN_USEFUL) {
        return jsonResponse({
            message: '이 사이트는 본문이 자바스크립트로 그려져 주소만으로는 글을 읽을 수 없습니다. '
                + '네이버 블로그 주소가 있으면 그걸 넣어 보시고, 없으면 소개·서비스 내용을 붙여넣어 주세요.',
        }, 422);
    }
    out.text = out.text.slice(0, MAX_TEXT);
    out.chars = out.text.length;
    return jsonResponse(out);
}

export async function onRequestGet({ request }: FunctionContext) {
    return handle(new URL(request.url).searchParams.get('url') || '');
}

export async function onRequestPost({ request }: FunctionContext) {
    let payload: { url?: string };
    try {
        payload = await request.json();
    } catch {
        return jsonResponse({ message: '요청 본문(JSON)을 해석하지 못했습니다.' }, 400);
    }
    return handle(payload.url || '');
}

export function onRequestOptions() {
    return new Response(null, {
        headers: { 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Origin': '*' },
        status: 204,
    });
}
