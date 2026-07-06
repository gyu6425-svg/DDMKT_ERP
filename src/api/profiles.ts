import { supabase } from '../lib/supabase';
import type { Profile } from '../types';

// 계정(권한) 목록 — 관리자만(RLS: profiles admin manage). 역할→이름 순.
export async function getProfiles() {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('role', { ascending: true })
        .order('name', { ascending: true })
        .returns<Profile[]>();
    return { data: data ?? [], error };
}

// 권한 변경 — role/duties/sheet_categories/is_active 등.
export async function updateProfile(id: string, patch: Partial<Profile>) {
    const { error } = await supabase.from('profiles').update(patch).eq('id', id);
    return { error };
}
