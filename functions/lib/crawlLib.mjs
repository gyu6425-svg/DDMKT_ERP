// 서버리스 크롤 헬퍼 — crawler/blog_rank_crawler.py 의 RSS/키워드/Supabase 쓰기를 JS 단일소스로 포팅.
// Cloudflare Function(crawl-blog.ts) + dev 서버(openai-card-image-api.mjs) + node 테스트가 공유.
// 측정(ti/bl) 파서는 naverRank.mjs 재사용. 여기엔 RSS·키워드·DB쓰기·날짜 헬퍼만.

// 전국 지역 사전(접미어 없는 지역 인식용). 동기화 주의: crawler/blog_rank_crawler.py 의 동일 데이터와 1:1 유지.
// metro/newTowns + 시/구 콜로퀄(송파구→송파). 동은 '~동' 규칙으로 처리. (JSON import 는 Cloudflare 빌드 깨져서 인라인.)
const REGION_METRO = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종'];
const REGION_NEWTOWNS = ['위례', '판교', '광교', '동탄', '별내', '다산', '미사', '운정', '청라', '영종', '송도', '마곡', '배곧', '옥정', '고덕', '호매실', '삼송', '원흥', '지축', '향동', '덕은', '갈매', '평촌', '산본', '중동', '일산', '분당', '정자', '서현', '신항', '한강신도시', '위례신도시', '다산신도시', '미사강변'];
const REGION_SI = ['수원시', '성남시', '고양시', '용인시', '부천시', '안산시', '안양시', '남양주시', '화성시', '평택시', '의정부시', '시흥시', '파주시', '김포시', '광명시', '광주시', '군포시', '오산시', '이천시', '양주시', '안성시', '구리시', '포천시', '의왕시', '하남시', '여주시', '동두천시', '과천시', '춘천시', '원주시', '강릉시', '동해시', '태백시', '속초시', '삼척시', '청주시', '충주시', '제천시', '천안시', '공주시', '보령시', '아산시', '서산시', '논산시', '계룡시', '당진시', '전주시', '군산시', '익산시', '정읍시', '남원시', '김제시', '목포시', '여수시', '순천시', '나주시', '광양시', '포항시', '경주시', '김천시', '안동시', '구미시', '영주시', '영천시', '상주시', '문경시', '경산시', '창원시', '진주시', '통영시', '사천시', '김해시', '밀양시', '거제시', '양산시', '제주시', '서귀포시'];
const REGION_GUN = ['양평군', '가평군', '연천군', '홍천군', '횡성군', '영월군', '평창군', '정선군', '철원군', '화천군', '양구군', '인제군', '고성군', '양양군', '보은군', '옥천군', '영동군', '증평군', '진천군', '괴산군', '음성군', '단양군', '금산군', '부여군', '서천군', '청양군', '홍성군', '예산군', '태안군', '완주군', '진안군', '무주군', '장수군', '임실군', '순창군', '고창군', '부안군', '담양군', '곡성군', '구례군', '고흥군', '보성군', '화순군', '장흥군', '강진군', '해남군', '영암군', '무안군', '함평군', '영광군', '장성군', '완도군', '진도군', '신안군', '의성군', '청송군', '영양군', '영덕군', '청도군', '고령군', '성주군', '칠곡군', '예천군', '봉화군', '울진군', '울릉군', '의령군', '함안군', '창녕군', '남해군', '하동군', '산청군', '함양군', '거창군', '합천군', '기장군', '달성군', '군위군', '강화군', '옹진군', '울주군'];
const REGION_GU = ['종로구', '용산구', '성동구', '광진구', '동대문구', '중랑구', '성북구', '강북구', '도봉구', '노원구', '은평구', '서대문구', '마포구', '양천구', '강서구', '구로구', '금천구', '영등포구', '동작구', '관악구', '서초구', '강남구', '송파구', '강동구', '영도구', '부산진구', '동래구', '해운대구', '사하구', '금정구', '연제구', '수영구', '사상구', '수성구', '달서구', '미추홀구', '연수구', '남동구', '부평구', '계양구', '광산구', '유성구', '대덕구', '장안구', '권선구', '팔달구', '영통구', '수정구', '중원구', '분당구', '만안구', '동안구', '원미구', '소사구', '오정구', '덕양구', '일산동구', '일산서구', '처인구', '기흥구', '수지구', '상록구', '단원구', '상당구', '서원구', '흥덕구', '청원구', '동남구', '서북구', '완산구', '덕진구', '의창구', '성산구', '마산합포구', '마산회원구', '진해구'];
// 콜로퀄(시/구 접미어 떼기)로 만들면 일반명사와 충돌하는 지역은 콜로퀄 미등록(명시적 구리시/광명시는 접미어로 인식).
const COLLOQUIAL_EXCLUDE = ['구리', '광명'];

