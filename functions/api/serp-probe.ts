// (임시 검증용) Cloudflare 서버에서 네이버 m.search 인기글 SERP를 가져올 수 있는지 테스트.
//   목적: 인기탭 스크랩을 우리 사무실 IP 대신 CF 분산 IP에서 할 수 있는지 실측.
//   GET /api/serp-probe?q=수원+맛집  →  {status, blocked, hasPopular, len, ip}
type Ctx = { request: Request };

function j(b: unknown, s = 200) {
    return new Response(JSON.stringify(b), {
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' },
        status: s,
    });
}

export async function onRequestGet({ request }: Ctx) {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();
    const host = url.searchParams.get('host') === 'pc' ? 'https://search.naver.com' : 'https://m.search.naver.com';
    if (!q) return j({ error: 'q 없음' }, 400);
    const ua =
        host.includes('m.search')
            ? 'Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
            : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
    let r: Response;
    let text: string;
    try {
        r = await fetch(`${host}/search.naver?query=${encodeURIComponent(q)}`, {
            headers: { 'User-Agent': ua, 'Accept-Language': 'ko' },
        });
        text = await r.text();
    } catch (e) {
        return j({ error: `fetch 실패: ${String(e)}` }, 502);
    }
    const blocked = text.includes('제한되었습니다') || text.includes('과도한 접근');
    const hasPopular = text.includes('인기글');
    const ip = (text.match(/IP:\s*([0-9.]+)/) || [])[1] || null;
    return j({ host, status: r.status, blocked, hasPopular, len: text.length, ip });
}
