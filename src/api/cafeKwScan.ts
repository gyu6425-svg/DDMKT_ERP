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

// 선택 시도(서울/경기/인천)의 행정구/시 토큰 목록. 지역형 '지역 키워드 생성'의 지역 축.
export async function getRegionGuTokens(sidos: string[]): Promise<{ sido: string; token: string }[]> {
    if (!sidos.length) return [];
    const { data } = await supabase.from('cafe_region_dong')
        .select('sido,gu').in('sido', sidos).limit(5000);
    const rows = (data ?? []) as { sido: string; gu: string }[];
    const seen = new Set<string>();
    const out: { sido: string; token: string }[] = [];
    // ★ 시도명 자체도 토큰 — 보통 그 제품의 최대 검색량 키워드('서울 누수탐지' ≫ '강남 누수탐지').
    //   실측(2026-08-04): 광역시 8/8 인기탭, 道도 강원·충북·전남·경북·경남·제주 등 다수. 접미형(서울시·강원도)은 섹션없음이라 제외.
    for (const s of sidos) {
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
            if (['done', 'fail', 'error'].includes(row.status)) {
                if (row.status !== 'done') throw new Error('인기탭 분석 실패');
                return { result: row.result || [], bizName: row.biz_name };
            }
        }
    }
    throw new Error('분석 시간초과 — 워커 대기가 많을 수 있어요. 잠시 후 다시 시도하세요.');
}
