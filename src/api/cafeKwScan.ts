import { supabase } from '../lib/supabase';

// 플레이스 주소 → 진짜 인기탭 발굴. cafe_kw_requests 큐에 등록(status:'queued') → 워커가 처리 → 폴링.
//   전제: docs/cafe-kw-requests-rls.sql(고객 requested_by 정책). 워커/스캐너 = 다른 세션 cafe_kw_probe.
export type KwCafe = { rank: number; who: string; kind?: string; title?: string; article?: string };
export type KwResult = { keyword: string; volume?: number; theme?: string; cafes: KwCafe[] };

// 지역형 고정 동 마스터 조회(cafe_region_dong). sidos=선택 시도(서울/경기/인천). 기본은 '동'만(읍/면 제외).
export type RegionDong = { sido: string; gu: string; dong: string };
export async function getRegionDongs(sidos: string[], dongOnly = true): Promise<RegionDong[]> {
    if (!sidos.length) return [];
    const { data } = await supabase.from('cafe_region_dong')
        .select('sido,gu,dong').in('sido', sidos).order('gu').order('dong').limit(2000);
    let rows = (data ?? []) as RegionDong[];
    if (dongOnly) rows = rows.filter((r) => r.dong.endsWith('동'));
    return rows;
}

// 행정구/시 토큰 — cafe_region_dong 의 gu 를 시/구로 쪼갠다.
//   '수원시 장안구'→[수원시,수원,장안구,장안], '고양시덕양구'(붙은형)→[고양시,고양,덕양구,덕양], '강남구'→[강남구,강남].
//   ※ 실측(2026-07): 동(洞) 단위는 인기탭 진입 ~0%, 구/시 단위라야 잡힘 → 지역형은 이 토큰을 쓴다.
function guTokens(gu: string): string[] {
    const out = new Set<string>();
    const parts: string[] = [];
    for (const part of (gu || '').split(/\s+/)) {
        const m = part.match(/^(.+?시)(.+구)$/);
        if (m) parts.push(m[1], m[2]); else if (part) parts.push(part);
    }
    for (const part of parts) {
        const t = part.trim();
        if (!t) continue;
        out.add(t);
        const base = t.replace(/(특별자치시|특별자치도|특별시|광역시|자치시|자치구|시|군|구)$/, '');
        if (base.length >= 2) out.add(base);
    }
    return [...out];
}

// 인기탭 캐시(cafe_kw_targets)에서 '인기탭 확인된' 키워드만. prescan/워커가 채운 판정 재사용 — 라이브 스캔 없이 즉시.
//   지역형 '지역 키워드 생성'은 이걸로 걸러 인기탭 통과분만 보여준다(무조건 인기탭만). 없으면 그 지역 프리스캔 필요.
export async function getPopularFromCache(keywords: string[]): Promise<KwResult[]> {
    const out: KwResult[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < keywords.length; i += 200) {
        const chunk = keywords.slice(i, i + 200);
        const { data } = await supabase.from('cafe_kw_targets')
            .select('keyword,has_section,verdict,theme,volume,cafes').in('keyword', chunk);
        for (const r of (data ?? []) as { keyword: string; has_section: boolean; verdict: string | null; theme: string | null; volume: number | null; cafes: KwCafe[] | null }[]) {
            // 워커 _is_pop 과 동일 판정(카페분산 + 블로그섹션=카페무경쟁). 옛 코드는 카페분산만 읽어
            //   워커 타임아웃 시 무혈입성 기회 키워드가 조용히 소실됐다.
            const v = r.verdict || '';
            const ok = r.has_section && (v.startsWith('카페분산') || v.startsWith('블로그섹션')) && !(r.theme || '').includes('레시피');
            if (!ok) continue;
            const nk = (r.keyword || '').replace(/\s/g, '');
            if (seen.has(nk)) continue;
            seen.add(nk);
            out.push({ keyword: r.keyword, volume: r.volume ?? undefined, theme: r.theme ?? undefined, cafes: (r.cafes ?? []) as KwCafe[] });
        }
    }
    return out.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
}

