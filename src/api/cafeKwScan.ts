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
//   endsSeed = 씨앗어로 '끝나는' 후보(소자본창업·카페창업). 씨앗이 뒤에 오는 형태가 곧 '업종+행위'라
//   발행 키워드로 바로 쓸 수 있다. 앞에 오는 형태(창업박람회·창업대출)는 정보성이라 결이 다르다.
export type RelatedCand = { kw: string; total: number; tier: 'seed' | 'near' | 'far'; intent: boolean; endsSeed: boolean; seedOf: string };

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
    // ★ 씨앗을 쉼표로 여러 개 받는다(2026-08-11). 네이버가 씨앗 하나당 돌려주는 연관어는 약 1,000개가
    //   끝이라, 그 목록에 없는 업종은 아예 안 나온다("전부 다 못 찾는 느낌"의 실제 원인).
    //   '창업, 프랜차이즈, 가맹' 처럼 넣으면 각각 받아 합친다 — 커버리지가 배로 늘어난다.
    const seeds = [...new Set(seed.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
    if (!seeds.length) return [];
    const q = seeds[0];
    const rowMap = new Map<string, { kw: string; total: number }>();
    let lastErr = '';
    for (const s of seeds) {
        const r = await fetch(`/api/naver-keywords?q=${encodeURIComponent(s)}`);
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray((j as { keywords?: unknown }).keywords)) {
            lastErr = (j as { message?: string }).message || `연관어 조회 실패(${r.status})`;
            continue;   // 이 씨앗만 실패 — 나머지는 계속
        }
        for (const x of (j as { keywords: { keyword?: string; total?: number }[] }).keywords) {
            const kw = String(x.keyword ?? '').trim();
            if (!kw) continue;
            const k = kw.replace(/\s/g, '');
            const prev = rowMap.get(k);
            const total = Number(x.total ?? 0);
            if (!prev || total > prev.total) rowMap.set(k, { kw, total });
        }
    }
    if (!rowMap.size) throw new Error(lastErr || '연관어를 찾지 못했습니다.');
    const nq = q.replace(/\s/g, '');
    // near 판정용 조각 — 씨앗어를 포함한 키워드에서 씨앗을 뗀 나머지(여행·항공권·리조트…).
    const rows = [...rowMap.values()];
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
    // ★ 의도가 반대인 계열은 뺀다 — '창업'을 넣었는데 취업비용·취업박람회가 올라온다(사장님 2026-08-11).
    //   네이버 연관어는 창업과 취업을 같은 묶음으로 준다. 게다가 '창업박람회'에서 뽑힌 조각 '박람회'
    //   때문에 '취업박람회'가 near 로 승격까지 된다 — 조각 규칙만으로는 절대 못 거른다.
    //   워커의 _offtopic_career 가 인기글 '제목'에 대해 하는 일을, 여기선 '후보' 단계에서 미리 한다.
    //   ⚠️ 씨앗어 자체에 그 말이 있으면(예: 씨앗 '취업') 거르지 않는다 — 그때는 그게 주제다.
    const OFFTOPIC_FRAG = ['취업', '구직', '구인', '채용', '이직', '연봉', '알바', '아르바이트',
        '인턴', '공무원', '자격증', '기능사', '산업기사', '필기', '실기', '국가고시', '비전공'];
    // ★ 정보·거래성 꼬리 — 인기글 섹션이 거의 안 나오고, 나와도 고객이 아니라 정보 찾는 사람이다.
    //   실측(2026-08-07): 비용 0/3(인테리어·이사·결혼식) · 가격 0/2(임플란트·보톡스) · 후기 0/2(라식·도수치료).
    //   사장님이 지목한 박람회·대출·지원금 계열도 같이 뺀다 — '창업대출'을 검색하는 사람은
    //   정부지원금을 찾는 사람이지 가맹 상담을 원하는 사람이 아니다(2026-08-11).
    //   실측: 씨앗 '창업' 401개 중 86개가 여기 걸린다(창업박람회 4,120 · 창업대출 3,810 · 창업지원금 2,420 …).
    //   ⚠️ 교차 QA(2026-08-11, 32업종 연관어 + 캐시 19,305행 + 라이브 판정 57건)로 단어별 검증했다.
    //     기저 양성률 9.0% 대비:
    //       비용 186건 중 1건(0.5%)  ← 가장 잘 듣는 필터. 유지.
    //       지원 36 · 대출 26 · 후기 17 · 정보 9 · 지원금 8 · 자금 7 · 순위 6 → 전부 양성 0건. 유지.
    //     빼야 했던 것:
    //       경비 10건 중 1건(10%) = 판별력 0. 이 코퍼스의 '경비'는 전부 경비원·경비업체(경호 업종어)라
    //         '비용' 의미가 0건이었고, 경호업체 씨앗의 후보 23%를 통째로 잘랐다('경비업체' 양성 확인).
    //       가격 16건 중 1건(6.3%) = 기저와 차이 없음. 근거였던 '0/2(임플란트·보톡스)'는 표본 2건이었고,
    //         우리 출장뷔페 계열의 '커피차가격'(5,790·양성)을 죽였다.
    //       박람회 14건 중 6건(42.9%) = 기저의 4.8배. 잡음이 아니라 '양성 예측어'였다.
    //         창업박람회 4,120 · 입주박람회 1,450(인테리어) · 웨딩박람회 · 경비업체 계열을 죽이고 있었다.
    //         사장님 원래 불만이던 '취업박람회'는 OFFTOPIC 의 '취업'이 이미 잡으므로 빼도 안 나온다.
    //         창업박람회처럼 업종상 원치 않는 건 화면에서 X 로 개별 제외한다(사장님 결정 2026-08-11).
    const NOISE_TAIL = ['비용', '요금', '후기', '대출', '지원금',
        '자금', '지원', '정보', '순위', '통계', '현황', '뉴스'];
    const drop = [...OFFTOPIC_FRAG, ...NOISE_TAIL].filter((w) => !nq.includes(w));
    // ★ 씨앗의 '코어' — 수식 접두/접미를 떼어 축약형까지 씨앗층으로 본다.
    //   실측(교차 QA 2026-08-11): 문자열을 그대로 포함하는 것만 씨앗층으로 보면 양성의 22%가 사라졌다.
    //   방문요양 16/16(100%) · 사설경호 3/3(100%) · 누수탐지 12/18(67%) 손실.
    //   서비스업은 양성이 축약형으로 나온다 — '누수탐지'→'파주 누수', '입주청소'→'강남 청소업체',
    //   '사설경호'→'서울 경호업체'. '창업'에선 이 문제가 0%라 씨앗 하나만 보면 안 보인다.
    const SEED_PREFIX = /^(방문|재가|노인|장기|긴급|주야간|셀프|무인|사설|입주|이사|출장|종합|전문)/;
    const SEED_SUFFIX = ['탐지', '업체', '전문', '서비스', '시공', '공사', '센터'];
    // ★ 표기 쌍둥이 — 네이버에선 '프렌차이즈'(ㅔ)와 '프랜차이즈'(ㅐ)가 완전히 다른 키워드다.
    //   실측 2026-08-11: 프랜차이즈 연관어 996개·검색량 10,680 vs 프렌차이즈 133개·90.
    //   사장님이 오타 표기로 넣으시면 후보가 1/7 로 줄어든다(그래서 '고기집프렌차이즈'만 잡혔다).
    //   글자 수가 같고 한 글자만 다르며 검색량이 5배 이상인 쌍둥이가 연관어에 있으면 코어로 같이 쓴다.
    const twinOf = (s: string): string[] => {
        const n = s.replace(/\s/g, '');
        if (n.length < 3) return [];
        const mine = rowMap.get(n)?.total ?? 0;
        const out: string[] = [];
        for (const k of rowMap.keys()) {
            if (k.length !== n.length || k === n) continue;
            let diff = 0;
            for (let i = 0; i < k.length && diff < 2; i++) if (k[i] !== n[i]) diff += 1;
            if (diff === 1 && (rowMap.get(k)?.total ?? 0) >= Math.max(mine * 5, 500)) out.push(k);
        }
        return out;
    };
    const cores = [...new Set(seeds.flatMap((s) => twinOf(s)).concat(seeds.flatMap((s) => {
        const n0 = s.replace(/\s/g, '');
        let c = n0.replace(SEED_PREFIX, '');
        for (const suf of SEED_SUFFIX) {
            if (c.endsWith(suf) && c.length - suf.length >= 2) { c = c.slice(0, -suf.length); break; }
        }
        return c.length >= 2 ? [n0, c] : [n0];
    })))];
    const out: RelatedCand[] = rows
        .filter(({ kw }) => {
            const n = kw.replace(/\s/g, '');
            return !drop.some((w) => n.includes(w));
        })
        .map(({ kw, total }) => {
            const n = kw.replace(/\s/g, '');
            const tier: RelatedCand['tier'] = cores.some((c) => n.includes(c)) ? 'seed'
                : ([...frags].some((f) => n.includes(f)) ? 'near' : 'far');
            // 씨앗(또는 코어)으로 끝나면 '업종+행위' 형태. '~업체'는 예외로 살린다 —
            //   교차 QA 실측: 간병인업체 6,420 · 누수탐지업체 · 입주청소업체가 전부 양성인데
            //   '끝나는 것만'에 걸려 사라졌다. 하필 그 업종의 최고검색량이다.
            const endsSeed = cores.some((c) => n.endsWith(c) || n.endsWith(`${c}업체`));
            // 어느 씨앗 계열인지 — 씨앗을 여러 개 넣으면 첫 씨앗이 목록을 뒤덮는다(실측 2026-08-11:
            //   창업+가맹+사업+프렌차이즈 338개 중 창업이 263개=78%). 화면에서 계열별로 골라 보려고 붙인다.
            //   여러 코어에 걸리면 가장 구체적인(긴) 것으로 귀속한다.
            const matched = cores.filter((c) => n.includes(c)).sort((a2, b2) => b2.length - a2.length);
            return { endsSeed, intent: INTENT_WORDS.some((w) => n.includes(w)), kw, seedOf: matched[0] || '', tier, total };
        });
    // 의도어가 붙은 것을 먼저 — 실측상 인기글 섹션이 여기서 나온다. 그 안에서 검색량 순.
    const order = { seed: 0, near: 1, far: 2 };
    return out.sort((a, b) => (Number(b.intent) - Number(a.intent))
        || (order[a.tier] - order[b.tier]) || (b.total - a.total));
}

