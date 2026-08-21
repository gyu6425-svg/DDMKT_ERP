import { supabase } from '../lib/supabase';
import { getDefaultUnitPrice } from './cafeTokens';
import { r2Upload, r2Url } from './imageStore';

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
export function deployAmountKRW(r: { total_count?: number | null; selected_keywords?: { keyword: string }[] | null }, unitPrice: number = PAYMENT_INFO.unitPrice): number {
    const n = r.total_count ?? r.selected_keywords?.length ?? 0;
    return Math.max(0, n) * unitPrice;
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
        .select('client_id,company_name,board_name,cafe_name,total_count,daily_count,mission_start,status')
        .in('status', ['세팅중', '완료']);
    // ★ 게시판 이름은 cafe_studio_settings.board_name 을 1순위로 쓴다 —
    //   크롤러(cafe_board_crawl model_b_targets)가 글의 board 컬럼에 넣는 값이 바로 이것이라,
    //   접수서의 board_name/cafe_name 을 쓰면 글과 매칭이 안 돼 대시보드에 0건으로 보인다.
    //   (실제 사고: 라임출장부페 글 board='출장뷔페' vs 접수 cafe_name='라임출장뷔페 케이터링…' → 미매칭)
    const { data: ss } = await supabase.from('cafe_studio_settings').select('client_id,board_name');
    const boardOf = new Map<string, string>();
    for (const s of (ss ?? []) as { client_id: string; board_name: string | null }[]) {
        if (s.board_name) boardOf.set(s.client_id, s.board_name);
    }
    return (data ?? [])
        .map((r) => {
            const x = r as { client_id: string | null; company_name: string; board_name: string | null; cafe_name: string | null; total_count: number | null; daily_count: number | null; mission_start: string | null };
            const board = (x.client_id ? boardOf.get(x.client_id) : null) || x.board_name || x.cafe_name;
            return { name: x.company_name, board: board ?? '', goal: x.total_count || 0, daily: x.daily_count || 0, mission_start: (x.mission_start || '').slice(0, 10) };
        })
        .filter((t) => t.mission_start && t.board);
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
    const res = await r2Upload('deploy-intake', path, blob, 'image/jpeg');   // R2(egress 회피) — 실패 사유 그대로 전달
    return { path: res.path, error: res.error };
}

