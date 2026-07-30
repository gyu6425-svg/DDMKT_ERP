import { supabase } from '../lib/supabase';

// 플레이스 주소 → 진짜 인기탭 발굴. cafe_kw_requests 큐에 등록(status:'queued') → 워커가 처리 → 폴링.
//   전제: docs/cafe-kw-requests-rls.sql(고객 requested_by 정책). 워커/스캐너 = 다른 세션 cafe_kw_probe.
export type KwCafe = { rank: number; who: string; kind?: string; title?: string; article?: string };
export type KwResult = { keyword: string; volume?: number; theme?: string; cafes: KwCafe[] };

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
