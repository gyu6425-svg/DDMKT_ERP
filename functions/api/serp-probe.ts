// 카페 인기탭 스크랩 보조 — Cloudflare 서버에서 네이버 SERP HTML을 대신 가져온다(분산 IP).
//   사무실 IP 스크랩과 '섞어서' 부하를 분산하는 용도. GET /api/serp-probe?q=키워드&host=m|pc&token=...
//   반환 {status, blocked, html}. blocked=true면 CF IP가 네이버에 막힌 것 → 호출측이 다른 갈래로 폴백.
//   ※ 남용 방지: CF 환경변수 SERP_TOKEN 설정 시 token 일치 필요(미설정이면 개방 — 설정 권장).
type Ctx = { request: Request; env: Record<string, string | undefined> };

function j(b: unknown, s = 200) {
    return new Response(JSON.stringify(b), {
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' },
        status: s,
    });
}

export async function onRequestGet({ request, env }: Ctx) {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return j({ error: 'q 없음' }, 400);
    // 토큰 게이트(설정된 경우만)
    if (env.SERP_TOKEN && url.searchParams.get('token') !== env.SERP_TOKEN) {
        return j({ error: 'unauthorized' }, 403);
    }
    const pc = url.searchParams.get('host') === 'pc';
    const host = pc ? 'https://search.naver.com' : 'https://m.search.naver.com';
    const ua = pc
        ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
        : 'Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
    let r: Response;
    let text: string;
    try {
        r = await fetch(`${host}/search.naver?query=${encodeURIComponent(q)}`, {
            headers: { 'User-Agent': ua, 'Accept-Language': 'ko' },
        });
        text = await r.text();
    } catch (e) {
        return j({ error: `fetch 실패: ${String(e)}`, blocked: true }, 502);
    }
    const blocked = text.includes('제한되었습니다') || text.includes('과도한 접근') || r.status === 403 || r.status === 429;
    return j({ status: r.status, blocked, html: blocked ? '' : text });
}
