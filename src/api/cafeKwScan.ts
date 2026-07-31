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
        const base = t.replace(/(특별시|광역시|자치시|자치구|시|군|구)$/, '');
        if (base.length >= 2) out.add(base);
    }
    return [...out];
}

// 선택 시도(서울/경기/인천)의 행정구/시 토큰 목록. 지역형 '지역 키워드 생성'의 지역 축.
export async function getRegionGuTokens(sidos: string[]): Promise<{ sido: string; token: string }[]> {
    if (!sidos.length) return [];
    const { data } = await supabase.from('cafe_region_dong')
        .select('sido,gu').in('sido', sidos).limit(5000);
    const rows = (data ?? []) as { sido: string; gu: string }[];
    const seen = new Set<string>();
    const out: { sido: string; token: string }[] = [];
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

// 폴링 — done 까지. result 반환.
export async function pollPlaceScan(
    id: number, opts?: { signal?: AbortSignal; timeoutSec?: number },
): Promise<{ result: KwResult[]; bizName: string | null }> {
    const timeoutMs = (opts?.timeoutSec ?? 180) * 1000;
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (opts?.signal?.aborted) throw new Error('취소됨');
        await new Promise((r) => setTimeout(r, 3000));
        const { data } = await supabase.from('cafe_kw_requests').select('status,result,biz_name').eq('id', id).single();
        const row = data as { status: string; result: KwResult[] | null; biz_name: string | null } | null;
        if (row && ['done', 'fail', 'error'].includes(row.status)) {
            if (row.status !== 'done') throw new Error('인기탭 분석 실패');
            return { result: row.result || [], bizName: row.biz_name };
        }
    }
    throw new Error('분석 시간초과 — 워커 대기가 많을 수 있어요. 잠시 후 다시 시도하세요.');
}
