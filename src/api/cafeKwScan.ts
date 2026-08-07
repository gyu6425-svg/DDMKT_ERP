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
export async function enqueueRegionScan(productKw: string, regions: string, target = 300, includeDong = false) {
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
//   ★ '항공권'은 뺐다 — 보홀항공권 32,190 인데 섹션이 없다(상거래성 키워드는 광고 영역으로 간다).
const INTENT_WORDS = [
    '여행', '숙소', '호텔', '리조트', '펜션', '민박', '게스트하우스',
    '패키지', '투어', '호핑', '자유여행', '직항', '에어텔', '풀빌라', '휴양',
    '맛집', '가볼만', '코스', '일정', '후기', '추천', '준비물', '경비', '비용',
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

export type ExtractedProduct = { kw: string; kind: string };

// 업체 정보 붙여넣기 → 제품·서비스 키워드 추출(GPT). 플레이스가 없는 업체용.
//   ★ 결과를 그대로 확정하지 않는다 — 호출부가 체크박스로 보여주고 고객이 고른 것만 스캔한다.
export async function extractMenuKeywords(text: string, hint = ''): Promise<{ products: ExtractedProduct[]; biz: string }> {
    const r = await fetch('/api/extract-menu', {
        body: JSON.stringify({ text, hint }),
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
            target: opts?.target ?? 30,
        })
        .select('id').single();
    if (error || !data) return { id: null as number | null, error };
    return { id: (data as { id: number }).id, error: null };
}

// 폴링 — done 까지. result 반환. onProgress(note) 로 워커 진행상태(note "진행 x/total · 인기탭 n") 전달.
export async function pollPlaceScan(
    id: number, opts?: { signal?: AbortSignal; timeoutSec?: number; onProgress?: (note: string, status: string) => void },
): Promise<{ result: KwResult[]; bizName: string | null }> {
    const timeoutMs = (opts?.timeoutSec ?? 180) * 1000;
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (opts?.signal?.aborted) throw new Error('취소됨');
        await new Promise((r) => setTimeout(r, 3000));
        const { data } = await supabase.from('cafe_kw_requests').select('status,result,biz_name,note').eq('id', id).single();
        const row = data as { status: string; result: KwResult[] | null; biz_name: string | null; note: string | null } | null;
        if (row) {
            if (opts?.onProgress && row.note) opts.onProgress(row.note, row.status);
            // 워커는 실패 시 status='failed' 를 쓴다('fail' 아님 — 예전엔 안 잡혀 900초 타임아웃까지 매달렸다).
            //   실패 사유(note)를 그대로 노출한다 — 차단으로 못 판정한 걸 '0건'처럼 보이게 하면 안 된다.
            if (['done', 'failed', 'fail', 'error'].includes(row.status)) {
                if (row.status !== 'done') throw new Error(row.note || '인기탭 분석 실패');
                return { result: row.result || [], bizName: row.biz_name };
            }
        }
    }
    throw new Error('분석 시간초과 — 워커 대기가 많을 수 있어요. 잠시 후 다시 시도하세요.');
}
