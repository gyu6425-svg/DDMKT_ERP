// 서버리스 크롤 헬퍼 — crawler/blog_rank_crawler.py 의 RSS/키워드/Supabase 쓰기를 JS 단일소스로 포팅.
// Cloudflare Function(crawl-blog.ts) + dev 서버(openai-card-image-api.mjs) + node 테스트가 공유.
// 측정(ti/bl) 파서는 naverRank.mjs 재사용. 여기엔 RSS·키워드·DB쓰기·날짜 헬퍼만.

const TAILS = ['후기', '비용', '정리', '추천', '방법', '안내', '가격', '내돈내산', '솔직후기', '체크리스트', '비교', '총정리'];

// 동기화 주의: crawler/blog_rank_crawler.py 의 동일 리스트와 1:1 유지. 테스트(crawlLib.test.mjs / test_parsers.py)가 sync 보증.
// 제목에서 메인키워드 추출용. 지역=구>동>첫단어, 서비스=지역 뒤 첫 '서비스 접미어' 단어(더 큰 카테고리=앞선 것).
const MODIFIER_WORDS = ['아파트', '주택', '빌라', '상가', '사무실', '사무용', '사무', '오피스텔', '오피스', '빌딩', '신축', '구축', '단독주택', '다세대', '원룸', '투룸', '욕실', '화장실', '주방', '베란다', '발코니', '지하', '외벽', '내벽'];
const MODIFIER_PREFIXES = ['스탠드형', '벽걸이형', '스탠드', '벽걸이', '천장형', '시스템', '가정용', '업소용', '이동식'];
const SERVICE_SUFFIXES = ['청소', '교체', '탐지', '시공', '수리', '설치', '점검', '코팅', '철거', '방수', '줄눈', '인테리어', '제거', '도배', '장판', '보수', '복원', '리모델링', '세척', '폐기물', '폐기', '처리', '이전', '공사'];
const GU_BLACKLIST = ['배수구', '입구', '출구', '환기구', '통풍구', '비상구', '가구', '도구', '연구', '욕구'];
const DONG_BLACKLIST = ['운동', '이동', '활동', '자동', '공동', '행동', '변동', '진동', '노동', '충동'];
// '시(市)'가 아닌 '~시(時)' 오탐 제외(사용시·필요시 등). 도시명은 보통 3자+ 라 len>=3 + 블랙리스트로 거른다.
const SI_BLACKLIST = [
    '사용시', '필요시', '이용시', '방문시', '구매시', '신청시', '설치시', '청소시', '발생시', '작동시',
    '외출시', '취침시', '가동시', '운전시', '주행시', '충전시', '교체시', '수리시', '점검시', '고장시',
    '정전시', '누수시', '결제시', '주문시', '배송시', '예약시', '상담시', '문의시', '계약시', '입주시',
    '이사시', '폐기시', '철거시', '건조시',
];
// 시/구/동 없는 지역(위례·송파 등)일 때 첫 단어를 지역으로 쓰는데, 제목이 계절·설명어로 시작하면 그걸 건너뛴다.
const LEAD_STOPWORDS = [
    '여름', '겨울', '봄', '가을', '초여름', '한여름', '늦여름', '초겨울', '한겨울', '장마', '장마철', '무더위',
    '무더운', '환절기', '요즘', '이번', '올해', '작년', '내년', '드디어', '오늘', '어제', '내일', '최근',
    '정말', '진짜', '바로', '드뎌', '이제', '벌써',
];

function stripModifierPrefix(w) {
    for (const p of MODIFIER_PREFIXES) {
        if (w.length > p.length && w.startsWith(p)) return w.slice(p.length);
    }
    return w;
}
function endsWithService(w) {
    return SERVICE_SUFFIXES.some((s) => w.endsWith(s));
}
function isRegionCandidate(w) {
    return w.length >= 3 && (w.endsWith('동') || w.endsWith('구'));
}