// 연관 인기글 스캔 — 씨앗어 후보들을 ① 지역 없이(전국) 판정하고 ② 안 되는 건 지역 몇 곳을 찔러
//   '지역형 업종'인지까지 알아낸다. 결과는 result 배열 하나에 kind='national'|'regional' 로 섞여 온다.
//   place_url='related:{JSON}' → 워커 process_related.
// 목표 채우기 — 키워드를 하나씩 끝까지 파고, 목표 건수를 채우면 즉시 멈춘다(워커 process_chain).
//   ★ 사장님 설계(2026-08-11): "첫 키워드에서 30개를 찾으면 오히려 좋다."
//     기존 경로와 두 군데가 다르다.
//       ① 제품 우선 — 한 키워드의 전 지역을 다 보고 다음 키워드로. (기존은 지역 우선이라 제품이 섞인다)
//       ② 각 키워드의 '단독(지역 없음)' 판정을 맨 앞에 넣는다 — 지역 없이도 인기탭이면 그것부터 챙긴다.
//         기존 연관형은 '전국에서 되면 지역은 안 붙인다'라 둘 다 되는 경우를 못 봤다.
//   한 회차 상한(120콜)은 그대로다. 못 채우면 note 에 남은 조합이 명시되고 다시 눌러 이어 본다.
export async function enqueueChainScan(products: string[], regions: string, target = FIRST_TARGET) {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    const list = [...new Set(products.map((k) => k.trim()).filter(Boolean))];
    if (!list.length) return { id: null as number | null, error: { message: '키워드 없음' } };
    const payload = JSON.stringify({ products: list, regions });
    const { data, error } = await supabase.from('cafe_kw_requests')
        .insert({
            deploy_type: '지역', place_url: `chain:${payload}`, regions,
            requested_by: uid, status: 'queued', target,
        })
        .select('id').single();
    if (error || !data) return { id: null as number | null, error };
    return { id: (data as { id: number }).id, error: null };
}