// 지역 토큰 마스터의 '빠름' 축 — 시도·시군구·신도시·역세권. 동/읍면은 '더 찾기' 단계라 여기서 뺀다.
//   실측(2026-08-06) 네일 역세권 57%·신도시 43%, 입주청소 신도시 60% — 동(0~74%, 업종 의존)보다 안정적.
const FAST_KINDS = ['sido', 'sigungu', 'newtown', 'district', 'station', 'sigungu_suffix'];

async function masterTokens(sidos: string[]): Promise<{ rows: { sido: string; token: string }[]; covered: Set<string> }> {
    const rows: { sido: string; token: string }[] = [];
    const covered = new Set<string>();
    for (let off = 0; ; off += 1000) {
        const { data, error } = await supabase.from('cafe_region_token')
            .select('token,kind,sido').in('sido', sidos).eq('active', true)
            .order('prio', { ascending: true }).order('token', { ascending: true }).range(off, off + 999);
        if (error) return { rows: [], covered: new Set() };   // 테이블 미적재 등 → 기존 행정동 경로로
        const page = (data ?? []) as { token: string; kind: string; sido: string }[];
        for (const r of page) {
            if (r.sido) covered.add(r.sido);
            if (FAST_KINDS.includes(r.kind)) rows.push({ sido: r.sido, token: r.token });
        }
        if (page.length < 1000) break;
    }
    return { rows, covered };
}

