import { supabase } from '../lib/supabase';

// 카페 배포 '접수' — 고객이 로그인 후 접수 폼 제출(사진 포함) → 내부 검토·세팅.
//   전제: docs/cafe-deploy-requests.sql + cafe-deploy-photos.sql. 금액/정산은 계약관리 별도.
export const CAFE_DEPLOY_BUCKET = 'deploy-intake';

// 배포 상태 흐름: 접수 → 결제대기(승인) → 세팅중 → 완료
export const DEPLOY_STATUSES = ['접수', '결제대기', '세팅중', '완료'] as const;

// 결제(입금) 안내 — 승인 시 고객ERP에 노출. 1건 발행 = 1토큰 = 15,000원.
export const PAYMENT_INFO = {
    unitPrice: 15000,
    bank: '국민은행',
    account: '592201-01-700434',
    holder: '김종인 (든든한마케팅)',
    method: '계좌이체(무통장 입금)',           // 현재 기본 결제수단
    cardAvailable: true,                         // 카드결제도 가능(담당자 문의)
    cardNote: '카드결제를 원하시면 담당자에게 문의해 주세요.',
};

// 이 접수의 결제 금액(원) = 발행 건수 × 15,000. total_count 없으면 선택 키워드 수로 대체.
export function deployAmountKRW(r: { total_count?: number | null; selected_keywords?: { keyword: string }[] | null }): number {
    const n = r.total_count ?? r.selected_keywords?.length ?? 0;
    return Math.max(0, n) * PAYMENT_INFO.unitPrice;
}

// 접수 사진 경로 묶음: 최상위 폴더 = client_id.
export type DeployPhotos = { main: string[]; real: string[]; banner: string[] };

// 고객이 '정확 인기탭 분석'에서 골라 우리에게 전달하는 키워드(발행 대상). 전제: docs/cafe-deploy-selected-keywords.sql
export type PickedKeyword = { keyword: string; volume?: number | null; theme?: string | null };

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
    deploy_type: string | null;       // 지역형 | 키워드형
    region_sets: string[] | null;     // 지역형 선택 지역셋
    product_keywords: string[] | null; // 지역형: 고객 제품키워드 칩(입주청소·상가청소 …)
    selected_keywords: PickedKeyword[] | null; // 고객이 고른 인기탭 키워드(발행 대상)
    cafe_clubid: string | null;       // 신규 고객 카페 clubid(SUB2 write URL 조립용). docs/cafe-deploy-clubid.sql
};

// 카페 대시보드용 — 미션시작일 있는 활성 접수(신규 고객)를 KPI/누적 대상으로. board=게시판명(크롤 board 와 매칭).
export type DeployDashTarget = { name: string; board: string; goal: number; daily: number; mission_start: string };
export async function listActiveDeployTargets(): Promise<DeployDashTarget[]> {
    const { data } = await supabase.from('cafe_deploy_requests')
        .select('company_name,board_name,cafe_name,total_count,daily_count,mission_start,status')
        .in('status', ['세팅중', '완료']);
    return (data ?? [])
        .filter((r) => (r as { mission_start: string | null }).mission_start && ((r as { board_name: string | null }).board_name || (r as { cafe_name: string | null }).cafe_name))
        .map((r) => {
            const x = r as { company_name: string; board_name: string | null; cafe_name: string | null; total_count: number | null; daily_count: number | null; mission_start: string };
            return { name: x.company_name, board: (x.board_name || x.cafe_name)!, goal: x.total_count || 0, daily: x.daily_count || 0, mission_start: x.mission_start.slice(0, 10) };
        });
}

// 담당자: 신규 고객 카페 clubid 저장(SUB2 가 이 값으로 그 카페에 발행). 숫자만.
export async function updateDeployClubid(id: string, clubid: string) {
    const v = (clubid || '').replace(/[^0-9]/g, '') || null;   // 숫자만
    const { error } = await supabase.from('cafe_deploy_requests').update({ cafe_clubid: v }).eq('id', id);
    return { error };
}

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
    // 접수 유형
    deploy_type?: string;             // 지역형 | 키워드형
    region_sets?: string[];           // 지역형 선택 지역셋
    product_keywords?: string[];      // 지역형: 고객이 넣는 제품키워드 칩(입주청소·상가청소 …)
    selected_keywords?: PickedKeyword[]; // 고객이 고른 인기탭 키워드(발행 대상)
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
    const base = {
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
        deploy_type: input.deploy_type || '지역형',
        region_sets: input.region_sets ?? null,
        status: '접수',
    };
    const withKw = {
        ...base,
        selected_keywords: input.selected_keywords?.length ? input.selected_keywords : null,
        product_keywords: input.product_keywords?.length ? input.product_keywords : null,
    };
    let { data, error } = await supabase.from('cafe_deploy_requests').insert(withKw).select('id').single();
    // selected_keywords/product_keywords 컬럼 미적용(SQL 미실행) 시 접수가 통째로 깨지지 않도록 그 필드만 빼고 재시도.
    if (error && /selected_keywords|product_keywords|42703|column/i.test(error.message)) {
        ({ data, error } = await supabase.from('cafe_deploy_requests').insert(base).select('id').single());
    }
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
    // 즉시 등록 — 본인 cafe_account 가 없으면 생성 → 관리 시트(고객·회사)에 바로 반영.
    //   publish_enabled=false(자동화발행 탭은 담당자 세팅 후). club_id 는 세팅 때 채움.
    //   실패해도 접수 자체는 성공 처리(SQL 미적용 등) — best effort.
    try {
        const { data: acc } = await supabase.from('cafe_accounts').select('id').eq('client_id', clientId).limit(1);
        if (!acc?.length) {
            await supabase.from('cafe_accounts').insert({
                company_key: `dep_${clientId}`,
                display_name: input.company_name.trim(),
                cafe_name: input.cafe_name?.trim() || input.company_name.trim(),
                club_id: '',
                board_name: input.board_name?.trim() || '',
                board_short: input.board_name?.trim() || '',
                client_id: clientId,
                active: true,
                publish_enabled: false,
            });
        }
    } catch { /* cafe_account 생성 실패는 접수를 막지 않음 */ }
    return { error: null };
}