// ── 세부 분야 자동 추출 ──────────────────────────────────────────────────────
//   ★ 왜(사장님 요청 2026-08-11): 계열(창업)만으로는 454개라 너무 광범위하다.
//     '음식점 창업 / 노래방 창업' 처럼 한 단계 더 좁히고 싶다.
//   ★ 사전을 미리 짜면 틀린다 — 업종마다 세부가 다르고, 내가 짜면 그 순간 추측이다.
//     그래서 실제 후보에서 뽑는다: 계열어를 뗀 나머지에서 2~5자 조각을 세고,
//     3개 이상 키워드에 공통으로 나오는 것만 남긴다.
//   ★ 깨진 조각 배제가 핵심이다(실측): 그냥 세면 '차이즈'(35)·'래방'(12)·'페비용'(8)이 올라온다.
//     조건 = 그 조각이 '그 자체로 실제 키워드'이거나 '조각+계열'이 실제 키워드일 것.
//       카페 → 카페창업 ✓   무인 → 무인창업 ✓   차이즈 → 차이즈창업 ✗
//     이 규칙을 넣으니 132개(잡음 포함) → 58개(전부 말이 되는 단위)로 정리됐다.
export type SubCat = { label: string; count: number };

export function subCategories(keywords: string[], core: string, pool: Set<string>, max = 40): SubCat[] {
    const c = core.replace(/\s/g, '');
    const cnt = new Map<string, number>();
    for (const kw of keywords) {
        const rem = kw.replace(/\s/g, '').split(c).join('');
        if (rem.length < 2) continue;
        const seen = new Set<string>();
        for (let L = 2; L <= Math.min(5, rem.length); L++) {
            for (let i = 0; i + L <= rem.length; i++) {
                const f = rem.slice(i, i + L);
                if (seen.has(f)) continue;
                seen.add(f);
                cnt.set(f, (cnt.get(f) ?? 0) + 1);
            }
        }
    }
    const ok = [...cnt.entries()]
        .filter(([f, n]) => n >= 3 && (pool.has(f) || pool.has(f + c) || pool.has(c + f)))
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
    // 같은 개수면 긴 쪽만 남긴다 — '무점포'와 '점포'가 같은 7개면 '무점포'가 더 정확하다.
    const out: SubCat[] = [];
    for (const [f, n] of ok) {
        if (out.some((p) => p.label.includes(f) && p.count === n)) continue;
        out.push({ count: n, label: f });
        if (out.length >= max) break;
    }
    return out;
}

// ── 자사·고객사 상호 필터 ────────────────────────────────────────────────────
//   ★ 왜(SUB4 발견 2026-08-11): 캐시 양성에 '경기 더반클린'·'안양더반클린' 이 있었다.
//     더반클린은 우리 입주청소 고객사 상호다. 상호 키워드는 팔 대상이 아니다 —
//     그 업체는 이미 자기 이름을 갖고 있고, 다른 업체에겐 남의 브랜드다.
//   워커가 아니라 화면에서 거른다: 워커에 상호 목록을 넣으면 고객이 늘 때마다
//   워커를 재기동해야 한다(오늘만 6번 재기동했다). 화면은 조회 시점에 최신을 읽는다.
let _brandCache: string[] | null = null;

