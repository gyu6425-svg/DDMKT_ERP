// 성과 보고서 '공유 링크' 생성 — 프론트가 만든 보고서 HTML 을 저장하고 공유 id 를 돌려준다.
//   카카오톡 등으로 보낼 고정 URL(/r/:id)을 만들기 위함. 저장/조회는 service_role(서버리스)만.
// @ts-expect-error — .mjs 단일소스(Supabase 헬퍼)
import { sbInsert } from '../lib/crawlLib.mjs';

type FunctionContext = {
    request: Request;
    env: Record<string, string | undefined>;
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const MAX_HTML = 900_000; // 보고서 HTML 상한(악용/과대 저장 방지)

export async function onRequestPost({ request, env }: FunctionContext) {
    // 브라우저 cross-site 호출 차단(같은 출처만). curl 등은 막지 않지만 내부 도구 수준의 가드.
    const origin = request.headers.get('Origin');
    const host = request.headers.get('Host');
    if (origin && host) {
        try {
            if (new URL(origin).host !== host) return json({ error: 'forbidden' }, 403);
        } catch {
            return json({ error: 'forbidden' }, 403);
        }
    }

    let body: { html?: unknown; title?: unknown; ogImage?: unknown };
    try {
        body = (await request.json()) as typeof body;
    } catch {
        return json({ error: 'bad json' }, 400);
    }
    const html = body.html;
    const title = typeof body.title === 'string' ? body.title.slice(0, 200) : null;
    if (typeof html !== 'string' || !html || html.length > MAX_HTML) {
        return json({ error: 'invalid html' }, 400);
    }
    // 카톡 썸네일(og:image) base64 PNG — 보고서마다 실제 순위가 박힌 이미지. 너무 크면 버림(폴백=정적 배너).
    const ogImage =
        typeof body.ogImage === 'string' && body.ogImage.length > 0 && body.ogImage.length <= 800_000
            ? body.ogImage
            : null;

    try {
        const rows = await sbInsert(env, 'report_shares', [{ title, html, og_image: ogImage }]);
        const id = Array.isArray(rows) && rows[0] ? rows[0].id : null;
        if (!id) return json({ error: 'insert failed' }, 500);
        return json({ id });
    } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'error' }, 500);
    }
}