// 이 업체(client)가 이미 카페에 발행한 키워드 목록 — cafe_rank_posts(이 client의 카페계정들) 기준.
//   '정확 인기탭 분석' 재스캔 시 중복 제외에 사용. selected_keywords(체크한 것)와 합쳐 '이미 사용' 집합 구성.
export async function getClientPublishedKeywords(clientId: string): Promise<string[]> {
    const { data: accs } = await supabase.from('cafe_accounts').select('id').eq('client_id', clientId);
    const ids = (accs ?? []).map((a) => (a as { id: string }).id);
    if (!ids.length) return [];
    const { data: posts } = await supabase.from('cafe_rank_posts').select('keyword').in('cafe_account_id', ids);
    return (posts ?? []).map((p) => (p as { keyword: string | null }).keyword ?? '').filter(Boolean);
}

// 발행 스튜디오 프리필 — 이 업체(client)의 최신 접수 + 네이버 계정 + 서명된 사진URL(3종).
//   자동화 발행 화면이 "접수 때 채워온 값"으로 자동 채워지도록 사용. 접수 없으면 req=null(기존 기본값 유지).
export type StudioPrefill = {
    req: CafeDeployRequest | null;
    cred: DeployCredential | null;
    photoUrls: { main: string[]; real: string[]; banner: string[] };
};
export async function getLatestDeployForStudio(clientId: string): Promise<StudioPrefill> {
    const { data: rows } = await listCafeDeployRequests(clientId, 1);
    const req = rows[0] ?? null;
    const { data: creds } = await listDeployCredentials(clientId);
    const cred = (req ? creds.find((c) => c.deploy_request_id === req.id) : null) ?? creds[0] ?? null;
    const photoUrls = { main: [] as string[], real: [] as string[], banner: [] as string[] };
    if (req?.photos) {
        const all = [...req.photos.main, ...req.photos.real, ...req.photos.banner];
        const map = await signedDeployUrls(all);
        const pick = (ps: string[]) => ps.map((p) => map[p]).filter((u): u is string => !!u);
        photoUrls.main = pick(req.photos.main);
        photoUrls.real = pick(req.photos.real);
        photoUrls.banner = pick(req.photos.banner);
    }
    return { req, cred, photoUrls };
}

// 카페 등록(토큰 발행) 시 계약관리(client_contracts '카페 배포')에 자동 반영 — 건당 15,000원.
//   이미 '카페 배포' 계약이 있는 업체(더맨 등 수동 관리)는 건드리지 않는다(중복 방지). 없을 때만 생성.
export const CAFE_UNIT_PRICE_KRW = 15000;
export async function ensureCafeDeployContract(clientId: string, count: number) {
    if (!clientId || !count || count <= 0) return { error: null, created: false };
    const { data: existing } = await supabase.from('client_contracts')
        .select('id').eq('client_id', clientId).eq('subtype', '카페 배포').limit(1);
    if (existing && existing.length) return { error: null, created: false };
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from('client_contracts').insert({
        client_id: clientId,
        category: '카페',
        subtype: '카페 배포',
        goal_count: count,
        remain_count: count,
        unit_price: CAFE_UNIT_PRICE_KRW,
        amount: count * CAFE_UNIT_PRICE_KRW,
        contract_date: today,
        sheet_approved: true,
    });
    return { error, created: !error };
}

// 이 업체의 '카페 배포' 계약 목표 건수 합(있으면). 발행 스튜디오에서 "앞으로 N개 더 선택" 안내에 사용.
export async function getCafeDeployGoal(clientId: string): Promise<number> {
    const { data } = await supabase.from('client_contracts')
        .select('goal_count').eq('client_id', clientId).eq('subtype', '카페 배포');
    return (data ?? []).reduce((s, c) => s + ((c as { goal_count: number | null }).goal_count ?? 0), 0);
}

// 자격증명 조회(고객=본인 / 내부=전체). UI 에서 비번은 마스킹해서 표시할 것.
export async function listDeployCredentials(clientId?: string) {
    let q = supabase.from('cafe_deploy_credentials').select('*').order('created_at', { ascending: false });
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    return { data: (data ?? []) as DeployCredential[], error };
}

// 내부: 접수 상태 변경(접수 → 세팅중 → 완료).
export async function setCafeDeployStatus(id: string, status: string) {
    const { error } = await supabase.from('cafe_deploy_requests').update({ status }).eq('id', id);
    return { error };
}

// 내부: 접수내역 삭제 — 사진(스토리지)·자격증명 정리 후 행 삭제(사진/자격 정리는 best-effort).
export async function deleteCafeDeployRequest(row: CafeDeployRequest) {
    const paths = row.photos ? [...row.photos.main, ...row.photos.real, ...row.photos.banner] : [];
    if (paths.length) {
        try { await supabase.storage.from(CAFE_DEPLOY_BUCKET).remove(paths); } catch { /* 사진 정리 실패 무시 */ }
    }
    try { await supabase.from('cafe_deploy_credentials').delete().eq('deploy_request_id', row.id); } catch { /* 자격 정리 무시 */ }
    const { error } = await supabase.from('cafe_deploy_requests').delete().eq('id', row.id);
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