export async function getClientBrands(): Promise<string[]> {
    if (_brandCache) return _brandCache;
    const out = new Set<string>();
    try {
        const { data } = await supabase.from('cafe_studio_settings').select('brand').limit(1000);
        for (const r of (data ?? []) as { brand: string | null }[]) {
            const b = (r.brand || '').replace(/\s/g, '');
            // 2자 미만은 흔한 낱말과 겹쳐 오폭한다. '대행사'처럼 일반명사인 것도 뺀다.
            if (b.length >= 3 && !['대행사', '테스트'].includes(b)) out.add(b);
        }
    } catch { /* 조회 실패해도 필터만 안 걸릴 뿐 */ }
    _brandCache = [...out];
    return _brandCache;
}

// 키워드에 고객사 상호가 들어 있나(공백 무시).
export function hasClientBrand(keyword: string, brands: string[]): boolean {
    const n = (keyword || '').replace(/\s/g, '');
    return brands.some((b) => n.includes(b));
}

// 발행 전 재확인 — 담아둔 키워드를 팔기 직전에 라이브로 다시 판정한다(워커 process_recheck).
//   ★ 왜(SUB4 실측 2026-08-11): 5~6일 지난 양성 30건을 재판정하니 3건(10%)이 죽어 있었다.
//     전부 '섹션없음'으로, 판정 규칙 문제가 아니라 네이버가 그 키워드에 인기글 섹션을
//     더 이상 안 주는 경우였다. 30건이면 30콜(데몬 3분치)이라 팔기 직전에 보는 게 가장 싸다.
//   result 에는 '살아있는 것'만 온다 — 죽은 건 호출부가 차집합으로 안다.
export async function enqueueRecheckScan(keywords: string[]) {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    const kws = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 200);
    if (!kws.length) return { id: null as number | null, error: { message: '확인할 키워드 없음' } };
    const { data, error } = await supabase.from('cafe_kw_requests')
        .insert({
            deploy_type: '재확인', place_url: `recheck:${JSON.stringify({ kws })}`, regions: '',
            requested_by: uid, status: 'queued', target: kws.length,
        })
        .select('id').single();
    if (error || !data) return { id: null as number | null, error };
    return { id: (data as { id: number }).id, error: null };
}

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

// ── 이미 검증된 제품키워드 ───────────────────────────────────────────────────
//   ★ 왜: 씨앗 하나로 닿는 범위가 좁다. 실측(2026-08-11) 캐시에 '지역형으로 판명이 끝난' 제품이
//     112종 쌓여 있는데 씨앗 '창업' 하나로 닿는 건 19종뿐이었다. 나머지는 있는 줄도 모르고 지나간다.
//     ('한식'은 40개 지역에서 이미 양성인데 사장님이 손으로 넣어 찾으셨다.)
//   판정이 끝난 것만 세므로 스캔 0콜이다. 고르면 그 제품의 지역 조합을 캐시에서 바로 꺼낸다.
export type ProvenProduct = { product: string; regions: number; volume: number };

let _provenCache: ProvenProduct[] | null = null;

export async function getProvenProducts(): Promise<ProvenProduct[]> {
    if (_provenCache) return _provenCache;
    // ① 지역 토큰 — 키워드 앞머리가 지역인지 보려고. PostgREST 1000행 상한이라 페이지네이션.
    const toks = new Set<string>();
    for (let off = 0; ; off += 1000) {
        const { data, error } = await supabase.from('cafe_region_token')
            .select('token').eq('active', true).range(off, off + 999);
        if (error) break;
        const page = (data ?? []) as { token: string }[];
        page.forEach((t) => t.token && toks.add(t.token));
        if (page.length < 1000) break;
    }
    // ② 양성 판정만 — verdict 조건을 DB 로 내려야 상한 1000칸을 오탐으로 안 채운다.
    const agg = new Map<string, { regions: number; volume: number }>();
    for (let off = 0; ; off += 1000) {
        const { data, error } = await supabase.from('cafe_kw_targets')
            .select('keyword,volume').eq('has_section', true)
            .or('verdict.like.카페분산*,verdict.like.블로그섹션*')
            .range(off, off + 999);
        if (error) break;
        const page = (data ?? []) as { keyword: string; volume: number | null }[];
        for (const r of page) {
            const parts = (r.keyword || '').trim().split(/\s+/);
            if (parts.length < 2 || !toks.has(parts[0])) continue;   // 지역이 안 붙은 건 지역형 근거가 아니다
            const prod = parts.slice(1).join(' ');
            const cur = agg.get(prod) || { regions: 0, volume: 0 };
            cur.regions += 1;
            cur.volume = Math.max(cur.volume, r.volume ?? 0);
            agg.set(prod, cur);
        }
        if (page.length < 1000) break;
    }
    _provenCache = [...agg.entries()]
        .map(([product, v]) => ({ product, regions: v.regions, volume: v.volume }))
        .sort((a, b) => b.regions - a.regions);
    return _provenCache;
}

