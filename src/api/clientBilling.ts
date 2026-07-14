import { supabase } from '../lib/supabase';

// 고객사 정산 계좌 — 민감 정보. 별도 테이블 client_billing + 내부 전용 RLS.
//   고객(viewer)·기자단(reporter)은 RLS로 접근 불가. 화면에서는 마스킹 후 '보기'로만 노출.
export type ClientBilling = {
    bank_name: string | null;
    account_number: string | null;
    account_holder: string | null;
    updated_at?: string | null;
};

export async function getClientBilling(clientId: string): Promise<{ data: ClientBilling | null; error: { message: string } | null }> {
    const { data, error } = await supabase
        .from('client_billing')
        .select('bank_name,account_number,account_holder,updated_at')
        .eq('client_id', clientId)
        .maybeSingle<ClientBilling>();
    return { data: data ?? null, error: error ? { message: error.message } : null };
}

export async function upsertClientBilling(
    clientId: string,
    input: { bank_name: string; account_number: string; account_holder: string },
    updatedBy: string | null,
): Promise<{ error: { message: string } | null }> {
    const { error } = await supabase.from('client_billing').upsert(
        {
            client_id: clientId,
            bank_name: input.bank_name.trim() || null,
            account_number: input.account_number.trim() || null,
            account_holder: input.account_holder.trim() || null,
            updated_at: new Date().toISOString(),
            updated_by: updatedBy,
        },
        { onConflict: 'client_id' },
    );
    return { error: error ? { message: error.message } : null };
}

// 계좌번호 마스킹 — 끝 4자리만 표시(그 외 •). 숫자/하이픈 유지.
export function maskAccount(acc: string | null | undefined): string {
    const s = (acc || '').trim();
    if (!s) return '-';
    const tail = s.replace(/[^0-9]/g, '').slice(-4);
    if (!tail) return '••••';
    return `••••${tail}`;
}