const REGION_SET = (() => {
    const set = new Set([...REGION_METRO, ...REGION_NEWTOWNS]);
    const addColloquial = (arr, suffix) => {
        for (const full of arr) {
            if (full.endsWith(suffix)) {
                const c = full.slice(0, -1);
                if (c.length >= 2 && !COLLOQUIAL_EXCLUDE.includes(c)) set.add(c);
            }
        }
    };
    addColloquial(REGION_SI, '시');
    addColloquial(REGION_GUN, '군');
    addColloquial(REGION_GU, '구');
    return set;
})();

const TAILS = ['후기', '비용', '정리', '추천', '방법', '안내', '가격', '내돈내산', '솔직후기', '체크리스트', '비교', '총정리'];

// 동기화 주의: crawler/blog_rank_crawler.py 의 동일 리스트와 1:1 유지. 테스트(crawlLib.test.mjs / test_parsers.py)가 sync 보증.
// 제목에서 메인키워드 추출용. 지역=구>동>첫단어, 서비스=지역 뒤 첫 '서비스 접미어' 단어(더 큰 카테고리=앞선 것).
const MODIFIER_WORDS = ['아파트', '주택', '빌라', '상가', '사무실', '사무용', '사무', '오피스텔', '오피스', '빌딩', '신축', '구축', '단독주택', '다세대', '원룸', '투룸', '욕실', '화장실', '주방', '베란다', '발코니', '지하', '외벽', '내벽', '공장', '매장', '학원'];
const MODIFIER_PREFIXES = ['스탠드형', '벽걸이형', '스탠드', '벽걸이', '천장형', '시스템', '가정용', '업소용', '이동식'];
const SERVICE_SUFFIXES = ['청소', '교체', '탐지', '시공', '수리', '설치', '점검', '코팅', '철거', '방수', '줄눈', '인테리어', '제거', '도배', '장판', '보수', '복원', '리모델링', '세척', '폐기물', '폐기', '처리', '이전', '공사', '막힘', '뚫기', '간판'];
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
    '정말', '진짜', '바로', '드뎌', '이제', '벌써', '우리집', '인기', '업체', '전문', '비오는날',
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
        // 접미어 없는 지역명 사전 매칭(위례·송파·진해·춘천 등). '여름'은 사전에 없어 안 잡힘.
        regionIdx = words.findIndex((w) => REGION_SET.has(w));
    }
    if (regionIdx === -1) {
        // 알려진 지역명이 없으면 '서비스 단어 바로 앞' 단어를 지역으로(설명어로 시작하는 제목 대응:
        // '에어컨 관리…용원 에어컨청소'→용원, '냄새…장유 에어컨청소'→장유). 수식어(스탠드/천장형…) 건너뜀.
        const svcIdx = words.findIndex((w) => {
            const sw = stripModifierPrefix(w);
            return sw && !MODIFIER_WORDS.includes(sw) && endsWithService(sw);
        });
        if (svcIdx > 0) {
            for (let i = svcIdx - 1; i >= 0; i -= 1) {
                const sw = stripModifierPrefix(words[i]);
                if (
                    !sw ||
                    MODIFIER_WORDS.includes(words[i]) ||
                    MODIFIER_PREFIXES.includes(words[i]) ||
                    LEAD_STOPWORDS.includes(words[i]) ||
                    endsWithService(sw)
                ) {
                    continue;
                }
                regionIdx = i;
                break;
            }
        }
    }
    if (regionIdx === -1) {
        // 그래도 없으면 첫 '비설명·비수식' 단어를 지역으로(계절·설명어 '여름' 등 건너뜀).
        regionIdx = words.findIndex((w) => !LEAD_STOPWORDS.includes(w) && !MODIFIER_WORDS.includes(w));
    }
    if (regionIdx === -1) regionIdx = 0;
    const region = words[regionIdx];

    // 상위 지역(광역시)이 지역 앞에 별도 토큰으로 있으면 함께 표기(사용자 확정: '인천 논현동 간판').
    let metroPrefix = '';
    for (let i = 0; i < regionIdx; i += 1) {
        if (REGION_METRO.includes(words[i]) && words[i] !== region) {
            metroPrefix = words[i];
            break;
        }
    }
    const withMetro = (kw) => (metroPrefix && !kw.startsWith(metroPrefix) ? `${metroPrefix} ${kw}` : kw);

    // 지역 토큰 자체가 서비스로 끝나면(지역+서비스 한 단어, 예 '남양주누수탐지') 그대로.
    if (endsWithService(region)) return withMetro(region);

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
        const sw = stripped[svcEnd];
        const matched = SERVICE_SUFFIXES.find((s) => sw.endsWith(s)) || '';
        if (sw !== matched) {
            // 이미 완전한 서비스 복합어(책장철거/집기폐기/이사폐기물/유리교체) → 그대로(앞 단어 안 붙임).
            service = sw;
        } else {
            // 단어가 접미어 자체(청소/교체) → 바로 앞 목적어 1개만 결합(에어컨 청소→에어컨청소).
            const prev = svcEnd - 1;
            const pw = prev > regionIdx || (prev >= 0 && prev !== regionIdx) ? stripped[prev] : '';
            if (
                pw &&
                prev !== regionIdx &&
                !MODIFIER_WORDS.includes(pw) &&
                !isRegionCandidate(pw) &&
                !LEAD_STOPWORDS.includes(pw) &&
                !endsWithService(pw)
            ) {
                service = pw + sw;
            } else {
                service = sw;
            }
        }
    } else {
        for (let i = 0; i < words.length; i += 1) {
            if (i === regionIdx) continue;
            const sw = stripped[i];
            if (!sw || MODIFIER_WORDS.includes(sw) || isRegionCandidate(sw)) continue;
            service = sw;
            break;
        }
    }

    if (!service || region === service) return withMetro(region);
    return withMetro(`${region} ${service}`);
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

