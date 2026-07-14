import { supabase } from '../lib/supabase';

// 기자단 정산 정보(은행/계좌번호/주민번호) — 민감 정보. 별도 테이블 reporter_billing + 내부 전용 RLS.
//   기자단/고객은 RLS로 접근 불가. 화면에서는 계좌·주민번호를 마스킹 후 '보기'로만 노출.
export type ReporterBilling = {
    bank_name: string | null;
    account_number: string | null;
    rrn: string | null;
    updated_at?: string | null;
};

export async function getReporterBilling(
    reporterId: string,
): Promise<{ data: ReporterBilling | null; error: { message: string } | null }> {
    const { data, error } = await supabase
        .from('reporter_billing')
        .select('bank_name,account_number,rrn,updated_at')
        .eq('reporter_id', reporterId)
        .maybeSingle<ReporterBilling>();
    return { data: data ?? null, error: error ? { message: error.message } : null };
}

export async function upsertReporterBilling(
    reporterId: string,
    input: { bank_name: string; account_number: string; rrn: string },
    updatedBy: string | null,
): Promise<{ error: { message: string } | null }> {
    const { error } = await supabase.from('reporter_billing').upsert(
        {
            reporter_id: reporterId,
            bank_name: input.bank_name.trim() || null,
            account_number: input.account_number.trim() || null,
            rrn: input.rrn.trim() || null,
            updated_at: new Date().toISOString(),
            updated_by: updatedBy,
        },
        { onConflict: 'reporter_id' },
    );
    return { error: error ? { message: error.message } : null };
}

// 주민번호 마스킹 — 앞 생년월일 6자리 + 성별 1자리만, 뒤 6자리는 ••••••.
export function maskRRN(rrn: string | null | undefined): string {
    const s = (rrn || '').trim();
    if (!s) return '-';
    const d = s.replace(/[^0-9]/g, '');
    if (d.length < 7) return '•'.repeat(Math.max(1, d.length));
    return `${d.slice(0, 6)}-${d[6]}${'•'.repeat(6)}`;
}
