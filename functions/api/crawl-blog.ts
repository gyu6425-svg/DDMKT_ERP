// 서버리스 크롤 — 블로그 1개의 RSS 동기화 + ti/bl 측정 + Supabase 기록. 터미널 크롤러를 대체.
// POST /api/crawl-blog  { blogAccountId }  → { postsMeasured, keywordsMeasured, errors }
// 가벼운 가드: same-origin Origin 체크 + 같은날 dedup(경량 rate-limit). (인증 재활성 시 JWT+관리자로 격상)
// 한 요청 = 블로그 1개(Cloudflare Free 한도: 외부 subrequest 50, CPU ~10ms 대응 → maxPosts 5).
// env 필요: SUPABASE_URL, SUPABASE_SERVICE_KEY (Cloudflare Pages 환경변수, 브라우저 노출 0).

// @ts-expect-error — .mjs 단일소스(파서). 타입 없이 import.
import { rankInPopular, rankInBlogtab, TI_URL, BL_URL, MOBILE_UA, OUT_OF_RANK } from '../lib/naverRank.mjs';
// @ts-expect-error — .mjs 단일소스(크롤 헬퍼).
import {
    parseRss,
    deriveKeyword,
    parseBlogUrl,
    extractLogNo,
    todayKST,
    upsertToday,
    sbGet,
    sbInsert,
    sbPatch,
} from '../lib/crawlLib.mjs';

type FunctionContext = {
    request: Request;
    env: Record<string, string | undefined>;
};

const MAX_POSTS = 5;
const MAX_KEYWORDS = 3;

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
        const res = await fetch(url, { headers: { 'User-Agent': MOBILE_UA }, signal: ctrl.signal });
        if (res.status !== 200) return null;
        return await res.text();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

// 측정 1개(통합 또는 블로그탭) — 파싱 실패(네이버 일시차단/빈응답)면 잠깐 쉬고 1회 재시도.
async function measureOne(
    url: string,
    parse: (html: string) => { rank: number; status: string },
): Promise<{ rank: number; status: string }> {
    const html = await fetchText(url);
    let r = html ? parse(html) : { rank: OUT_OF_RANK, status: 'fail' };
    if (r.status === 'fail') {
        await new Promise((res) => setTimeout(res, 1500));
        const html2 = await fetchText(url);
        r = html2 ? parse(html2) : { rank: OUT_OF_RANK, status: 'fail' };
    }
    return r;
}

async function measure(keyword: string, blogId: string, logNo: string) {
    // 동시요청을 줄이려 통합→블로그 순차로(폭주 시 차단 완화).
    const ti = await measureOne(TI_URL(keyword), (h) => rankInPopular(h, blogId));
    const bl = await measureOne(BL_URL(keyword), (h) => rankInBlogtab(h, blogId, logNo));
    return { ti: ti.rank, ti_status: ti.status, bl: bl.rank, bl_status: bl.status };
}

export async function onRequestPost({ request, env }: FunctionContext) {
    // 가벼운 가드: 브라우저 cross-site 호출 차단(같은 출처만).
    const origin = request.headers.get('Origin');
    if (origin) {
        try {
            if (new URL(origin).host !== new URL(request.url).host) {
                return jsonResponse({ error: 'forbidden(origin)' }, 403);
            }
        } catch {
            return jsonResponse({ error: 'forbidden(origin)' }, 403);
        }
    }
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
        return jsonResponse({ error: '서버 환경변수 미설정(SUPABASE_URL / SUPABASE_SERVICE_KEY)' }, 500);
    }

    let body: { blogAccountId?: string };
    try {
        body = (await request.json()) as typeof body;
    } catch {
        return jsonResponse({ error: 'invalid json' }, 400);
    }
    const blogAccountId = (body.blogAccountId || '').trim();
    if (!blogAccountId) return jsonResponse({ error: 'blogAccountId 가 필요합니다' }, 400);

    const today = todayKST();
    const errors: string[] = [];

    try {
        const accs = await sbGet(env, 'blog_accounts', { id: `eq.${blogAccountId}`, select: '*' });
        if (!accs.length) return jsonResponse({ error: '해당 블로그를 찾을 수 없습니다' }, 404);
        const acc = accs[0];
        const blogId = acc.blog_id || parseBlogUrl(acc.blog_url || '')[0];
        if (!blogId) return jsonResponse({ error: 'blog_id 를 알 수 없습니다' }, 400);

        // (A) RSS 동기화 → (B) per-post ti/bl
        let postsMeasured = 0;
        const rssTxt = await fetchText(`https://rss.blog.naver.com/${blogId}.xml`);
        if (!rssTxt) {
            errors.push('RSS 응답 실패(차단/비공개 가능)');
        } else {
            const items = parseRss(rssTxt, MAX_POSTS).filter((p: { url: string }) => p.url);
            const rows = items.map(
                (p: { url: string; title: string; published_date: string | null; tags?: string[] }) => ({
                    blog_account_id: blogAccountId,
                    post_url: p.url,
                    title: p.title,
                    keyword: deriveKeyword(p.title, p.tags || []),
                    published_date: p.published_date,
                }),
            );
            const upserted = rows.length ? await sbInsert(env, 'blog_posts', rows, 'blog_account_id,post_url') : [];
            for (const post of upserted) {
                // 수동 지정 키워드(keyword_manual)가 있으면 그 값으로 측정 — 크롤이 덮어쓰지 않으므로 계속 유지됨.
                const kw = (post.keyword_manual || post.keyword || '').trim();
                if (!kw) continue;
                const r = await measure(kw, blogId, extractLogNo(post.post_url || ''));
                const recs = upsertToday(post.measurements, { date: today, ...r }, today);
                await sbPatch(env, 'blog_posts', { id: `eq.${post.id}` }, { measurements: recs });
                postsMeasured++;
            }
        }

        // (D) 대표키워드
        let keywordsMeasured = 0;
        const kws = await sbGet(env, 'blog_keywords', { blog_account_id: `eq.${blogAccountId}`, select: '*' });
        for (const row of kws.slice(0, MAX_KEYWORDS)) {
            const kw = (row.keyword || '').trim();
            if (!kw) continue;
            const r = await measure(kw, blogId, '');
            const recs = upsertToday(row.measurements, { date: today, ...r }, today);
            await sbPatch(env, 'blog_keywords', { id: `eq.${row.id}` }, { measurements: recs });
            keywordsMeasured++;
        }

        return jsonResponse({ blogAccountId, blogId, postsMeasured, keywordsMeasured, errors });
    } catch (err) {
        return jsonResponse({ error: `크롤 오류: ${String((err as Error)?.message || err)}`, errors }, 500);
    }
}
