// 서버리스 크롤 헬퍼 — crawler/blog_rank_crawler.py 의 RSS/키워드/Supabase 쓰기를 JS 단일소스로 포팅.
// Cloudflare Function(crawl-blog.ts) + dev 서버(openai-card-image-api.mjs) + node 테스트가 공유.
// 측정(ti/bl) 파서는 naverRank.mjs 재사용. 여기엔 RSS·키워드·DB쓰기·날짜 헬퍼만.

const TAILS = ['후기', '비용', '정리', '추천', '방법', '안내', '가격', '내돈내산', '솔직후기', '체크리스트', '비교', '총정리'];

function unescapeHtml(s) {
    return String(s)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

// 자동키워드 — 파이썬 extract_keyword(:82-99) 1:1 포팅. '~동 누수탐지' 우선.
export function extractKeyword(title) {
    let t = unescapeHtml(title || '').trim();
    t = t.replace(/<[^>]+>/g, '');
    t = t.replace(/[\[\]()·,.!?~_/|-]/g, ' ');
    const words = t.split(/\s+/).filter((w) => w && !TAILS.includes(w));
    if (!words.length) return t.slice(0, 12);
    const dong = words.find((w) => w.length >= 3 && w.endsWith('동'));
    const hasNusu = words.some((w) => w.includes('누수'));
    if (dong && hasNusu) return `${dong} 누수탐지`;
    const j = words.findIndex((w) => w.includes('누수'));
    if (j !== -1) return words.slice(0, j + 1).join(' ');
    return words.slice(0, 2).join(' ');
}

// blog.naver.com/{id}/{logNo} → [id, logNo]
export function parseBlogUrl(url) {
    const m = String(url || '').match(/(?:m\.)?blog\.naver\.com\/([^/?#]+)(?:\/(\d{6,}))?/);
    return m ? [m[1], m[2] || ''] : ['', ''];
}
export const extractLogNo = (url) => parseBlogUrl(url)[1];

// KST(UTC+9) 기준 YYYY-MM-DD — 파이썬 크롤러(로컬 KST)와 dedup 날짜 통일.
export function todayKST(now = new Date()) {
    return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// RSS 2.0(rss.blog.naver.com) 파싱 — feedparser 대체(정규식). 상위 maxPosts 개.
export function parseRss(xml, maxPosts = 5) {
    const out = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRe.exec(xml)) && out.length < maxPosts) {
        const block = m[1];
        const pick = (tag) => {
            const r = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${tag}>`, 'i');
            const mm = block.match(r);
            return mm ? mm[1].trim() : '';
        };
        const url = pick('link');
        if (!url) continue;
        const title = unescapeHtml(pick('title'));
        const pub = pick('pubDate');
        let published_date = null;
        if (pub) {
            const d = new Date(pub);
            if (!Number.isNaN(d.getTime())) published_date = todayKST(d);
        }
        out.push({ url, title, published_date });
    }
    return out;
}

// 측정 시계열 upsert — 같은 날짜 레코드 제거 후 새 레코드 추가(파이썬 dedup 동일).
export function upsertToday(old, record, today) {
    const kept = (Array.isArray(old) ? old : []).filter((r) => r && r.date !== today);
    kept.push(record);
    return kept;
}

// ── Supabase REST (service_role) — 파이썬 sb_get/sb_insert/sb_patch 포팅 ──
function sbHeaders(env, extra) {
    return {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        ...(extra || {}),
    };
}

export async function sbGet(env, path, params) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}${qs}`, { headers: sbHeaders(env) });
    if (!r.ok) throw new Error(`sbGet ${path} ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return r.json();
}

export async function sbInsert(env, path, rows, onConflict) {
    const prefer = ['return=representation'];
    let qs = '';
    if (onConflict) {
        qs = '?on_conflict=' + encodeURIComponent(onConflict);
        prefer.push('resolution=merge-duplicates');
    }
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}${qs}`, {
        method: 'POST',
        headers: sbHeaders(env, { Prefer: prefer.join(',') }),
        body: JSON.stringify(rows),
    });
    if (!r.ok) throw new Error(`sbInsert ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
}

export async function sbPatch(env, path, params, payload) {
    const qs = '?' + new URLSearchParams(params).toString();
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}${qs}`, {
        method: 'PATCH',
        headers: sbHeaders(env, { Prefer: 'return=representation' }),
        body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`sbPatch ${path} ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return r.json();
}
