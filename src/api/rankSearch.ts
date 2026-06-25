// 순위 즉시검색 — 서버리스 /api/rank 호출(서버가 네이버 측정, 브라우저 CORS 우회).
import { supabase } from '../lib/supabase';

export type RankSearchResult = {
    keyword: string;
    blogId: string;
    ti: number;
    ti_status: 'ok' | 'out' | 'fail';
    bl: number;
    bl_status: 'ok' | 'out' | 'fail';
};

// 즉시검색(PC 경유) — Cloudflare(데이터센터 IP)는 네이버 통합탭을 다르게 받으므로, 측정 요청을
//   measure_requests 큐에 쓰고 PC 리스너(crawler/run_listener.py)가 PC IP로 측정한 결과를 폴링해 받는다.
//   → 검색값 = 저장값(크롤러) = 실제 와 일치. (리스너가 안 돌면 시간초과)
export async function searchRankPC(
    keyword: string,
    blogId: string,
    logNo = '',
    signal?: AbortSignal,
): Promise<RankSearchResult> {
    const ins = await supabase
        .from('measure_requests')
        .insert({ keyword, blog_id: blogId, log_no: logNo || null })
        .select('id')
        .single();
    if (ins.error || !ins.data) throw new Error(ins.error?.message || '측정 요청 생성 실패');
    const id = (ins.data as { id: string }).id;
    for (let i = 0; i < 40; i += 1) {
        if (signal?.aborted) throw new Error('취소됨');
        await new Promise((r) => setTimeout(r, 1500)); // ~1.5s 간격, 최대 60s
        const { data } = await supabase
            .from('measure_requests')
            .select('status,ti,bl,ti_status,bl_status')
            .eq('id', id)
            .single();
        const row = data as
            | { status: string; ti: number; bl: number; ti_status: string; bl_status: string }
            | null;
        if (row && (row.status === 'done' || row.status === 'fail')) {
            if (row.status === 'fail') throw new Error('PC 측정 실패(차단/빈응답)');
            return {
                keyword,
                blogId,
                ti: row.ti ?? 99,
                ti_status: (row.ti_status as RankSearchResult['ti_status']) ?? 'fail',
                bl: row.bl ?? 99,
                bl_status: (row.bl_status as RankSearchResult['bl_status']) ?? 'fail',
            };
        }
    }
    throw new Error('측정 시간 초과 — PC 검색 리스너(run_listener)가 실행 중인지 확인하세요');
}

function getUrl(): string {
    // DEV 는 로컬 API 서버(:8787) 직접 호출, PROD 는 동일 출처 함수.
    if (import.meta.env.DEV) {
        return 'http://127.0.0.1:8787/api/rank';
    }
    return '/api/rank';
}

export async function searchRank(
    keyword: string,
    blogId: string,
    logNo = '',
    signal?: AbortSignal,
): Promise<RankSearchResult> {
    const res = await fetch(getUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, blogId, logNo }),
        signal,
    });
    const text = await res.text();
    let data: RankSearchResult & { error?: string };
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('서버 응답 파싱 실패');
    }
    if (!res.ok) {
        throw new Error(data.error || '검색 실패');
    }
    return data;
}