// ── 씨앗 발굴기 ──────────────────────────────────────────────────────────────
//   ★ 왜: 씨앗 하나로 닿는 범위가 좁다. 실측(2026-08-11) 씨앗 '창업' 연관어 993개인데,
//     씨앗을 8개로 늘리니 3,680개(3.7배)가 됐다. '무인창업' 하나가 767개를 새로 물어왔고
//     '상권분석'이 663개였다 — 씨앗 하나로는 절대 못 닿는 영역이다.
//   ★ 비용: 연관어 조회는 네이버 '검색광고' API 라 카페 인기탭을 긁는 CF 예산과 완전히 별개다.
//     차단 위험이 없어 마음껏 넓혀도 된다. 비용은 그 뒤 스캔 단계에서만 나고 거긴 캐시가 걸러준다.
//   후보 고르는 법: ① 캐시에서 이미 지역형으로 검증된 제품(수확이 보장됨) ② 검색량 상위.
//     그리고 각 후보를 실제로 조회해 '새로 물어오는 개수(fresh)'를 재서 순위를 매긴다 —
//     추측이 아니라 실측이라, 이름만 그럴싸하고 겹치기만 하는 후보가 위로 안 올라온다.
//   ★ 사장님 의도(2026-08-11): "'창업'을 넣으면 '프랜차이즈' 같은 게 나왔으면 좋겠다".
//     즉 '무인창업·소자본창업' 같은 변형이 아니라 '개념이 다른 형제 단어'가 핵심이다.
//     그래서 씨앗을 포함하지 않는 후보(kind='other')를 먼저, 넉넉히 뽑는다.
//   ★ 다만 검색량만 보면 잡음이 1등을 한다 — '창업'의 씨앗 미포함 상위가
//     블로그 184,000 · 코인노래방 155,630 · 담가화로구이 142,920 이다(실측). 형제 단어가 아니다.
//     그래서 '겹침(overlap)'을 같이 잰다: 후보의 연관어 중 원래 씨앗의 연관어와 겹치는 비율.
//       프랜차이즈 → 겹침 높음(같은 시장)   블로그 → 겹침 낮음(남의 시장)
//     겹침이 낮으면 새 키워드는 많이 물어와도 우리 업종이 아니다.
export type SeedCand = { seed: string; total: number; fresh: number; proven: number; overlap: number; kind: 'other' | 'variant' };

// 같은 시장으로 볼 최소 겹침 비율. 이보다 낮으면 '남의 시장'으로 보고 뒤로 보낸다(자동 체크도 안 함).
export const SEED_OVERLAP_MIN = 0.2;

export async function discoverSeeds(
    seed: string, onProgress?: (note: string) => void,
): Promise<SeedCand[]> {
    const base = seed.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (!base.length) return [];
    const baseSet = new Set<string>();
    const vol = new Map<string, number>();
    for (const s of base) {
        onProgress?.(`"${s}" 연관어 조회 중…`);
        const r = await fetch(`/api/naver-keywords?q=${encodeURIComponent(s)}`);
        const j = await r.json().catch(() => ({}));
        for (const x of ((j as { keywords?: { keyword?: string; total?: number }[] }).keywords ?? [])) {
            const k = String(x.keyword ?? '').replace(/\s/g, '');
            if (!k) continue;
            baseSet.add(k);
            vol.set(k, Math.max(vol.get(k) ?? 0, Number(x.total ?? 0)));
        }
    }
    if (!baseSet.size) throw new Error('연관어를 찾지 못했습니다.');

    // 후보 추리기 — 이미 넣은 씨앗과 잡음은 뺀다.
    const inBase = new Set(base.map((s) => s.replace(/\s/g, '')));
    const NOISE = ['비용', '가격', '요금', '후기', '대출', '지원금', '자금', '지원', '정보', '순위',
        '취업', '구직', '채용', '연봉', '자격증', '알바'];
    const usable = (k: string) => k.length >= 2 && k.length <= 10 && !inBase.has(k)
        && !NOISE.some((w) => k.includes(w)) && /[가-힣]/.test(k);

    // ★ 씨앗을 포함하지 않는 것 = '형제 단어'(창업 → 프랜차이즈·가맹·상권분석). 이게 사장님이 원하신 것.
    //   포함하는 것 = 변형(창업 → 무인창업·소자본창업). 새 키워드는 많이 물어오지만 결이 같다.
    const isVariant = (k: string) => base.some((s) => k.includes(s.replace(/\s/g, '')));
    // 이미 고른 것과 서로 포함관계면 건너뛴다 — '프랜차이즈'와 '프랜차이즈창업'을 둘 다 넣을 이유가 없다.
    const takeInto = (arr: string[], k: string, cap: number) => {
        if (arr.length >= cap) return false;
        if (arr.some((p) => p.includes(k) || k.includes(p))) return false;
        arr.push(k);
        return true;
    };

    // ① 캐시에서 이미 지역형으로 검증된 제품이 연관어에 있으면 우선 — 수확이 보장된 씨앗이다.
    let provenSet = new Map<string, number>();
    try {
        const pv = await getProvenProducts();
        provenSet = new Map(pv.map((p) => [p.product.replace(/\s/g, ''), p.regions]));
    } catch { /* 캐시 조회 실패해도 ②로 진행 */ }

    // ★ 후보를 '검색량'으로 고르면 안 된다 — 실측(2026-08-11) '창업'의 검색량 상위 형제 단어는
    //   블로그 184,000 · 코인노래방 155,630 · 담가화로구이 142,920 · 까페 42,490 … 전부 남의 시장이고,
    //   정작 '프랜차이즈'(10,680)는 12위라 상위 10 컷에서 잘렸다. 사장님이 원하신 바로 그 단어였다.
    //   대신 '중심성'으로 고른다 — 이 후보가 씨앗의 연관어 안에 조각으로 몇 번이나 들어 있나.
    //     프랜차이즈 → 프랜차이즈창업·프랜차이즈카페창업… 153회 = 이 시장의 중심어
    //     블로그 → 4회 = 우연히 섞인 남의 말
    //   실측 결과 중심성 상위가 프랜차이즈 153 · 사업 65 · 체인 53 · 체인점 36 · 가맹 29 로 바뀌었고,
    //   그 뒤 겹침 측정에서 프랜차이즈 60% · 가맹 67% · 사업 74% 로 전부 같은 시장 확인.
    //   문자열 연산이라 추가 조회가 없다(공짜).
    const keys = [...baseSet];
    const cent = new Map<string, number>();
    for (const k of keys) {
        if (!usable(k)) continue;
        let n = 0;
        for (const b of keys) if (b !== k && b.includes(k)) n += 1;
        cent.set(k, n);
    }
    const byCent = (a: string, b: string) => (cent.get(b) ?? 0) - (cent.get(a) ?? 0)
        || (vol.get(b) ?? 0) - (vol.get(a) ?? 0);
    const all = [...cent.keys()];
    const others: string[] = [];
    const variants: string[] = [];
    // 형제 단어부터, 검증된 것 → 중심성 순. 형제를 넉넉히(10) 뽑고 변형은 적게(4).
    for (const k of all.filter((k) => !isVariant(k) && provenSet.has(k)).sort(byCent)) takeInto(others, k, 10);
    for (const k of all.filter((k) => !isVariant(k)).sort(byCent)) takeInto(others, k, 10);
    for (const k of all.filter((k) => isVariant(k) && provenSet.has(k)).sort(byCent)) takeInto(variants, k, 4);
    for (const k of all.filter(isVariant).sort(byCent)) takeInto(variants, k, 4);

    // ② 후보마다 실제로 조회해 ⓐ 새로 물어오는 개수 ⓑ 원래 씨앗과 겹치는 비율을 잰다.
    //    겹침이 낮으면 '남의 시장'이다 — 블로그·코인노래방이 여기서 걸러진다.
    const cands = [...new Set([...others, ...variants])];
    const out: SeedCand[] = [];
    for (let i = 0; i < cands.length; i++) {
        const c = cands[i];
        onProgress?.(`후보 확인 ${i + 1}/${cands.length} — ${c}`);
        try {
            const r = await fetch(`/api/naver-keywords?q=${encodeURIComponent(c)}`);
            const j = await r.json().catch(() => ({}));
            const ks = ((j as { keywords?: { keyword?: string }[] }).keywords ?? [])
                .map((x) => String(x.keyword ?? '').replace(/\s/g, '')).filter(Boolean);
            if (!ks.length) continue;
            const fresh = ks.filter((k) => !baseSet.has(k)).length;
            out.push({
                fresh,
                kind: isVariant(c) ? 'variant' : 'other',
                overlap: (ks.length - fresh) / ks.length,
                proven: provenSet.get(c) ?? 0,
                seed: c,
                total: vol.get(c) ?? 0,
            });
        } catch { /* 이 후보만 실패 — 나머지 계속 */ }
    }
    // 같은 시장인 것(겹침 높음)을 먼저, 그 안에서 새로 물어오는 게 많은 순.
    //   형제 단어를 변형보다 앞에 둔다 — 사장님이 원하신 게 그쪽이다.
    const rank = (c: SeedCand) => (c.overlap >= SEED_OVERLAP_MIN ? 0 : 2) + (c.kind === 'other' ? 0 : 1);
    return out.sort((a, b) => rank(a) - rank(b) || b.fresh - a.fresh);
}

