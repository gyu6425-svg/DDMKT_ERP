// 네이버 '인기글' 필터 — 브라우저는 CORS 로 search.naver.com 을 못 부르므로 서버(:8787)에서 돈다.
//   crawler/cafe_pub/cafe_auto_publish.py 의 has_popular_pc 를 1:1 이식(로직이 갈라지면 결과가 달라진다).
//   ⚠️ Python 은 verify=False 지만 네이버 인증서는 정상이라 Node fetch 로 문제없다(crawlBlogLocal 로 검증됨).

export const PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const LB_RE = /https:\/\/s\.search\.naver\.com\/p\/review\/\d+\/search\.naver\?[^\s"'<>\\]+/g;
const CAFE_RE = /cafe\.naver\.com\/[A-Za-z0-9_-]+\/\d+/;

function unescapeHtml(s) {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** 키워드 하나에 대해 인기글 블록이 있는지. { hasPopular, reason }.
 *  reason: 'ok' | 'no_popular' | 'no_review_block' | 'serp_fetch_failed' */
export async function hasPopularPc(keyword) {
    const su = `https://search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`;
    let html;
    try {
        const r = await fetch(su, {
            headers: { 'User-Agent': PC_UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
            signal: AbortSignal.timeout(15000),
        });
        html = await r.text();
    } catch {
        return { hasPopular: false, reason: 'serp_fetch_failed' };
    }
    const urls = html.match(LB_RE);
    if (!urls || !urls.length) {
        return { hasPopular: false, reason: 'no_review_block' };
    }
    for (const raw of urls) {
        const u = unescapeHtml(raw);
        let b;
        try {
            const rr = await fetch(u, {
                headers: { 'User-Agent': PC_UA, Referer: su, Accept: '*/*' },
                signal: AbortSignal.timeout(15000),
            });
            b = await rr.text();
        } catch {
            continue;
        }
        if (b.length > 1000 && b.includes('인기글') && CAFE_RE.test(b)) {
            return { hasPopular: true, reason: 'ok' };
        }
    }
    return { hasPopular: false, reason: 'no_popular' };
}