function unescapeHtml(s) {
    return String(s)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

// 자동키워드(제목 폴백) — 지역(구>동>첫단어) + 지역 뒤 첫 서비스 단어. 해시태그가 깔끔하면 그쪽을 우선 사용.
export function extractKeyword(title) {
    let t = unescapeHtml(title || '').trim();
    t = t.replace(/<[^>]+>/g, '');
    t = t.replace(/[\[\]()·,.!?~_/|-]/g, ' ');
    const words = t.split(/\s+/).filter((w) => w && !TAILS.includes(w));
    if (!words.length) return t.slice(0, 12);

    // 지역: 높은 행정단위 우선 ~시 > ~구 > ~동 > 첫 단어. (오탐은 블랙리스트로 제외)
    let regionIdx = words.findIndex((w) => w.length >= 3 && w.endsWith('시') && !SI_BLACKLIST.includes(w));
    if (regionIdx === -1) {
        regionIdx = words.findIndex((w) => w.length >= 3 && w.endsWith('구') && !GU_BLACKLIST.includes(w));
    }
    if (regionIdx === -1) {
        regionIdx = words.findIndex((w) => w.length >= 3 && w.endsWith('동') && !DONG_BLACKLIST.includes(w));
    }
    if (regionIdx === -1) {
        // 시/구/동 없음 → 첫 '비설명·비수식' 단어를 지역으로(계절·설명어 '여름' 등 건너뜀).
        regionIdx = words.findIndex((w) => !LEAD_STOPWORDS.includes(w) && !MODIFIER_WORDS.includes(w));
    }
    if (regionIdx === -1) regionIdx = 0;
    const region = words[regionIdx];

    // 지역 토큰 자체가 서비스로 끝나면(지역+서비스 한 단어, 예 '남양주누수탐지') 그대로.
    if (endsWithService(region)) return region;

    const stripped = words.map(stripModifierPrefix);
    // 서비스: 지역 '뒤'의 첫 서비스-접미어 단어(= 인접·더 큰 카테고리). 없으면 지역 '앞'에서 탐색.
    let svcEnd = -1;
    for (let i = regionIdx + 1; i < words.length; i += 1) {
        const sw = stripped[i];
        if (!sw || MODIFIER_WORDS.includes(sw)) continue;
        if (endsWithService(sw)) {
            svcEnd = i;
            break;
        }
    }
    if (svcEnd === -1) {
        for (let i = 0; i < regionIdx; i += 1) {
            const sw = stripped[i];
            if (!sw || MODIFIER_WORDS.includes(sw)) continue;
            if (endsWithService(sw)) {
                svcEnd = i;
                break;
            }
        }
    }

    let service = '';
    if (svcEnd !== -1) {
        // 복합어 조립: 접미어 단어에서 왼쪽으로 인접한 비수식·비지역 단어를 모아 붙임(예 '에어컨'+'청소'→'에어컨청소').
        const parts = [];
        for (let k = svcEnd; k >= 0; k -= 1) {
            if (k === regionIdx) break;
            const sw = stripped[k];
            if (!sw || MODIFIER_WORDS.includes(sw)) break;
            if (k !== svcEnd && isRegionCandidate(sw)) break;
            parts.unshift(sw);
            if (k !== svcEnd && endsWithService(sw)) break;
            if (parts.length >= 2) break; // 복합어는 최대 2단어(예 '에어컨청소'). 형용사 글루 폭주 방지.
        }
        service = parts.join('');
    } else {
        for (let i = 0; i < words.length; i += 1) {
            if (i === regionIdx) continue;
            const sw = stripped[i];
            if (!sw || MODIFIER_WORDS.includes(sw) || isRegionCandidate(sw)) continue;
            service = sw;
            break;
        }
    }

    if (!service || region === service) return region;
    return `${region} ${service}`;
}

// 여러 문자열의 최장 공통 suffix(끝글자부터 일치) — 해시태그에서 '서비스' 부분 추출용.
function longestCommonSuffix(arr) {
    if (!arr.length) return '';
    let suffix = arr[0];
    for (const s of arr.slice(1)) {
        let i = 0;
        while (i < suffix.length && i < s.length && suffix[suffix.length - 1 - i] === s[s.length - 1 - i]) {
            i += 1;
        }
        suffix = suffix.slice(suffix.length - i);
        if (!suffix) break;
    }
    return suffix;
}

// 글 하단 해시태그 목록에서 '메인키워드'(지역+서비스, 수식어 없는 최단형)를 고른다.
// 예: ['춘천유리교체','춘천아파트유리교체','유리교체'] → '춘천 유리교체'
// (서비스 = 모든 태그의 공통 suffix '유리교체'. 그 suffix 로 끝나면서 가장 짧은 = '춘천유리교체'.
//  거기서 서비스를 떼면 지역 '춘천' → '춘천 유리교체'.)
export function pickMainHashtagKeyword(tags) {
    const clean = (Array.isArray(tags) ? tags : [])
        .map((t) => String(t || '').replace(/^#/, '').replace(/\s+/g, '').trim())
        .filter(Boolean);
    if (!clean.length) return '';
    const uniq = [...new Set(clean)];
    if (uniq.length === 1) return uniq[0];

    const service = longestCommonSuffix(uniq);
    if (service && service.length >= 2) {
        // 서비스로 끝나면서 그보다 긴(=지역/수식어 접두 보유) 태그 중 가장 짧은 것 = 수식어 없는 메인.
        let best = '';
        for (const t of uniq) {
            if (t.endsWith(service) && t.length > service.length && (!best || t.length < best.length)) {
                best = t;
            }
        }
        if (best) {
            const region = best.slice(0, best.length - service.length);
            return region ? `${region} ${service}` : service;
        }
    }
    // 폴백: 공통 서비스가 약하면 가장 짧은 태그(보통 지역+서비스 핵심형).
    return uniq.reduce((a, b) => (b.length < a.length ? b : a));
}

// 최종 자동키워드: 해시태그가 '지역+서비스'로 깔끔하게 분리되면(공백 포함) 그걸 우선,
// 아니면(치우다처럼 일반 태그) 제목에서 추출. 둘 다 애매하면 편집에서 수기수정.
export function deriveKeyword(title, tags) {
    const fromTags = pickMainHashtagKeyword(tags);
    if (fromTags && fromTags.includes(' ')) return fromTags;
    return extractKeyword(title);
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
        // 네이버 RSS <tag> = 글 하단 해시태그(쉼표 구분). 키워드 추출에 우선 사용.
        const tagRaw = unescapeHtml(pick('tag'));
        const tags = tagRaw ? tagRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
        out.push({ url, title, published_date, tags });
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