// 지역부 끝에 붙은 수식어(스탠드/천장형/사무실 등)를 반복 제거 — '진해스탠드'→'진해'.
function stripTrailingModifier(s) {
    let r = s;
    let changed = true;
    while (changed && r) {
        changed = false;
        for (const m of [...MODIFIER_PREFIXES, ...MODIFIER_WORDS]) {
            // >= : 잔여 전체가 수식어면(지역 없음) 끝까지 떼어 ''로 만들고 제목 폴백 유도.
            if (r.length >= m.length && r.endsWith(m)) {
                r = r.slice(0, r.length - m.length);
                changed = true;
                break;
            }
        }
    }
    return r;
}

// 모바일 글 본문 HTML 하단 해시태그 추출. 두 소스 병합(중복 제거):
//  1) gsTagName JS 변수(쉼표구분) — 구·신 에디터 공통이라 가장 안정적.
//  2) <span class="__se-hash-tag">#태그</span> (신 에디터 본문).
export function extractHashtagsFromHtml(html) {
    const s = String(html || '');
    const out = [];
    const push = (t) => {
        const v = String(t).replace(/\s+/g, '').replace(/^#/, '').trim();
        if (v && !out.includes(v)) out.push(v);
    };
    const g = s.match(/gsTagName\s*=\s*"([^"]*)"/);
    if (g && g[1]) for (const t of g[1].split(',')) push(t);
    const re = /class="__se-hash-tag">#([^<]+)<\/span>/g;
    let m;
    while ((m = re.exec(s))) push(m[1]);
    return out;
}

