// 공유된 성과 보고서 페이지 — /r/:id 로 접속하면 저장된 보고서 HTML 을 그대로 보여준다.
//   고객사에게 카카오톡으로 보낸 링크가 이 경로. (Cloudflare Pages: functions 가 _redirects(SPA)보다 우선)
// @ts-expect-error — .mjs 단일소스(Supabase 헬퍼)
import { sbGet } from '../lib/crawlLib.mjs';

type FunctionContext = {
    request: Request;
    params: { id: string | string[] };
    env: Record<string, string | undefined>;
};

const notFound = () =>
    new Response('<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:48px;color:#475569">보고서를 찾을 수 없습니다. 링크가 만료되었거나 잘못되었습니다.</body>', {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });

export async function onRequestGet({ request, params, env }: FunctionContext) {
    const id = String(Array.isArray(params.id) ? params.id[0] : params.id || '');
    // uuid 형태만 허용(잘못된 경로/인젝션 방지).
    if (!/^[0-9a-f-]{16,40}$/i.test(id)) return notFound();
    try {
        const rows = await sbGet(env, 'report_shares', {
            id: `eq.${id}`,
            select: 'html,og_image',
            limit: '1',
        });
        if (!Array.isArray(rows) || !rows.length || !rows[0].html) return notFound();
        let html = rows[0].html as string;
        // 저장된 동적 썸네일이 있으면 og:image 를 /og/{id}.png 로 교체(카톡 카드에 실제 순위 이미지).
        if (rows[0].og_image) {
            const ogUrl = `${new URL(request.url).origin}/og/${id}.png`;
            html = html.replace(
                /<meta property="og:image" content="[^"]*">/,
                `<meta property="og:image" content="${ogUrl}">`,
            );
        }
        return new Response(html, {
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=300',
            },
        });
    } catch {
        return notFound();
    }
}
