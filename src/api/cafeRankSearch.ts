// 카페 순위 즉시 재검색(PC 경유) — 블로그 searchRankPC 와 동일 패턴.
//   cafe_measure_requests 큐에 쓰고 PC 리스너(crawler/run_listener.py)가 PC IP로 측정한 결과를 폴링해 받는다.
//   측정 기준 = 네이버 통합검색 '인기글 테마 섹션' 내 순위(측정·크롤과 동일). 리스너가 안 돌면 시간초과.
import { supabase } from '../lib/supabase';

export type CafeRankSearchResult = { ti: number; ti_status: 'ok' | 'out' | 'no_section' | 'fail' };

// 전체 재검색(대량) — 큐에 여러 건을 한 번에 등록만 하고 끝낸다.
//   실제 측정은 PC 리스너가 1건씩 간격을 두고 순차 처리(블로그 크롤 중엔 자동 대기) → 네이버 차단·크롤 충돌 방지.
//   post_id 를 함께 넣어 리스너가 순위를 글에 직접 저장하므로, 브라우저를 닫아도 계속 진행된다.
export type CafeMeasureJob = {
    post_id: string;
    keyword: string;
    cafe_name: string | null;
    article_id: string;
    club_id: string | null;
};

export async function enqueueCafeRankMeasures(items: CafeMeasureJob[]) {
    if (!items.length) return { error: null };
    const { error } = await supabase.from('cafe_measure_requests').insert(items);
    return { error };
}

// 남은(대기+처리중) 카페 측정 건수 — 진행률 표시용.
export async function countCafePendingMeasures() {
    const { count, error } = await supabase
        .from('cafe_measure_requests')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'processing']);
    return { count: count ?? 0, error };
}

export async function searchCafeRankPC(
    keyword: string,
    cafeName: string | null,
    articleId: string,
    clubId: string | null,
    signal?: AbortSignal,
): Promise<CafeRankSearchResult> {
    const ins = await supabase
        .from('cafe_measure_requests')
        .insert({ keyword, cafe_name: cafeName, article_id: articleId, club_id: clubId })
        .select('id')
        .single();
    if (ins.error || !ins.data) {
        throw new Error(ins.error?.message || '카페 측정 요청 생성 실패 — docs/cafe-research.sql 실행 필요');
    }
    const id = (ins.data as { id: string }).id;
    for (let i = 0; i < 40; i += 1) {
        if (signal?.aborted) throw new Error('취소됨');
        await new Promise((r) => setTimeout(r, 1500)); // ~1.5s 간격, 최대 60s
        const { data } = await supabase
            .from('cafe_measure_requests')
            .select('status,ti,ti_status')
            .eq('id', id)
            .single();
        const row = data as { status: string; ti: number; ti_status: string } | null;
        if (row && (row.status === 'done' || row.status === 'fail')) {
            if (row.status === 'fail') throw new Error('PC 측정 실패(차단/빈응답)');
            return { ti: row.ti ?? 99, ti_status: (row.ti_status as CafeRankSearchResult['ti_status']) ?? 'fail' };
        }
    }
    throw new Error('측정 시간 초과 — PC 검색 리스너(run_listener)가 실행 중인지 확인하세요');
}
