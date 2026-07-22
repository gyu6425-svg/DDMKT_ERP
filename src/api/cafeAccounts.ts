import { supabase } from '../lib/supabase';

export type CafeAccount = {
    id: string;
    created_at: string;
    company_key: string;
    display_name: string;
    cafe_name: string;
    club_id: string;
    board_name: string;
    board_short: string;
    client_id: string | null;
    active: boolean;
    note: string | null;
};

export async function getCafeAccounts() {
    const { data, error } = await supabase
        .from('cafe_accounts')
        .select('*')
        .order('created_at', { ascending: true });
    return { data: (data ?? []) as CafeAccount[], error };
}

export async function upsertCafeAccount(input: Partial<CafeAccount> & { company_key: string; display_name: string }) {
    const payload = {
        active: input.active ?? true,
        board_name: input.board_name || input.board_short || input.display_name,
        board_short: input.board_short || input.display_name,
        cafe_name: input.cafe_name || 'ddmkt2',
        client_id: input.client_id || null,
        club_id: input.club_id || '31754130',
        company_key: input.company_key.trim(),
        display_name: input.display_name.trim(),
        note: input.note || null,
    };
    const { error } = await supabase.from('cafe_accounts').upsert(payload, { onConflict: 'company_key' });
    return { error };
}

export async function setCafeAccountActive(id: string, active: boolean) {
    const { error } = await supabase.from('cafe_accounts').update({ active }).eq('id', id);
    return { error };
}