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
    extractHashtagsFromHtml,
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

const MAX_POSTS = 15; // RSS에서 가져올(=행으로 보일) 최신 글 수. 측정은 아래 MEASURE_BATCH 로 분할.
const MAX_KEYWORDS = 3;
// 한 요청당 '실제 측정'할 글 수. Cloudflare Free 한도(외부요청 50·시간)에 맞춘 원래 예산(글 5 + 키워드 3).
// 15개를 한 번에 측정하면 한도를 넘겨 뒤쪽 글이 영영 '측정 대기'로 남으므로, 여기서 끊고 나머지는
// postsRemaining 로 알려 클라이언트가 추가 호출로 마저 채운다(다회 분할 측정).
const MEASURE_BATCH = 4; // 글당 본문HTML(키워드)+ti+bl(재시도) 고려해 Cloudflare 외부요청 50 한도 내로.
const THROTTLE_MS = 300; // 네이버 연속요청 간격(레이트리밋=측정 '실패' 완화).
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 오늘자 '성공' 측정이 있으면 skip(=이미 측정됨). 레코드가 없거나 오늘 'fail' 이면 (재)측정 대상.
function needsMeasure(measurements: Array<{ date?: string; ti_status?: string; bl_status?: string }>, today: string) {
    const rec = (Array.isArray(measurements) ? measurements : []).find((m) => m && m.date === today);
    if (!rec) return true;
    return rec.ti_status === 'fail' || rec.bl_status === 'fail';
}

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
        await sleep(700);
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

        // (A) RSS 동기화 → (B) per-post ti/bl (오늘 미측정/실패분만, 최신글 우선, MEASURE_BATCH개씩)
        let postsMeasured = 0;
        let postsRemaining = 0;
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
            // 측정 대상 = 키워드 있고(수동 지정 우선) 오늘 성공 측정이 없는 글. 최신글 먼저.
            const pending = upserted
                .filter(
                    (p: { keyword_manual?: string; keyword?: string; measurements: [] }) =>
                        (p.keyword_manual || p.keyword || '').trim() && needsMeasure(p.measurements, today),
                )
                .sort((a: { published_date?: string }, b: { published_date?: string }) =>
                    String(b.published_date || '').localeCompare(String(a.published_date || '')),
                );
            postsRemaining = Math.max(0, pending.length - MEASURE_BATCH);
            for (const post of pending.slice(0, MEASURE_BATCH)) {
                const logNo = extractLogNo(post.post_url || '');
                // 수동 키워드 있으면 그대로. 없으면 본문 하단 해시태그로 재도출(무조건 해시태그) — RSS태그 키워드 교정.
                let kw = (post.keyword_manual || post.keyword || '').trim();
                let kwChanged = false;
                if (!post.keyword_manual) {
                    const phtml = await fetchText(`https://m.blog.naver.com/${blogId}/${logNo}`);
                    const derived = deriveKeyword(post.title || '', phtml ? extractHashtagsFromHtml(phtml) : []).trim();
                    if (derived && derived !== kw) {
                        kw = derived;
                        kwChanged = true;
                    }
                }
                // 글 단위(logNo) 측정 — 각 글의 실제 순위. (같은 키워드여도 5월글/6월글 각자 순위)
                const r = await measure(kw, blogId, logNo);
                const recs = upsertToday(post.measurements, { date: today, ...r }, today);
                await sbPatch(
                    env,
                    'blog_posts',
                    { id: `eq.${post.id}` },
                    kwChanged ? { measurements: recs, keyword: kw } : { measurements: recs },
                );
                postsMeasured++;
                await sleep(THROTTLE_MS);
            }
        }

        // (D) 대표키워드
        let keywordsMeasured = 0;
        const kws = await sbGet(env, 'blog_keywords', { blog_account_id: `eq.${blogAccountId}`, select: '*' });
        for (const row of kws.slice(0, MAX_KEYWORDS)) {
            const kw = (row.keyword || '').trim();
            if (!kw || !needsMeasure(row.measurements, today)) continue; // 오늘 측정된 키워드는 skip(예산 절약)
            const r = await measure(kw, blogId, '');
            const recs = upsertToday(row.measurements, { date: today, ...r }, today);
            await sbPatch(env, 'blog_keywords', { id: `eq.${row.id}` }, { measurements: recs });
            keywordsMeasured++;
            await sleep(THROTTLE_MS);
        }

        return jsonResponse({ blogAccountId, blogId, postsMeasured, postsRemaining, keywordsMeasured, errors });
    } catch (err) {
        return jsonResponse({ error: `크롤 오류: ${String((err as Error)?.message || err)}`, errors }, 500);
    }
}