// 저장 경로 → 조회 URL(/api/img, CDN 캐시). 서명URL 불필요 → Supabase 트래픽 0.
export async function signedDeployUrls(paths: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const p of paths) if (p) out[p] = r2Url('deploy-intake', p);
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

    // ── 계약 관리에서 미리 잡아 둔 자리가 있으면 새로 만들지 않고 **그 행에 합친다**. ──
    //   임시 경로(계약 등록)로 만든 행은 껍데기다 — 사진·네이버 계정·키워드가 없다.
    //   진짜 내용은 고객 ERP 접수에만 있다. 행을 따로 만들면 같은 업체가 목록에 두 번 뜨고,
    //   카페 대시보드가 두 행의 total_count 를 합산해 목표가 두 배로 부풀려진다.
    const { data: prevRows } = await supabase.from('cafe_deploy_requests')
        .select('id,status,note,cafe_clubid,total_count,daily_count,mission_start')
        .eq('client_id', clientId).order('created_at', { ascending: false }).limit(10);
    const ph = (prevRows ?? []).find((r) => isContractPlaceholder((r as { note: string | null }).note)) as
        | { id: string; status: string; cafe_clubid: string | null; total_count: number | null; daily_count: number | null; mission_start: string | null }
        | undefined;

    let data: { id: string } | null = null;
    let error: { message: string } | null = null;

    if (ph) {
        const cnote = input.note?.trim();
        const merged = {
            ...withKw,
            // 고객이 안 채운 칸은 계약 등록 때 넣어 둔 값을 남긴다 — 병합이 정보를 지우면 안 된다.
            total_count: input.total_count ?? ph.total_count,
            daily_count: input.daily_count ?? ph.daily_count,
            mission_start: input.mission_start || ph.mission_start,
            cafe_clubid: ph.cafe_clubid,   // 고객 접수 폼에는 clubid 칸이 없다
            // 이미 발행이 끝난 건은 되돌리지 않는다. 그 외에는 '접수'로 돌려 정상 검토 흐름을 탄다
            //   — 사진·계정이 지금 막 도착했으니 담당자가 다시 봐야 하고, 접수 알림도 그때 뜬다.
            status: ph.status === '완료' ? '완료' : '접수',
            note: `${MERGED_NOTE} ${todayISO()}]${cnote ? ` ${cnote}` : ''}`,
        };
        ({ error } = await supabase.from('cafe_deploy_requests').update(merged).eq('id', ph.id));
        if (error && /selected_keywords|product_keywords|42703|column/i.test(error.message)) {
            const { selected_keywords: _sk, product_keywords: _pk, ...rest } = merged;
            ({ error } = await supabase.from('cafe_deploy_requests').update(rest).eq('id', ph.id));
        }
        data = { id: ph.id };
    } else {
        ({ data, error } = await supabase.from('cafe_deploy_requests').insert(withKw).select('id').single());
        // selected_keywords/product_keywords 컬럼 미적용(SQL 미실행) 시 접수가 통째로 깨지지 않도록 그 필드만 빼고 재시도.
        if (error && /selected_keywords|product_keywords|42703|column/i.test(error.message)) {
            ({ data, error } = await supabase.from('cafe_deploy_requests').insert(base).select('id').single());
        }
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

// 카페 배포 단가 — 기본 15,000원(대행사 포함). 일반(기존) 업체는 더 비싸고 매번 달라 계약관리에서 수동 조정.
// 카페 배포 단가 — **상수가 아니라 설정값**을 쓴다(사장님 확인 2026-08-20: 단가는 매번 달라질 수 있다).
//   예전에는 여기 15,000 이 박혀 있어서, 20,000 에 판 건도 계약에는 15,000 × 건수로 기록됐다.
//   50건이면 매출 25만원이 장부에서 사라진다.
export const CAFE_UNIT_PRICE_FALLBACK = 15000;
export async function cafeUnitPriceForClient(_clientId: string): Promise<{ price: number; ok: boolean }> {
    const { price, ok } = await getDefaultUnitPrice();
    return { price, ok };
}

// 카페 등록(토큰 발행) 시 계약관리(client_contracts '카페 배포')에 자동 반영 — 기본 15,000(수동 조정 전 초기값).
//   이미 '카페 배포' 계약이 있는 업체(더맨 등 수동 관리)는 금액을 건드리지 않는다.
//
//   ⚠️ 단 '껍데기 계약'은 예외다. 셀프가입 승인(PendingSignupsPanel)이 사이드바 '카페' 메뉴를 띄우려고
//      goal_count=null · amount=null 인 빈 행을 미리 만든다. 예전 코드는 그 빈 행을 보고
//      "이미 계약이 있다"며 그냥 돌아섰고, 그래서 **셀프가입 고객은 매출이 영구히 0원**이었다.
//      (실측 2026-08-18: 카페 배포 계약 21건 중 6건이 amount=null — 대행사·올스마케팅·어퍼모스트·
//       훼미리홈데코·미담공장·test1223. 그중 '대행사'는 결제·토큰발행까지 끝난 주문이다.)
//      → 껍데기가 있으면 새로 만들지 않고 그 행을 채운다.
export async function ensureCafeDeployContract(clientId: string, count: number) {
    if (!clientId || !count || count <= 0) return { error: null, created: false };
    const { data: existing } = await supabase.from('client_contracts')
        .select('id,goal_count,amount').eq('client_id', clientId).eq('subtype', '카페 배포');
    const rows = (existing ?? []) as { id: string; goal_count: number | null; amount: number | null }[];
    // 금액이 들어간 진짜 계약이 하나라도 있으면 손대지 않는다(수동 관리 업체 보호).
    if (rows.some((r) => (r.amount ?? 0) > 0 || (r.goal_count ?? 0) > 0)) {
        return { error: null, created: false };
    }
    // ★ 대행사 하위 업체에는 우리 계약을 채우지 않는다(사장님 확정 2026-08-20).
    //   하위의 거래 상대는 대행사다. 여기서 우리 단가를 채우면
    //   ① 우리 월매출에 대행사 사업 매출이 섞이고
    //   ② 하위 고객ERP에 우리 원가가 청구서처럼 뜨고
    //   ③ 같은 실적이 부모 대행사 계약과 이 행에 이중 계상된다(goal_count 가 채워지는 순간).
    const { data: who } = await supabase.from('clients').select('parent_client_id').eq('id', clientId).maybeSingle();
    if ((who as { parent_client_id: string | null } | null)?.parent_client_id) {
        return { error: null, created: false };
    }

    // 단가는 설정값에서 온다. 읽지 못했으면 계약을 만들지 않는다 —
    //   잘못된 단가로 매출을 기록하느니 비워두고 담당자가 채우는 편이 낫다.
    const { price: unit, ok: priceOk } = await cafeUnitPriceForClient(clientId);
    if (!priceOk) return { error: { message: '기본 단가를 읽지 못해 계약 금액을 채우지 못했습니다 — 계약관리에서 직접 입력하세요' }, created: false };
    const today = new Date().toISOString().slice(0, 10);
    const shell = rows[0];
    if (shell) {
        // 껍데기 채우기 — 행을 늘리지 않는다(계약이 2행이 되면 진행률 동기화가 같은 실적을 중복 반영한다).
        const { error } = await supabase.from('client_contracts').update({
            goal_count: count,
            remain_count: count,
            unit_price: unit,
            amount: count * unit,
            contract_date: today,
            sheet_approved: true,
        }).eq('id', shell.id);
        return { error, created: !error };
    }
    const { error } = await supabase.from('client_contracts').insert({
        client_id: clientId,
        category: '카페',
        subtype: '카페 배포',
        goal_count: count,
        remain_count: count,
        unit_price: unit,
        amount: count * unit,
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
// 계약 관리에서 잡은 '자리만 있는' 접수 행을 알아보는 표식.
//   ★ 원래 구조는 고객 ERP 접수가 정문이다. 계약 관리 등록은 그 전까지 쓰는 임시 경로라
//     (사장님 확정 2026-08-21), 나중에 고객이 접수하면 이 행에 합쳐진다 — 아래 submit 참고.
export const PLACEHOLDER_NOTE = '[계약 등록] 계약 관리에서 등록 — 고객 접수 아님';
export const MERGED_NOTE = '[계약 등록 → 고객 접수 병합';
export const isContractPlaceholder = (note?: string | null) => (note || '').startsWith('[계약 등록]');
export const isMergedFromContract = (note?: string | null) => (note || '').startsWith(MERGED_NOTE);
const todayISO = () => new Date().toISOString().slice(0, 10);

// 계약 관리에서 카페 배포를 등록했을 때 — 관리자 '카페 접수' 목록에도 올린다.
//   고객이 스스로 넣은 접수가 아니라 우리가 잡은 계약이라, 접수·결제대기 단계를 건너뛰고
//   바로 '세팅중'으로 만든다(계약 등록 시점에 발행 승인·토큰이 이미 들어간다).
//   그래야 그 행에 '발행하러 가기' 버튼이 뜬다 — 이 버튼은 세팅중에서만 보인다.
//
//   ★ 업체당 한 행만 유지한다(있으면 갱신). 계약을 여러 번 등록할 때마다 행을 새로 만들면
//     카페 대시보드가 total_count 를 겹쳐 세서 목표 건수가 부풀려진다
//     (listActiveDeployTargets 는 세팅중·완료 행을 전부 합산한다).
export async function upsertDeployFromContract(clientId: string, input: {
    company_name: string;
    total_count: number | null;
    board_name?: string | null;
    board_url?: string | null;
    club_id?: string | null;
    contract_date?: string | null;
}) {
    const board = input.board_name?.trim() || null;
    const patch = {
        company_name: input.company_name.trim() || '고객사',
        total_count: input.total_count,
        cafe_name: board,
        board_name: board,
        url: input.board_url?.trim() || null,
        cafe_clubid: (input.club_id || '').replace(/[^0-9]/g, '') || null,
        mission_start: input.contract_date || null,
        status: '세팅중',
        note: PLACEHOLDER_NOTE,
    };
    // ★ 고객이 이미 접수한 행은 건드리지 않는다 — 사진·계정·키워드가 들어 있는 진짜 내용이라
    //   계약 등록이 그 위를 덮으면 통째로 날아간다. 그때는 계약 정보만 채워 넣는다.
    const { data: prev } = await supabase.from('cafe_deploy_requests')
        .select('id,note').eq('client_id', clientId).order('created_at', { ascending: false }).limit(10);
    const rows = (prev ?? []) as { id: string; note: string | null }[];
    const real = rows.find((r) => !isContractPlaceholder(r.note));
    if (real) {
        const { error } = await supabase.from('cafe_deploy_requests').update({
            total_count: patch.total_count,
            mission_start: patch.mission_start,
            ...(patch.cafe_clubid ? { cafe_clubid: patch.cafe_clubid } : {}),
        }).eq('id', real.id);
        return { error, created: false };
    }
    const existing = rows[0];
    if (existing) {
        const { error } = await supabase.from('cafe_deploy_requests').update(patch).eq('id', existing.id);
        return { error, created: false };
    }
    const { error } = await supabase.from('cafe_deploy_requests').insert({ client_id: clientId, ...patch });
    return { error, created: true };
}

export async function listCafeDeployRequests(clientId?: string, limit = 20) {
    let q = supabase.from('cafe_deploy_requests').select('*')
        .order('created_at', { ascending: false }).limit(limit);
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    return { data: (data ?? []) as CafeDeployRequest[], error };
}
