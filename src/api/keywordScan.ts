// 인기탭 발굴 스캔 — SUB4(폰 모바일 IP) 경유. keyword_scan_requests 큐에 넣고 리스너 결과를 폴링.
//   Cloudflare(데이터센터 IP)의 checkPopular 와 달리, 한국 모바일 IP라 사용자가 보는 화면과 동일 결과.
//   흐름: INSERT(pending) → SUB4 scan_listener 가 폰 IP로 스캔 → results 채우고 done → 여기서 폴링 수신.
import { supabase } from '../lib/supabase';

export type ScanVerdict = 'O' | 'X' | 'err';

// 여러 키워드를 한 요청으로 스캔하고 {키워드: O|X|err} 를 돌려준다.
export async function scanKeywordsViaSub4(
    keywords: string[],
    opts?: { note?: string; signal?: AbortSignal; timeoutSec?: number },
): Promise<Record<string, ScanVerdict>> {
    const uniq = Array.from(new Set(keywords.map((k) => k.trim()).filter(Boolean)));
    if (!uniq.length) return {};

    const ins = await supabase
        .from('keyword_scan_requests')
        .insert({ keywords: uniq, note: opts?.note ?? null })
        .select('id')
        .single();
    if (ins.error || !ins.data) throw new Error(ins.error?.message || '스캔 요청 생성 실패');
    const id = (ins.data as { id: string }).id;

    // 개수에 비례해 넉넉히 대기(키워드당 ~3s + 여유 60s). 명시 timeout 우선.
    const timeoutMs = (opts?.timeoutSec ?? Math.max(120, uniq.length * 3 + 60)) * 1000;
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (opts?.signal?.aborted) throw new Error('취소됨');
        await new Promise((r) => setTimeout(r, 2000)); // 2s 간격 폴링
        const { data } = await supabase
            .from('keyword_scan_requests')
            .select('status,results')
            .eq('id', id)
            .single();
        const row = data as { status: string; results: Record<string, ScanVerdict> | null } | null;
        if (row && (row.status === 'done' || row.status === 'fail')) {
            if (row.status === 'fail') {
                const err = row.results && (row.results as Record<string, string>).error;
                throw new Error(
                    err === 'office_ip_routing_off'
                        ? 'SUB4 라우팅 풀림(사무실 IP로 나감) — SUB4에서 "라우팅 다시 걸어줘" 후 재시도'
                        : 'SUB4 스캔 실패',
                );
            }
            return row.results || {};
        }
    }
    throw new Error('SUB4 스캔 시간초과 — SUB4 스캔 리스너(scan_listener.py)가 실행 중인지 확인하세요');
}
