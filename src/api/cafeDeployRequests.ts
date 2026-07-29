import { supabase } from '../lib/supabase';

// 카페 배포 '접수' — 고객이 로그인 후 접수 폼 제출 → 내부 검토·세팅.
//   전제: docs/cafe-deploy-requests.sql (cafe_deploy_requests 테이블/RLS). 금액/정산은 계약관리 별도.
export type CafeDeployRequest = {
    id: string;
    created_at: string;
    client_id: string;
    company_name: string;
    url: string | null;
    keyword: string | null;
    mission_start: string | null;
    daily_count: number | null;
    total_count: number | null;
    photo_provided: string | null;
    product_type: string | null;
    note: string | null;
    status: string; // 접수 | 세팅중 | 완료
};

export type CafeDeployInput = {
    company_name: string;
    url?: string;
    keyword?: string;
    mission_start?: string; // 'YYYY-MM-DD'
    daily_count?: number | null;
    total_count?: number | null;
    photo_provided?: string;
    product_type?: string;
    note?: string;
};

// 고객: 접수 등록. client_id 는 RLS(my_client_id) 로 검증되므로 값도 함께 넣는다.
export async function submitCafeDeployRequest(clientId: string, input: CafeDeployInput) {
    const { error } = await supabase.from('cafe_deploy_requests').insert({
        client_id: clientId,
        company_name: input.company_name.trim(),
        url: input.url?.trim() || null,
        keyword: input.keyword?.trim() || null,
        mission_start: input.mission_start || null,
        daily_count: input.daily_count ?? null,
        total_count: input.total_count ?? null,
        photo_provided: input.photo_provided || null,
        product_type: input.product_type || null,
        note: input.note?.trim() || null,
        status: '접수',
    });
    return { error };
}

// 고객: 내 접수 목록(최근) — RLS 로 본인 것만.
export async function listMyCafeDeployRequests(limit = 20) {
    const { data, error } = await supabase
        .from('cafe_deploy_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
    return { data: (data ?? []) as CafeDeployRequest[], error };
}
