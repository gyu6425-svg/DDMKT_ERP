// 성과 보고서 카톡 카드 썸네일 — /og/:id.png 로 접속하면 저장된 동적 OG 이미지(base64 PNG)를 서빙.
//   /r/:id 의 og:image 가 이 경로를 가리킴. 카톡/메신저 스크래퍼가 이 이미지를 카드 썸네일로 표시.
// @ts-expect-error — .mjs 단일소스(Supabase 헬퍼)
import { sbGet } from '../lib/crawlLib.mjs';

type FunctionContext = {
    params: { id: string | string[] };
    env: Record<string, string | undefined>;
};

const blank = (status = 404) => new Response('', { status });

export async function onRequestGet({ params, env }: FunctionContext) {
    // /og/{uuid}.png → id 에서 .png 제거.
    const id = String(Array.isArray(params.id) ? params.id[0] : params.id || '').replace(/\.png$/i, '');
    if (!/^[0-9a-f-]{16,40}$/i.test(id)) return blank(404);
    try {
        const rows = await sbGet(env, 'report_shares', { id: `eq.${id}`, select: 'og_image', limit: '1' });
        const b64 = Array.isArray(rows) && rows[0] ? rows[0].og_image : null;
        if (!b64) return blank(404);
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        return new Response(bytes, {
            headers: {
                'Content-Type': 'image/png',
                'Cache-Control': 'public, max-age=86400', // 하루 캐시(카톡이 한 번 가져가면 재요청 적음)
            },
        });
    } catch {
        return blank(500);
    }
}
