import { supabase } from '../lib/supabase';

// 플레이스 순위 트래커 — 추적 업체(place_accounts) + 업체별 키워드/날짜별 순위(place_keywords).
//   순위(rank)는 크롤러(place_rank_crawler.py)가 매일 기록. 프론트는 업체·키워드 등록/삭제만.

export type PlaceMeasurement = {
    date: string; // YYYY-MM-DD
    rank: number; // 광고 제외 1-based. 권외=999
    status: 'ok' | 'out' | 'fail';
};

export type PlaceAccount = {
    id: string;
    client_id: string | null;
    name: string | null;
    place_url: string | null;
    place_id: string | null;
    is_active: boolean | null;
    created_at: string;
};

export type PlaceKeyword = {
    id: string;
    place_account_id: string;
    keyword: string;
    measurements: PlaceMeasurement[] | null;
    created_at: string;
};

// 플레이스 URL에서 place_id(숫자) 추출. 예: m.place.naver.com/nailshop/1696402748/home → 1696402748
export function extractPlaceId(url: string): string | null {
    const m = (url || '').match(/(?:place|entry|restaurant|hairshop|nailshop|hospital)\/?(\d{6,})/)
        || (url || '').match(/\/(\d{6,})(?:\/|\?|$)/);
    return m ? m[1] : null;
}

export async function getPlaceAccounts(clientId?: string) {
    let q = supabase.from('place_accounts').select('*').order('created_at', { ascending: true });
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q.returns<PlaceAccount[]>();
    return { data: data ?? [], error };
}

export async function getPlaceKeywords(accountIds?: string[]) {
    let q = supabase.from('place_keywords').select('*').order('created_at', { ascending: true });
    if (accountIds && accountIds.length) q = q.in('place_account_id', accountIds);
    const { data, error } = await q.returns<PlaceKeyword[]>();
    return { data: data ?? [], error };
}

export async function insertPlaceAccount(row: Partial<PlaceAccount>) {
    const { data, error } = await supabase.from('place_accounts').insert(row).select().returns<PlaceAccount[]>();
    return { data: data ?? [], error };
}

export async function updatePlaceAccount(id: string, patch: Partial<PlaceAccount>) {
    const { error } = await supabase.from('place_accounts').update(patch).eq('id', id);
    return { error };
}

export async function deletePlaceAccount(id: string) {
    const { error } = await supabase.from('place_accounts').delete().eq('id', id);
    return { error };
}

export async function insertPlaceKeyword(placeAccountId: string, keyword: string) {
    const { data, error } = await supabase
        .from('place_keywords')
        .insert({ keyword, place_account_id: placeAccountId })
        .select()
        .returns<PlaceKeyword[]>();
    return { data: data ?? [], error };
}

export async function deletePlaceKeyword(id: string) {
    const { error } = await supabase.from('place_keywords').delete().eq('id', id);
    return { error };
}
