import { supabase } from '../lib/supabase';

// 카페 배포 '접수' — 고객이 로그인 후 접수 폼 제출(사진 포함) → 내부 검토·세팅.
//   전제: docs/cafe-deploy-requests.sql + cafe-deploy-photos.sql. 금액/정산은 계약관리 별도.
export const CAFE_DEPLOY_BUCKET = 'deploy-intake';

// 접수 사진 경로 묶음: 최상위 폴더 = client_id.
export type DeployPhotos = { main: string[]; real: string[]; banner: string[] };

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
    photos: DeployPhotos | null;
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
    photos?: DeployPhotos;
};

// 사진 1장 업로드(압축된 Blob) → 저장 경로 반환. 경로 = <client_id>/<batch>/<type>_<n>.jpg
export async function uploadDeployPhoto(
    clientId: string, batch: string, type: 'main' | 'real' | 'banner', idx: number, blob: Blob,
): Promise<{ path: string | null; error: string | null }> {
    const path = `${clientId}/${batch}/${type}_${idx}.jpg`;
    const { error } = await supabase.storage.from(CAFE_DEPLOY_BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    return { path: error ? null : path, error: error?.message ?? null };
}

// 저장 경로 → 서명 URL(조회/다운로드). 내부·본인 모두 RLS 통과 시 발급됨.
export async function signedDeployUrls(paths: string[], expiresSec = 3600): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (!paths.length) return out;
    const { data } = await supabase.storage.from(CAFE_DEPLOY_BUCKET).createSignedUrls(paths, expiresSec);
    (data ?? []).forEach((d) => { if (d.signedUrl && d.path) out[d.path] = d.signedUrl; });
    return out;
}

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
        photos: input.photos ?? null,
        status: '접수',
    });
    return { error };
}

// 접수 목록 — clientId 주면 그 업체로 필터(내부 미리보기용). 고객 본인은 RLS 로 자동 스코프.
export async function listCafeDeployRequests(clientId?: string, limit = 20) {
    let q = supabase.from('cafe_deploy_requests').select('*')
        .order('created_at', { ascending: false }).limit(limit);
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    return { data: (data ?? []) as CafeDeployRequest[], error };
}
