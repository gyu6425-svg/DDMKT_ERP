import { supabase } from '../lib/supabase';

// 인기탭 스캔 자가점검(카나리) 결과 — crawler/cafe_kw_audit.py 가 하루 1회 기록.
//   오탐·누락·경로회귀를 사람이 눈치채기 전에 잡는 용도. 전제: docs/cafe-kw-audit.sql
export type KwAudit = {
    run_at: string;
    ok: boolean;
    status: string;          // 'ok' | 'alert' | 'blocked'
    golden_ok: number | null;
    golden_n: number | null;
    golden_undet: number | null;
    fn_sample: number | null;
    fn_hit: number | null;
    vantage_dis: number | null;
    summary: string | null;
    alerts: string[] | null;
};

// 최근 점검 1건. 테이블이 아직 없으면(SQL 미실행) null — 화면은 조용히 숨긴다.
export async function latestKwAudit(): Promise<KwAudit | null> {
    const { data, error } = await supabase.from('cafe_kw_audit')
        .select('run_at,ok,status,golden_ok,golden_n,golden_undet,fn_sample,fn_hit,vantage_dis,summary,alerts')
        .order('run_at', { ascending: false }).limit(1).maybeSingle();
    if (error) return null;
    return (data as KwAudit | null) ?? null;
}

// 점검이 하루 넘게 안 돌았는지(스케줄러가 죽었는지) — 이것도 이상 신호다.
export function auditStale(a: KwAudit | null): boolean {
    if (!a) return false;
    return Date.now() - new Date(a.run_at).getTime() > 36 * 3600 * 1000;
}