export async function searchCachedPopular(terms: string[], limit = 200): Promise<CachedHit[]> {
    const words = [...new Set(terms.map((t) => t.trim().replace(/\s+/g, '')).filter((t) => t.length >= 2))];
    if (!words.length) return [];
    const out = new Map<string, CachedHit>();
    // 용어별로 부분일치 조회. PostgREST or() 로 한 번에 묶으면 URL 이 길어져 잘리므로 나눠 부른다.
    for (const w of words.slice(0, 12)) {
        // ★ verdict 조건을 DB 로 내린다(2026-08-11, SUB4 발견에서 파생).
        //   adjudicate 가 강등할 때 has_section 은 true 로 두고 verdict 만 바꾼다. 그래서
        //   has_section=true 2,197건 안에 '비관련' 계열이 341건(16%) 섞여 있다.
        //   예전엔 limit(200) 을 DB 에서 먼저 걸고 verdict 를 자바스크립트로 걸렀다 —
        //   상한 200칸의 16%를 버릴 것으로 채운 뒤 버려서, 진짜 양성이 그만큼 덜 나왔다.
        //   (오탐이 화면에 나온 적은 없다. 조용히 '덜 나오는' 누락 쪽 결함이다.)
        const { data } = await supabase.from('cafe_kw_targets')
            .select('keyword,has_section,theme,verdict,volume,cafes')
            .like('keyword', `%${w}%`)
            .eq('has_section', true)
            .or('verdict.like.카페분산*,verdict.like.블로그섹션*')
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
//   ★ 2026-08-10 보강: 요청 id 하나만으로는 부족했다. 두 가지로 결과가 날아갔다.
//     ① 지역형은 제품키워드마다 요청을 따로 만든다(25개 = 25건) → 저장이 매번 덮여 마지막 1건만 남았다.
//     ② 이미 화면에 쌓인 결과(캐시분 + 먼저 끝난 키워드분)는 아무 데도 안 남아 새로고침에 그대로 사라졌다.
//     그래서 살아있는 요청 id 전부(ids) 와 지금까지 모은 결과(result)를 같이 저장한다.
const PENDING_KEY = 'ddmkt.cafeScan.pending';
export type PendingScan = { id: number; ids: number[]; kind: string; label: string; at: number; result: KwResult[] };

function readPending(): PendingScan | null {
    try {
        const raw = localStorage.getItem(PENDING_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw) as Partial<PendingScan>;
        if (!p) return null;
        // 하루 지난 건 버린다 — 그 사이 워커가 죽었거나 사장님이 잊은 것이다.
        if (Date.now() - (p.at || 0) > 24 * 3600 * 1000) { localStorage.removeItem(PENDING_KEY); return null; }
        const ids = [...new Set([...(p.ids || []), ...(p.id ? [p.id] : [])])].filter((n) => Number.isFinite(n) && n > 0);
        const result = p.result || [];
        if (!ids.length && !result.length) return null;
        return { at: p.at || 0, id: ids[0] || 0, ids, kind: p.kind || '', label: p.label || '', result };
    } catch {
        return null;
    }
}

function writePending(p: PendingScan): void {
    try {
        localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    } catch { /* 사파리 프라이빗 등 — 저장 못 해도 스캔 자체는 돌아간다 */ }
}

// 요청 하나를 시작했다 — 기존 기록 위에 이어 붙인다(여러 건이면 전부 남아야 한다).
export function savePendingScan(id: number, kind: string, label: string): void {
    const cur = readPending();
    writePending({
        at: Date.now(), id,
        ids: [...new Set([...(cur?.ids || []), id])],
        kind, label,
        result: cur?.result || [],
    });
}

// 지금까지 모은 결과 + 아직 도는 요청을 갱신 — 새로고침해도 여기까지는 화면에 되살아난다.
//   liveIds 가 비면 '다 끝났고 결과만 남은' 상태로 보관한다(배너는 안 뜨고 결과만 복원).
//   liveIds=null 이면 도는 요청 목록은 그대로 두고 결과만 갱신한다(스캔 도중 부분결과 저장용).
export function savePendingProgress(liveIds: number[] | null, result: KwResult[]): void {
    const cur = readPending();
    if (!cur && !result.length) return;
    const ids = liveIds === null ? (cur?.ids || []) : liveIds.filter((n) => Number.isFinite(n) && n > 0);
    writePending({
        at: Date.now(),
        id: ids[0] || 0,
        ids,
        kind: cur?.kind || '', label: cur?.label || '',
        result,
    });
}

export function loadPendingScan(): PendingScan | null {
    return readPending();
}

export function clearPendingScan(): void {
    try {
        localStorage.removeItem(PENDING_KEY);
    } catch { /* 무시 */ }
}

// ── 담아둔 키워드(보관함) ────────────────────────────────────────────────────
//   ★ 왜: 조회 한 번에 다 나오지 않는다. '창업'으로 뽑고 '프랜차이즈'로 또 뽑고 정보형으로도 뽑아
//     쌓아야 계약 건수를 채운다. 그런데 새로 조회할 때마다 고른 칩이 초기화돼서, 다시 조회하면
//     앞에서 고른 게 사라졌다(2026-08-11 사장님 요청). 그래서 고른 것은 조회와 무관하게 남긴다.
//   업체(client_id)별로 따로 보관한다 — 담당자가 여러 업체를 오가며 작업한다.
const PICKED_KEY = (who: string) => `ddmkt.cafeKw.picked.${who || 'me'}`;

export function loadPickedKw(who: string): KwResult[] {
    try {
        const raw = localStorage.getItem(PICKED_KEY(who));
        if (!raw) return [];
        const v = JSON.parse(raw) as { at?: number; rows?: KwResult[] };
        // 30일 지난 보관함은 버린다 — 옛 계약 잔재가 새 건에 섞이지 않게.
        if (!v?.rows?.length || Date.now() - (v.at || 0) > 30 * 24 * 3600 * 1000) return [];
        return v.rows;
    } catch {
        return [];
    }
}

export function savePickedKw(who: string, rows: KwResult[]): void {
    try {
        if (!rows.length) localStorage.removeItem(PICKED_KEY(who));
        else localStorage.setItem(PICKED_KEY(who), JSON.stringify({ at: Date.now(), rows }));
    } catch { /* 무시 */ }
}

// 스캔 취소 — 아직 워커가 집지 않은(queued) 요청만 끈다.
//   ★ 왜 queued 만인가: 이미 claimed 면 워커 루프가 돌고 있어 상태만 바꿔도 안 멈춘다.
//     대신 지역형은 키워드마다 요청을 따로 만들므로(제품 25개 = 요청 25건), 뒤쪽 대기분을
//     끄는 것만으로도 대부분 줄일 수 있다(실측 2026-08-10: 3/25 진행 중 = 22건이 대기).
export async function cancelScans(ids: number[], why = '사용자 중단'): Promise<number> {
    const live = ids.filter((n) => Number.isFinite(n));
    if (!live.length) return 0;
    const { data } = await supabase.from('cafe_kw_requests')
        .update({ note: why, status: 'failed' })
        .in('id', live).eq('status', 'queued').select('id');
    return (data ?? []).length;
}

// 저장해 둔 요청의 현재 상태 — 새로고침 후 '이어보기'용. 폴링 없이 한 번만 읽는다.
export async function peekScan(id: number): Promise<{ status: string; note: string; result: KwResult[] } | null> {
    const { data } = await supabase.from('cafe_kw_requests').select('status,result,note').eq('id', id).single();
    if (!data) return null;
    const row = data as { status: string; result: KwResult[] | null; note: string | null };
    return { note: row.note || '', result: row.result || [], status: row.status };
}

// 여러 요청을 한 번에 확인 — 지역형은 키워드마다 요청이 따로라 이어보기도 여러 건을 봐야 한다.
//   끝난 것(done/failed)의 결과는 걷어 오고, 아직 도는 것만 live 로 돌려준다.
//   조회 자체가 안 되는 id(삭제 등)는 죽은 것으로 본다 — 영원히 기다리지 않게.
export async function peekScans(ids: number[]): Promise<{ live: number[]; note: string; result: KwResult[] }> {
    const want = ids.filter((n) => Number.isFinite(n) && n > 0);
    if (!want.length) return { live: [], note: '', result: [] };
    const { data } = await supabase.from('cafe_kw_requests').select('id,status,result,note').in('id', want);
    const rows = (data || []) as { id: number; status: string; result: KwResult[] | null; note: string | null }[];
    const live: number[] = [];
    const out: KwResult[] = [];
    const notes: string[] = [];
    for (const r of rows) {
        // ★ 아직 도는 요청의 result 도 걷어 온다 — 워커가 찾는 즉시 result 를 갱신하므로(부분결과),
        //   새로고침해도 '지금까지 찾은 것'이 그대로 되살아난다.
        out.push(...(r.result || []));
        if (['done', 'failed', 'fail', 'error'].includes(r.status)) continue;
        live.push(r.id);
        if (r.note) notes.push(r.note);
    }
    return { live, note: notes[0] || '', result: out };
}

// 폴링 — done 까지. result 반환. onProgress(note) 로 워커 진행상태(note "진행 x/total · 인기탭 n") 전달.
export async function pollPlaceScan(
    id: number,
    opts?: {
        signal?: AbortSignal; timeoutSec?: number;
        onProgress?: (note: string, status: string) => void;
        // 부분결과 — 워커가 인기탭을 하나 찾을 때마다 result 를 갱신한다. 끝나기 전에 화면에 쌓는 용도.
        onPartial?: (rows: KwResult[]) => void;
    },
): Promise<{ result: KwResult[]; bizName: string | null }> {
    const timeoutMs = (opts?.timeoutSec ?? 180) * 1000;
    const t0 = Date.now();
    let lastNote = '';
    let seenPartial = 0;
    // ★ result 는 '찾은 개수가 늘었을 때만' 받는다(2026-08-12).
    //   예전엔 3초마다 result 전체를 받아왔다. 25분짜리 스캔이면 500번이고, result 가 186건이면
    //   1회 274KB × 500 = 130MB 를 한 스캔에 쓴다. Supabase Egress 26.8GB/5GB(536%)의
    //   PostgREST 53.5% 가 여기서 나왔다(실측 2026-08-12).
    //   진행 note 에 개수가 들어 있으니(진행 x/y · 인기탭 N / 발견 N / 살아있음 N) 그걸로 판단한다.
    //   note 만 받는 조회는 1KB 미만이다.
    const countOf = (note: string) => {
        const m = note.match(/(?:인기탭|발견|살아있음)\s*(\d+)/);
        return m ? Number(m[1]) : -1;
    };
    let lastCount = -1;
    while (Date.now() - t0 < timeoutMs) {
        if (opts?.signal?.aborted) throw new Error('취소됨');
        await new Promise((r) => setTimeout(r, 3000));
        const { data } = await supabase.from('cafe_kw_requests').select('status,biz_name,note').eq('id', id).single();
        const row = data as { status: string; biz_name: string | null; note: string | null } | null;
        if (row) {
            if (row.note) lastNote = row.note;
            if (opts?.onProgress && row.note) opts.onProgress(row.note, row.status);
            const done = ['done', 'failed', 'fail', 'error'].includes(row.status);
            const n = countOf(row.note || '');
            // 끝났거나(결과 확정) 개수가 늘었을 때만 무거운 result 를 받는다.
            //   개수를 note 에서 못 읽으면(-1) 옛 동작대로 받는다 — 결과를 놓치느니 트래픽을 쓴다.
            if (done || n < 0 || n > lastCount) {
                if (n >= 0) lastCount = n;
                const { data: d2 } = await supabase.from('cafe_kw_requests').select('result').eq('id', id).single();
                const rs = ((d2 as { result: KwResult[] | null } | null)?.result) || [];
                if (opts?.onPartial && rs.length > seenPartial) { seenPartial = rs.length; opts.onPartial(rs); }
                // 워커는 실패 시 status='failed' 를 쓴다('fail' 아님 — 예전엔 안 잡혀 900초 타임아웃까지 매달렸다).
                //   실패 사유(note)를 그대로 노출한다 — 차단으로 못 판정한 걸 '0건'처럼 보이게 하면 안 된다.
                if (done) {
                    if (row.status !== 'done') throw new Error(row.note || '인기탭 분석 실패');
                    return { bizName: row.biz_name, result: rs };
                }
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
        + '이 화면을 켜 두시면 끝날 때까지 자동으로 채워집니다(다시 누르지 않으셔도 됩니다). '
        + '창을 닫으셨다면 나중에 같은 화면을 열기만 하면 이어서 붙습니다.',
    );
}
