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
    cafe_name: string | null;
    board_name: string | null;
    two_factor: boolean | null;
};

// 네이버 계정(민감) — 별도 테이블. UI 는 비번 마스킹.
export type DeployCredential = {
    id: string;
    client_id: string;
    deploy_request_id: string | null;
    naver_id: string | null;
    naver_pw: string | null;
    created_at: string;
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
    // 카페 발행 정보(비민감)
    cafe_name?: string;
    board_name?: string;
    two_factor?: boolean;
    // 네이버 계정(민감) — 별도 테이블에 저장
    naver_id?: string;
    naver_pw?: string;
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
//   네이버 계정(민감)은 별도 테이블 cafe_deploy_credentials 에 저장(접수 행에는 안 넣음).
export async function submitCafeDeployRequest(clientId: string, input: CafeDeployInput) {
    const { data, error } = await supabase.from('cafe_deploy_requests').insert({
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
        cafe_name: input.cafe_name?.trim() || null,
        board_name: input.board_name?.trim() || null,
        two_factor: input.two_factor ?? false,
        status: '접수',
    }).select('id').single();
    if (error) return { error };
    // 네이버 계정(민감) — 입력됐을 때만 별도 테이블에.
    if (input.naver_id?.trim() || input.naver_pw?.trim()) {
        const reqId = (data as { id: string } | null)?.id ?? null;
        const { error: cErr } = await supabase.from('cafe_deploy_credentials').insert({
            client_id: clientId,
            deploy_request_id: reqId,
            naver_id: input.naver_id?.trim() || null,
            naver_pw: input.naver_pw?.trim() || null,
        });
        if (cErr) return { error: cErr };
    }
    return { error: null };
}

// 자격증명 조회(고객=본인 / 내부=전체). UI 에서 비번은 마스킹해서 표시할 것.
export async function listDeployCredentials(clientId?: string) {
    let q = supabase.from('cafe_deploy_credentials').select('*').order('created_at', { ascending: false });
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    return { data: (data ?? []) as DeployCredential[], error };
}

// 접수 목록 — clientId 주면 그 업체로 필터(내부 미리보기용). 고객 본인은 RLS 로 자동 스코프.
export async function listCafeDeployRequests(clientId?: string, limit = 20) {
    let q = supabase.from('cafe_deploy_requests').select('*')
        .order('created_at', { ascending: false }).limit(limit);
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    return { data: (data ?? []) as CafeDeployRequest[], error };
}