// 글루 해시태그의 앞부분이 '알려진 지역명'이면 그 지역 prefix 반환(최장 매칭), 없으면 ''.
// 예: 천안식당창업→천안, 삼송동집기폐기→삼송동, 공공기관청소경비→''(지역없음).
function regionPrefix(t) {
    let best = '';
    for (const r of REGION_SET) {
        if (t.length > r.length && t.startsWith(r) && r.length > best.length) best = r;
    }
    const m = t.match(/^(.{2,4}?[동구])(.+)$/); // 동/구로 끝나는 앞부분(삼송동 등) — 사전에 없어도 인식
    if (m && m[1].length >= 3 && m[1].length > best.length && !GU_BLACKLIST.includes(m[1]) && !DONG_BLACKLIST.includes(m[1])) {
        best = m[1];
    }
    return best;
}
// 이 해시태그가 '키워드로 쓸 만'한가 = 지역 또는 서비스어를 담고 있는가. (포트폴리오=false)
function hasRegionOrService(t) {
    return !!regionPrefix(t) || SERVICE_SUFFIXES.some((s) => t.includes(s));
}

// 최종 자동키워드 — '무조건 블로그 하단 해시태그' 우선(사용자 확정 방향: 해시태그 그대로, 이상한 건 수동수정):
//  1) 복수 해시태그 공통 suffix → 지역+서비스(춘천유리교체류).
//  2) 글루 단일 + 제목 서비스로 지역 분리(#진해스탠드에어컨청소 → 진해 에어컨청소).
//  3) 지역/서비스를 담은 해시태그면 그 해시태그를 메인키워드로(지역 있으면 분리·수식어 제거).
//     천안식당창업→천안 식당창업, 공공기관청소경비→그대로. (식당/폐업/매입 등 제목으로 뽑으면 틀리는 업종 대응)
//  4) 쓸 해시태그가 없으면(포트폴리오 등) 제목에서 지역+서비스 추출.
export function deriveKeyword(title, tags) {
    const clean = (Array.isArray(tags) ? tags : [])
        .map((t) => String(t || '').replace(/^#/, '').replace(/\s+/g, '').trim())
        .filter(Boolean);
    // 1) 복수 해시태그 공통 suffix (지역부의 수식어는 한 번 더 제거 — '주택 청소' 같은 오인 방지)
    const multi = pickMainHashtagKeyword(clean);
    if (multi && multi.includes(' ')) {
        const sp = multi.indexOf(' ');
        const region = stripTrailingModifier(multi.slice(0, sp));
        if (region) return `${region}${multi.slice(sp)}`;
    }
    // 2) 글루 단일 해시태그 + 제목 서비스
    const titleKw = extractKeyword(title);
    const parts = titleKw.split(' ');
    const titleService = parts[parts.length - 1];
    if (titleService && titleService.length >= 2) {
        for (const t of clean) {
            if (t.endsWith(titleService) && t.length > titleService.length) {
                const region = stripTrailingModifier(t.slice(0, t.length - titleService.length));
                if (region) return `${region} ${titleService}`;
            }
        }
    }
    // 3) 지역/서비스를 담은 해시태그면 그 해시태그를 메인키워드로(가장 짧은=핵심). 지역 있으면 분리.
    const usable = clean.filter(hasRegionOrService);
    if (usable.length) {
        const main = usable.reduce((a, b) => (b.length < a.length ? b : a));
        const rp = regionPrefix(main);
        if (rp) {
            const rest = stripModifierPrefix(main.slice(rp.length));
            return rest ? `${rp} ${rest}` : rp;
        }
        return stripModifierPrefix(main); // 지역 없는 서비스 키워드(공공기관청소경비 등) 그대로
    }
    // 4) 제목 폴백 (포트폴리오 등 쓸 해시태그 없음)
    return titleKw;
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
