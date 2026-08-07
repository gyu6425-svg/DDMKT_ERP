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
//   ★ 정적 HTML 에 본문이 없는 SPA 가 있다(실측: 아임웹 ddnusu.imweb.me — HTML 1MB 인데
//     본문 691자, 전부 로그인·알림 UI). 이때는 조용히 빈 결과를 주지 말고 붙여넣기로 안내한다.
//   추출(GPT)은 기존 /api/extract-menu 가 그대로 이어받는다 — 여기선 원문만 만든다.
type FunctionContext = { request: Request; env: Record<string, string | undefined> };

const MAX_BYTES = 3_000_000;   // 응답 상한 — 쇼핑몰 메인은 쉽게 1MB 를 넘는다
const MAX_TEXT = 12_000;       // 반환 상한(추출기 입력은 6,000자라 여유만 둔다)
const MIN_USEFUL = 300;        // 이 아래면 'JS 렌더라 본문이 없다'고 본다
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

async function fromNaverBlog(id: string) {
    const r = await grab(`https://rss.blog.naver.com/${encodeURIComponent(id)}.xml`);
    if (!r.ok) return null;
    const titles = [...r.body.matchAll(/<title>([\s\S]*?)<\/title>/g)].map((m) => cdata(m[1]));
    if (titles.length < 2) return null;
    const descs = [...r.body.matchAll(/<description>([\s\S]*?)<\/description>/g)].map((m) => cdata(m[1]));
    const posts = titles.slice(1);
    // ★ 제목을 먼저·따로 넣는다. 블로그 글 제목은 업체가 이미 노리고 있는 검색어 그 자체라
    //   본문(수식어·인사말이 섞임)보다 키워드 밀도가 훨씬 높다.
    const text = [
        `[${titles[0]} — 네이버 블로그 최근 글 제목 ${posts.length}개]`,
        ...posts,
        '',
        '[본문 발췌]',
        htmlToText(descs.slice(1).join('\n')),
    ].join('\n');
    return { chars: 0, pages: [`rss.blog.naver.com/${id}.xml`], source: 'naver_blog', text, title: titles[0], posts: posts.length };
}

async function fromWebsite(u: URL) {
    const first = await grab(u.toString());
    if (!first.ok && !first.body) {
        return { error: `사이트에 연결하지 못했습니다(HTTP ${first.status || '연결실패'}).` };
    }
    const title = cdata((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(first.body) || [, ''])[1] || '').trim();
    let text = htmlToText(first.body);
    const pages = [u.pathname || '/'];

    // 본문이 빈약하면 sitemap.xml 의 앞쪽 페이지를 몇 개 더 걷는다(회사소개·서비스가 거기 있다).
    if (text.length < 2000) {
        const sm = await grab(new URL('/sitemap.xml', u).toString());
        const locs = [...sm.body.matchAll(/<loc>([\s\S]*?)<\/loc>/g)]
            .map((m) => cdata(m[1]))
            .filter((l) => { try { return new URL(l).hostname === u.hostname; } catch { return false; } })
            .filter((l) => !/(login|join|member|cart|order|privacy|terms)/i.test(l));
        for (const l of locs.slice(0, 4)) {
            if (text.length >= 6000) break;
            if (new URL(l).pathname === (u.pathname || '/')) continue;
            const p = await grab(l);
            if (!p.body) continue;
            const t = htmlToText(p.body);
            if (t.length > 200) { text += '\n' + t; pages.push(new URL(l).pathname); }
        }
    }
    return { chars: 0, pages, source: 'website', text, title };
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
        const w = await fromWebsite(u);
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