// 선택 시도의 지역 토큰 목록. 지역형 '지역 키워드 생성'의 지역 축.
//   1순위=지역 토큰 마스터(역세권·신도시 포함), 마스터에 없는 시도만 행정동 테이블로 보완(누락 0).
export async function getRegionGuTokens(sidos: string[]): Promise<{ sido: string; token: string }[]> {
    if (!sidos.length) return [];
    const master = await masterTokens(sidos);
    const restSido = sidos.filter((s) => !master.covered.has(s));
    if (!restSido.length) return master.rows;
    // ★ PostgREST 는 limit 을 크게 줘도 1000행에서 자른다 → range() 페이지네이션 필수.
    //   실측(2026-08-05): 17개 시도 선택 시 483개 토큰 중 204개만 잡히고 '강남'이 빠졌다.
    const rows: { sido: string; gu: string }[] = [];
    for (let off = 0; ; off += 1000) {
        const { data, error } = await supabase.from('cafe_region_dong')
            .select('sido,gu').in('sido', restSido).order('gu', { ascending: true }).range(off, off + 999);
        if (error) break;
        const page = (data ?? []) as { sido: string; gu: string }[];
        rows.push(...page);
        if (page.length < 1000) break;
    }
    const seen = new Set<string>();
    const out: { sido: string; token: string }[] = [...master.rows];
    for (const r of master.rows) seen.add(`${r.sido}|${r.token}`);
    // ★ 시도명 자체도 토큰 — 보통 그 제품의 최대 검색량 키워드('서울 누수탐지' ≫ '강남 누수탐지').
    //   실측(2026-08-04): 광역시 8/8 인기탭, 道도 강원·충북·전남·경북·경남·제주 등 다수. 접미형(서울시·강원도)은 섹션없음이라 제외.
    for (const s of restSido) {
        const t = (s || '').trim();
        if (!t || seen.has(`${t}|${t}`)) continue;
        seen.add(`${t}|${t}`);
        out.push({ sido: t, token: t });
    }
    for (const r of rows) {
        for (const token of guTokens(r.gu)) {
            const key = `${r.sido}|${token}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ sido: r.sido, token });
        }
    }
    return out;
}

// 큐 등록. target=워커가 인기글 진입 키워드를 몇 개 찾을 때까지 스캔할지(찾으면 멈춤). regions 기본 수도권. status는 반드시 'queued'(워커가 집는 값).
export async function enqueuePlaceScan(placeUrl: string, target = 10, regions = '서울,경기,인천') {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    const { data, error } = await supabase.from('cafe_kw_requests')
        .insert({ place_url: placeUrl.trim(), target, regions, status: 'queued', requested_by: uid })
        .select('id').single();
    if (error || !data) return { id: null as number | null, error };
    return { id: (data as { id: number }).id, error: null };
}

// 지역 인기탭 조회 — 제품키워드(출장부페 등) × 선택 시도의 구/시를 워커가 검색량 게이트 후 인기탭 스캔.
//   place_url='region:<제품키워드>' 로 워커 process_region 라우팅. 결과·캐시는 place scan 과 동일(pollPlaceScan).
// 회차 정책 — 한 번에 30건 찾고 멈추고, 부족하면 ＋10 씩 이어서 본다.
//   ★ 전수 스캔은 오래 걸리고 CF 차단 예산(300콜/10분)을 태운다. 워커가 target 을 채우면 즉시 끝낸다.
//     실측 2026-08-07(경기간호 49개 키워드 × 경기 349토큰 = 17,091조합):
//       30건 채우는 데 실측 115콜 · 5분 29초. 전수였다면 17,091콜(≈10시간·예산 57배 초과).
//   ★ 두 화면이 같은 숫자를 쓰게 여기서만 정한다 — 예전엔 사무실 30 / 고객ERP 300 으로 갈려 있었다.
export const FIRST_TARGET = 30;
export const MORE_STEP = 10;

export async function enqueueRegionScan(productKw: string, regions: string, target = FIRST_TARGET, includeDong = false) {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    // deploy_type='지역-동' 이면 워커가 동(洞)까지('더 찾기'). 기본은 구/시만(빠름).
    const { data, error } = await supabase.from('cafe_kw_requests')
        .insert({ place_url: `region:${productKw.trim()}`, target, regions, status: 'queued', requested_by: uid, deploy_type: includeDong ? '지역-동' : '지역' })
        .select('id').single();
    if (error || !data) return { id: null as number | null, error };
    return { id: (data as { id: number }).id, error: null };
}

// 키워드형 — 붙여넣기(정보/메뉴)에서 추출된 키워드 리스트를 지역 없이(전국) 인기탭 판정. place_url='list:kw1|kw2…'.
export async function enqueueListScan(keywords: string[], target = 50) {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    const payload = keywords.map((k) => k.trim()).filter(Boolean).join('|');
    if (!payload) return { id: null as number | null, error: { message: '키워드 없음' } };
    const { data, error } = await supabase.from('cafe_kw_requests')
        .insert({ place_url: `list:${payload}`, target, regions: '', status: 'queued', requested_by: uid, deploy_type: '키워드' })
        .select('id').single();
    if (error || !data) return { id: null as number | null, error };
    return { id: (data as { id: number }).id, error: null };
}

// ── 연관 인기글 찾기 ────────────────────────────────────────────────────────
//   씨앗어 하나(보홀·하와이 등 자유 단어)에서 연관 키워드를 펼쳐 인기탭을 찾는다.
//   기존 3모드는 '한국 행정지역 × 제품'이 전제라 해외지명·취미어 같은 씨앗을 다루지 못했다.
export type RelatedCand = { kw: string; total: number; tier: 'seed' | 'near' | 'far'; intent: boolean };

// '의도어' — 이게 붙은 키워드에서 인기글 섹션이 나온다. 지명·상품명 단독은 거의 안 나온다.
//   실측(2026-08-07, 보홀 70조합 전수 판정 · 인기탭 35건):
//     검색량순 상위 40 규칙 → 정확도 60%(헛스캔 16)
//     의도어 규칙          → 정확도 78%(헛스캔 8)
//   ★ 상거래성 어미(비용·가격·항공권)는 넣으면 안 된다 — 네이버가 광고 영역으로 보내 섹션이 없다.
//     실측 2026-08-07: '요양' 씨앗의 자동체크 14개 중 11개가 '~비용'이었고 14/14 전부 섹션없음
//     (요양병원비용 12,530 · 실버타운비용 3,730 · 주간보호센터비용 2,750 모두 없음).
//     업종을 섞어 재확인: 비용 0/3(인테리어·이사·결혼식) · 가격 0/2(임플란트·보톡스) · 후기 0/2(라식·도수치료)
//     반면 추천 2/2 · 여행 2/2 · 숙소 2/2. → 비용·가격·경비·후기·항공권 제외.
const INTENT_WORDS = [
    '여행', '숙소', '호텔', '리조트', '펜션', '민박', '게스트하우스',
    '패키지', '투어', '호핑', '자유여행', '직항', '에어텔', '풀빌라', '휴양',
    '맛집', '가볼만', '코스', '일정', '추천', '준비물',
    '연습장', '아카데미', '레슨', '강습', '용품', '웨어',
];

// 씨앗어 → 연관 후보. 검색광고 연관어(최대 500)를 관련도 3단으로 나눈다.
//   ★ 문자열 규칙만으로는 못 가른다(실측 2026-08-06): '보홀'의 far 에는 팡라오·알로나비치·
//     두마게티 같은 실제 필리핀 지명(관련 O)과, '하와이'의 far 에는 디트로이트·볼티모어(무관)가
//     같이 들어온다. 그래서 자동 확정하지 않고 tier 만 붙여 사용자가 체크하게 한다.
export async function expandRelated(seed: string): Promise<RelatedCand[]> {
    const q = seed.trim();
    if (!q) return [];
    const r = await fetch(`/api/naver-keywords?q=${encodeURIComponent(q)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !Array.isArray((j as { keywords?: unknown }).keywords)) {
        throw new Error((j as { message?: string }).message || `연관어 조회 실패(${r.status})`);
    }
    const nq = q.replace(/\s/g, '');
    // near 판정용 조각 — 씨앗어를 포함한 키워드에서 씨앗을 뗀 나머지(여행·항공권·리조트…).
    const rows = ((j as { keywords: { keyword?: string; total?: number }[] }).keywords)
        .map((x) => ({ kw: String(x.keyword ?? '').trim(), total: Number(x.total ?? 0) }))
        .filter((x) => x.kw);
    // near 조각에서 '아무 데나 붙는 일반 수식어'를 뺀다.
    //   ★ 실측(2026-08-06): '골프'의 near 에 BMW인증중고차·중고자동차·미니쿠퍼가 올라왔다.
    //     원인은 '중고골프채' → 조각 '중고' → '중고'가 든 자동차 키워드가 전부 near 로 승격된 것.
    //     이런 조각은 주제를 전혀 좁히지 못하므로 near 판정에 쓰면 안 된다.
    const GENERIC_FRAG = new Set([
        '중고', '신품', '새제품', '할인', '특가', '최저', '최저가', '가격', '비용', '요금',
        '후기', '추천', '순위', '비교', '정보', '인기', '최신', '브랜드', '판매', '구매',
        '렌탈', '대여', '사이트', '쇼핑', '직구', '무료', '이벤트', '종류',
    ]);
    const frags = new Set<string>();
    for (const { kw } of rows) {
        const n = kw.replace(/\s/g, '');
        if (!n.includes(nq)) continue;
        const rest = n.split(nq).join(' ').trim();
        for (const w of rest.split(/\s+/)) if (w.length >= 2 && !GENERIC_FRAG.has(w)) frags.add(w);
    }
    const out: RelatedCand[] = rows.map(({ kw, total }) => {
        const n = kw.replace(/\s/g, '');
        const tier: RelatedCand['tier'] = n.includes(nq) ? 'seed'
            : ([...frags].some((f) => n.includes(f)) ? 'near' : 'far');
        return { intent: INTENT_WORDS.some((w) => n.includes(w)), kw, tier, total };
    });
    // 의도어가 붙은 것을 먼저 — 실측상 인기글 섹션이 여기서 나온다. 그 안에서 검색량 순.
    const order = { seed: 0, near: 1, far: 2 };
    return out.sort((a, b) => (Number(b.intent) - Number(a.intent))
        || (order[a.tier] - order[b.tier]) || (b.total - a.total));
}

// 연관 인기글 스캔 — 씨앗어 후보들을 ① 지역 없이(전국) 판정하고 ② 안 되는 건 지역 몇 곳을 찔러
//   '지역형 업종'인지까지 알아낸다. 결과는 result 배열 하나에 kind='national'|'regional' 로 섞여 온다.
//   place_url='related:{JSON}' → 워커 process_related.
export async function enqueueRelatedScan(seed: string, keywords: string[], probe = 8) {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    const kws = keywords.map((k) => k.trim()).filter(Boolean);
    if (!kws.length) return { id: null as number | null, error: { message: '키워드 없음' } };
    const payload = JSON.stringify({ kws, probe, seed: seed.trim() });
    const { data, error } = await supabase.from('cafe_kw_requests')
        .insert({
            deploy_type: '키워드', place_url: `related:${payload}`, regions: '',
            requested_by: uid, status: 'queued', target: kws.length,
        })
        .select('id').single();
    if (error || !data) return { id: null as number | null, error };
    return { id: (data as { id: number }).id, error: null };
}

// 리뷰 수집 — 플레이스 주소만 주면 워커가 m.place 리뷰를 긁어 텍스트로 돌려준다.
//   메뉴판이 없는 업종(약국·학원·병의원)은 플레이스에서 제품 키워드가 안 나오는데 리뷰엔 있다.
//   추출(GPT)은 기존 extractMenuKeywords 로 이어서 한다 — 여기선 원문만 가져온다.
export type PlaceReviewBundle = {
    name: string; addr: string; cats: string[]; placeKws: string[];
    menu: string[]; reviewMenus: string[]; text: string; chars: number;
};

export async function fetchPlaceReviews(placeUrl: string, onProgress?: (n: string) => void): Promise<PlaceReviewBundle> {
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('cafe_kw_requests')
        .insert({
            deploy_type: '키워드', place_url: `reviews:${placeUrl.trim()}`, regions: '',
            requested_by: u.user?.id ?? null, status: 'queued', target: 1,
        })
        .select('id').single();
    if (error || !data) throw new Error(error?.message || '리뷰 수집 등록 실패');
    const { result } = await pollPlaceScan((data as { id: number }).id, { onProgress, timeoutSec: 240 });
    const r = (result?.[0] ?? {}) as Record<string, unknown>;
    return {
        addr: String(r.addr ?? ''),
        cats: (r.cats as string[]) ?? [],
        chars: Number(r.chars ?? 0),
        menu: (r.menu as string[]) ?? [],
        name: String(r.keyword ?? ''),
        placeKws: (r.place_kws as string[]) ?? [],
        reviewMenus: (r.review_menus as string[]) ?? [],
        text: String(r.text ?? ''),
    };
}

// ── 캐시 우선 조회 ──────────────────────────────────────────────────────────
//   왜: 지금은 씨앗어를 받으면 연관어 200~237개를 전부 새로 긁는다(10분·CF 200콜).
//     그런데 이미 판정된 인기탭이 1,000건 넘게 쌓여 있어, 상당수는 스캔 없이 즉답할 수 있다.
//     실측(2026-08-07) '방문요양' 하나로 캐시에서 53건이 바로 나왔다(간병인업체 6,420 · 서울 간병인 200 …).
//     데몬이 계속 채우므로 시간이 갈수록 이 경로의 적중이 커진다.
//   ⚠️ 인기글 '제목'으로 뒤지는 방법은 쓰지 않는다 — 실측 7건이 전부 오탐이었다
//     ('성북 소방점검' 섹션에 성신노인요양원 소방훈련 글이 우연히 있는 식). 키워드로만 찾는다.
export type CachedHit = { keyword: string; volume: number | null; theme: string | null; cafes: KwCafe[]; via: string };

// 연관어에서 '핵심 어간'만 뽑는다 — 캐시는 부분일치로 뒤지므로 검색어가 짧아야 걸린다.
//   실측(2026-08-07): '간병인보험'으로는 '수원 간병인'을 못 찾는다. 접미(보험·자격증·비용…)를
//   떼고 접두(방문·재가·노인·장기…)도 떼어 2~4자 코어로 만들면 '방문요양' → 요양·간병인·요양원·간병·돌봄
//   → 캐시 49건이 바로 나온다. GPT 없이 기계적으로 된다.
const _STEM_SUFFIX = ['보험', '자격증', '시험', '비용', '가격', '등급', '신청', '기준', '혜택',
    '추천', '순위', '방법', '조건', '종류', '후기', '센터', '기관', '서비스', '업체', '전문', '교육', '과정'];
const _STEM_PREFIX = /^(방문|재가|노인|장기|긴급|주야간|셀프|무인)/;

export function relatedStems(seed: string, related: { kw: string }[], n = 8): string[] {
    const freq = new Map<string, number>();
    for (const { kw } of related) {
        let s = kw.replace(/\s/g, '');
        for (const suf of _STEM_SUFFIX) {
            if (s.endsWith(suf) && s.length - suf.length >= 2) { s = s.slice(0, -suf.length); break; }
        }
        s = s.replace(_STEM_PREFIX, '');
        if (s.length >= 2 && s.length <= 4 && /^[가-힣]+$/.test(s)) freq.set(s, (freq.get(s) ?? 0) + 1);
    }
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
    return [seed.trim(), ...top];
}

export async function searchCachedPopular(terms: string[], limit = 200): Promise<CachedHit[]> {
    const words = [...new Set(terms.map((t) => t.trim().replace(/\s+/g, '')).filter((t) => t.length >= 2))];
    if (!words.length) return [];
    const out = new Map<string, CachedHit>();
    // 용어별로 부분일치 조회. PostgREST or() 로 한 번에 묶으면 URL 이 길어져 잘리므로 나눠 부른다.
    for (const w of words.slice(0, 12)) {
        const { data } = await supabase.from('cafe_kw_targets')
            .select('keyword,has_section,theme,verdict,volume,cafes')
            .like('keyword', `%${w}%`)
            .eq('has_section', true)
            .limit(limit);
        for (const r of (data ?? []) as { keyword: string; verdict: string | null; theme: string | null; volume: number | null; cafes: unknown }[]) {
            // 워커의 _is_pop 과 같은 규약 — 카페분산·블로그섹션만 채택, 레시피 테마 제외.
            const v = r.verdict ?? '';
            if (!(v.startsWith('카페분산') || v.startsWith('블로그섹션'))) continue;
            if ((r.theme ?? '').includes('레시피')) continue;
            const key = r.keyword.replace(/\s/g, '');
            if (out.has(key)) continue;
            // via = 이 결과를 찾아낸 어간. 씨앗어와 다를 수 있으므로 화면에 반드시 보여야 한다
            //   (실측: '방문요양' 조회 49건이 전부 '간병인' 계열이었다 — 방문요양 자체는 0건).
            out.set(key, { cafes: (r.cafes ?? []) as KwCafe[], keyword: r.keyword, theme: r.theme, via: w, volume: r.volume });
        }
    }
    return [...out.values()].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
}

export type SiteBundle = { source: string; title: string; text: string; chars: number; pages: string[]; posts?: number };

// 홈페이지·네이버 블로그 주소 → 키워드 추출용 원문. 붙여넣기를 대신하는 입력 경로다.
//   ★ 네이버 블로그를 먼저 권해야 한다(실측 2026-08-07 경기간호):
//     blog.naver.com/gyeonggi22 → 글 51개 제목이 "수원 의왕 뇌졸중 방문재활" 처럼
//     이미 '지역 × 제품키워드' 꼴이라 우리 스캔 축과 모양이 같다.
//     같은 업체 홈페이지(gyeongginurse.co.kr)는 2,041자였지만 대부분 메뉴·인사말이었다.
//   추출은 이어서 extractMenuKeywords 가 한다 — 여기선 원문만 가져온다.
export async function fetchSiteText(url: string): Promise<SiteBundle> {
    const r = await fetch('/api/fetch-site', {
        body: JSON.stringify({ url }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as { message?: string }).message || `주소를 읽지 못했습니다(${r.status})`);
    return j as SiteBundle;
}

export type ExtractedProduct = { kw: string; kind: string };

// 업체 정보 붙여넣기 → 제품·서비스 키워드 추출(GPT). 플레이스가 없는 업체용.
//   ★ 결과를 그대로 확정하지 않는다 — 호출부가 체크박스로 보여주고 고객이 고른 것만 스캔한다.
// keepPlace=true 면 지역명을 지우지 않는다 — 지명이 상품인 업종(보홀 다이빙투어 등).
//   실측 2026-08-10: 지명을 빼면 '스쿠버다이빙 10,130'(전국 경쟁·인기탭 0건)만 남고,
//   살리면 '보홀 호핑투어 7,600 · 보홀 스쿠버다이빙 990'이 나온다.
export async function extractMenuKeywords(text: string, hint = '', keepPlace = false): Promise<{ products: ExtractedProduct[]; biz: string }> {
    const r = await fetch('/api/extract-menu', {
        body: JSON.stringify({ text, hint, keepPlace }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as { message?: string }).message || `키워드 추출 실패(${r.status})`);
    return { biz: (j as { biz?: string }).biz ?? '', products: ((j as { products?: ExtractedProduct[] }).products ?? []) };
}

// 정보입력형 — 위치 직접입력 × 확정된 제품키워드로 인기탭 스캔. place_url='menu:{JSON}' → 워커 process_menu.
//   regions(시도)를 주면 자기 지역을 먼저 채운 뒤 그 시도 전체로 확장한다(target 도달 시 조기 종료).
export async function enqueueMenuScan(
    addr: string, products: string[], opts?: { name?: string; regions?: string; target?: number; includeDong?: boolean },
) {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    const list = products.map((k) => k.trim()).filter(Boolean);
    if (!list.length) return { id: null as number | null, error: { message: '제품키워드를 1개 이상 선택하세요' } };
    if (!addr.trim() && !opts?.regions) return { id: null as number | null, error: { message: '위치를 입력하세요' } };
    const payload = JSON.stringify({ addr: addr.trim(), name: opts?.name ?? '', products: list });
    const { data, error } = await supabase.from('cafe_kw_requests')
        .insert({
            deploy_type: opts?.includeDong ? '지역-동' : '지역',   // ⚠️ '키워드'로 두면 워커가 지역축을 지운다
            place_url: `menu:${payload}`,
            regions: opts?.regions ?? '',
            requested_by: uid,
            status: 'queued',
            target: opts?.target ?? FIRST_TARGET,
        })
        .select('id').single();
    if (error || !data) return { id: null as number | null, error };
    return { id: (data as { id: number }).id, error: null };
}

// ── 진행 중인 스캔 기억하기 ──────────────────────────────────────────────────
//   ★ 왜: 스캔이 회차당 최대 330조합(약 14분)이라 화면을 켜 두고 기다려야 했다. 새로고침하거나
//     다른 탭으로 가면 요청 id 를 잃어버려, 워커가 다 찾아 놓은 결과를 화면이 못 주워온다.
//     실측 2026-08-10: #175 가 21건을 찾고 정상 완료됐는데 사장님은 못 보고 3번 다시 눌렀다
//     (#176·#177·#178 이 같은 걸 또 돌았다).
//   그래서 요청 id 를 localStorage 에 남기고, 돌아오면 그 id 에 다시 붙는다.
const PENDING_KEY = 'ddmkt.cafeScan.pending';
export type PendingScan = { id: number; kind: string; label: string; at: number };

export function savePendingScan(id: number, kind: string, label: string): void {
    try {
        localStorage.setItem(PENDING_KEY, JSON.stringify({ at: Date.now(), id, kind, label }));
    } catch { /* 사파리 프라이빗 등 — 저장 못 해도 스캔 자체는 돌아간다 */ }
}

export function loadPendingScan(): PendingScan | null {
    try {
        const raw = localStorage.getItem(PENDING_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw) as PendingScan;
        // 하루 지난 건 버린다 — 그 사이 워커가 죽었거나 사장님이 잊은 것이다.
        if (!p?.id || Date.now() - (p.at || 0) > 24 * 3600 * 1000) { localStorage.removeItem(PENDING_KEY); return null; }
        return p;
    } catch {
        return null;
    }
}

export function clearPendingScan(): void {
    try {
        localStorage.removeItem(PENDING_KEY);
    } catch { /* 무시 */ }
}

// 저장해 둔 요청의 현재 상태 — 새로고침 후 '이어보기'용. 폴링 없이 한 번만 읽는다.
export async function peekScan(id: number): Promise<{ status: string; note: string; result: KwResult[] } | null> {
    const { data } = await supabase.from('cafe_kw_requests').select('status,result,note').eq('id', id).single();
    if (!data) return null;
    const row = data as { status: string; result: KwResult[] | null; note: string | null };
    return { note: row.note || '', result: row.result || [], status: row.status };
}

// 폴링 — done 까지. result 반환. onProgress(note) 로 워커 진행상태(note "진행 x/total · 인기탭 n") 전달.
export async function pollPlaceScan(
    id: number, opts?: { signal?: AbortSignal; timeoutSec?: number; onProgress?: (note: string, status: string) => void },
): Promise<{ result: KwResult[]; bizName: string | null }> {
    const timeoutMs = (opts?.timeoutSec ?? 180) * 1000;
    const t0 = Date.now();
    let lastNote = '';
    while (Date.now() - t0 < timeoutMs) {
        if (opts?.signal?.aborted) throw new Error('취소됨');
        await new Promise((r) => setTimeout(r, 3000));
        const { data } = await supabase.from('cafe_kw_requests').select('status,result,biz_name,note').eq('id', id).single();
        const row = data as { status: string; result: KwResult[] | null; biz_name: string | null; note: string | null } | null;
        if (row) {
            if (row.note) lastNote = row.note;
            if (opts?.onProgress && row.note) opts.onProgress(row.note, row.status);
            // 워커는 실패 시 status='failed' 를 쓴다('fail' 아님 — 예전엔 안 잡혀 900초 타임아웃까지 매달렸다).
            //   실패 사유(note)를 그대로 노출한다 — 차단으로 못 판정한 걸 '0건'처럼 보이게 하면 안 된다.
            if (['done', 'failed', 'fail', 'error'].includes(row.status)) {
                if (row.status !== 'done') throw new Error(row.note || '인기탭 분석 실패');
                return { result: row.result || [], bizName: row.biz_name };
            }
        }
    }
    // ★ 타임아웃 = 실패가 아니다. 워커는 계속 돈다 — '다시 시도'라고 하면 처음부터 재스캔하게 만든다.
    //   실측 2026-08-10(#175 장한평 정보형): 330조합 × 2.5초 ≈ 14분이라 900초 폴링을 넘겼는데
    //   그때 워커는 257/330 · 인기탭 20건으로 정상 진행 중이었다. 결과는 완료 시점에만 기록되므로
    //   화면엔 아무것도 안 남는다. 그래서 진행상황을 그대로 붙여 '기다렸다 다시 조회'로 안내한다.
    //   (재조회는 캐시 히트라 스캔 없이 즉시 끝난다.)
    throw new Error(
        `아직 분석 중입니다${lastNote ? ` — ${lastNote}` : ''}. `
        + '워커는 계속 돌고 있으니 잠시 후 같은 조건으로 다시 조회하세요(이미 본 건 캐시라 즉시 나옵니다).',
    );
}
