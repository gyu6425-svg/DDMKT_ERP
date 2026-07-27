// 네이버 '인기글' 필터 — 브라우저는 CORS 로 search.naver.com 을 못 부르므로 서버(:8787)에서 돈다.
//   crawler/cafe_pub/cafe_auto_publish.py 의 has_popular_pc 를 이식.
//   ⚠️ Python 은 verify=False 지만 네이버 인증서는 정상이라 Node fetch 로 문제없다.
//   [하드닝 2026-07] 분산(대행사 PC) 스캔 대비: 서브요청 딜레이+캡 · 차단감지(status/마커→'blocked') ·
//     헤더 현실화. 차단을 'no_popular'로 오보하지 않도록 status/본문을 검사한다.

export const PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const LB_RE = /https:\/\/s\.search\.naver\.com\/p\/review\/\d+\/search\.naver\?[^\s"'<>\\]+/g;
const CAFE_RE = /cafe\.naver\.com\/[A-Za-z0-9_-]+\/\d+/;
// 네이버 봇차단/캡차 인터스티셜 마커(200으로 오는 소프트차단 포함).
const BLOCK_RE = /(정상적인 접근이 아닙니다|비정상적인 (검색|접근)|captcha|보안문자|자동입력 방지|일시적으로 제한)/i;
const MAX_SUBREQ = 3;           // 리뷰 서브요청 상한(과한 SERP 방어)

// 실제 크롬이 보내는 헤더에 가깝게(빈약한 헤더 = 봇 판정 유발).
const COMMON_HEADERS = {
    'User-Agent': PC_UA,
    'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const jitter = (min, max) => Math.floor(min + Math.random() * (max - min));

function unescapeHtml(s) {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// 차단 신호 판정: 429/403, 또는 본문에 차단 마커, 또는 비정상적으로 짧은 SERP.
function looksBlocked(status, body) {
    if (status === 429 || status === 403) return true;
    if (body && BLOCK_RE.test(body)) return true;
    if (body && body.length < 500) return true;   // 정상 SERP 는 수십 KB
    return false;
}

/** 키워드 하나에 대해 인기글 블록이 있는지. { hasPopular, reason }.
 *  reason: 'ok' | 'no_popular' | 'no_review_block' | 'serp_fetch_failed' | 'blocked'
 *  ★ 'blocked' 는 '없음'과 구분해 호출부가 스캔을 멈추고 백오프하도록 한다(차단→'없음' 오보 방지). */
export async function hasPopularPc(keyword) {
    const su = `https://search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`;
    let html;
    let status = 0;
    try {
        const r = await fetch(su, {
            headers: { ...COMMON_HEADERS, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', Referer: 'https://www.naver.com/' },
            signal: AbortSignal.timeout(15000),
        });
        status = r.status;
        html = await r.text();
    } catch {
        return { hasPopular: false, reason: 'serp_fetch_failed' };
    }
    if (looksBlocked(status, html)) {
        return { hasPopular: false, reason: 'blocked' };
    }
    const urls = html.match(LB_RE);
    if (!urls || !urls.length) {
        return { hasPopular: false, reason: 'no_review_block' };
    }
    const pick = urls.slice(0, MAX_SUBREQ);
    for (let i = 0; i < pick.length; i += 1) {
        const u = unescapeHtml(pick[i]);
        let b;
        let st = 0;
        try {
            const rr = await fetch(u, {
                headers: { ...COMMON_HEADERS, Referer: su, Accept: '*/*', 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'cors' },
                signal: AbortSignal.timeout(15000),
            });
            st = rr.status;
            b = await rr.text();
        } catch {
            continue;
        }
        if (looksBlocked(st, b)) {
            return { hasPopular: false, reason: 'blocked' };
        }
        if (b.length > 1000 && b.includes('인기글') && CAFE_RE.test(b)) {
            return { hasPopular: true, reason: 'ok' };
        }
        if (i < pick.length - 1) await sleep(jitter(400, 900));   // 서브요청 사이 지연(python 원본과 동일, JS에서 누락됐던 것)
    }
    return { hasPopular: false, reason: 'no_popular' };
}
