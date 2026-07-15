import { supabase } from '../lib/supabase';

// 재계약 시 기존 계약을 보관하는 이력 항목.
export type ContractHistoryItem = {
    goal_count: number | null;
    remain_count: number | null;
    amount: number | null;
    contract_date: string | null;
    note: string | null;
    at: string; // 이력으로 넘긴 날짜(YYYY-MM-DD)
    unit_price?: number | null; // 단가
    unit_outsource?: number | null; // 외주 단가
    outsource?: number | null; // 외주비
};

// 리워드(일 단위) 상품의 주간 진행 로그 — 감사기록. 진실의 원천은 remain_count.
export type RewardWeeklyLog = {
    week: string; // ISO 주 키(예: 2026-W27) — 정렬·중복 방지용
    count: number; // 그 주 실제 처리 타수
    at: string; // 기록일(YYYY-MM-DD)
    note?: string | null;
    auto?: boolean; // 추천치 그대로 확정했는지
    outUnit?: number | null; // 그 주 외주단가(입력값) → 외주비 = count × outUnit
    vendor?: string | null; // 그 주 외주업체명
    reporter?: string | null; // 기자단 이름(기자단 보고 승인으로 생성된 로그) — 진행 이력 표시용
    paid?: boolean; // 입금 처리 여부(true=처리, false=미처리)
    tax?: boolean; // 세금계산서 발행 여부(true=발행, false=미발행)
};

// 고객사 계약 내역(카테고리/세부유형별 건수 계약). client_contracts 테이블(docs/client-contracts.sql).
export type ClientContract = {
    id: string;
    client_id: string;
    created_at: string;
    category: string;
    subtype: string;
    goal_count: number | null;
    remain_count: number | null;
    amount: number | null; // 매출 = 단가 × 수량
    contract_date: string | null;
    note: string | null;
    history?: ContractHistoryItem[] | null;
    unit_price?: number | null; // 단가
    unit_outsource?: number | null; // 외주 단가
    outsource?: number | null; // 외주비 = 외주단가 × 수량
    per_day?: number | null; // 리워드: 일일 타수(주간 환산 = per_day × 7)
    weekly_logs?: RewardWeeklyLog[] | null; // 리워드: 주차별 진행 로그
    outsource_company?: string | null; // 외주업체명(슈퍼뭉치 등) — 전 상품 공통
    blog_name?: string | null; // 브랜드 블로그 전용 — 블로그 관리시트 업체명(한 고객사 다중 블로그 A/B/C 구분)
    sheet_approved?: boolean | null; // 카테고리 관리 시트 승인 여부 — false=신규 등록 건, true=계약 중(승인 버튼)
    boost_round?: number | null; // 상위노출 보장형 회차(1,2,...) — 컨테이너 라벨 옆 표시
    boost_end?: string | null; // 상위노출 보장형 회차 종료일(시작일 = contract_date)
    parent_id?: string | null; // 컨테이너(상위노출 보장형·종합광고) 하위면 그 컨테이너 계약 id — 회차별 귀속
    no_vat?: boolean | null; // 부가세 없음(현금 거래) — true면 실매출에 VAT 10% 미포함
    payment_method?: string | null; // 결제수단 — 'card'=카드매출, null=현금/계좌이체(일반)
};

// 누적 완료 외주금액 = Σ(진행 배치 건수 × 그 배치 외주단가) + 로그에 없는 완료분(잔여로만 갱신된 건) × 기본 외주단가.
//   브랜드 블로그처럼 블로그 대시보드에서 잔여만 갱신되면(진행 이력 로그 없음) done > 로그합이 됨 → 초과분 보정.
export const completedOutsource = (ct: ClientContract): number => {
    const logs = ct.weekly_logs ?? [];
    const unit = ct.unit_outsource ?? 0;
    const goal = ct.goal_count ?? 0;
    const done = Math.max(0, goal - (ct.remain_count ?? goal));
    const loggedCount = logs.reduce((s, l) => s + (l.count || 0), 0);
    const loggedAmt = logs.reduce((s, l) => s + (l.count || 0) * (l.outUnit || unit), 0);
    const extra = Math.max(0, done - loggedCount) * unit; // 로그 미기록 완료분 보정
    return loggedAmt + extra;
};

// 총 외주비 — 저장된 값(ct.outsource) 우선, 없으면 외주단가 × 총건수. (상세 패널 '총 외주비'와 동일)
export const totalOutsource = (ct: ClientContract): number =>
    ct.outsource ?? (ct.unit_outsource ?? 0) * (ct.goal_count ?? 0);

// 금액 기반 진행률(%) — 완료(소진) 외주금액 ÷ 총 외주비. (= 상세 패널의 외주비 소진율과 일치)
//   외주단가가 낮게 진행되면 건수 100%여도 100% 미만이 될 수 있음(의도). 외주 데이터 없으면 건수%로 폴백.
export const amountProgress = (ct: ClientContract): number | null => {
    const goal = ct.goal_count ?? 0;
    const remain = ct.remain_count ?? goal;
    const done = Math.max(0, goal - remain);
    const total = totalOutsource(ct);
    const used = completedOutsource(ct);
    if (total > 0) return Math.min(100, Math.round((used / total) * 100));
    // 외주비 정보 없으면 건수%로 폴백.
    if (!goal) return null;
    if (remain <= 0) return 100;
    if (done <= 0) return 0;
    return Math.round((done / goal) * 100);
};

// ── 월 보장형 외주비 월별 귀속 ───────────────────────────────────────────────
// 월 보장형(상위노출 보장형·플레이스 리워드 등) = 25일 등 계약이라 계약월과 처리월이 다를 수 있음.
//   → 외주비를 '계약월 전액'이 아니라 '주간 처리 이력(at)의 달'로 귀속(월별 정산 일치). 그 외 상품은 계약월 전액.
//   (사용자 확정 2026-07-09: 외주비만 처리월로 분리, 공급가·매출은 계약월 그대로.)
export const isMonthlyGuarantee = (ct: ClientContract): boolean => {
    if (ct.per_day != null) return true;
    const s = ct.subtype || '';
    return s.includes('리워드') || s.includes('보장형');
};

// (내부) 날짜 문자열(YYYY-MM-DD)이 연/월 필터에 속하는지. year·month 0 = 무관.
const inYM = (d: string | null | undefined, year: number, month: number): boolean => {
    const s = d || '';
    if (!s) return false;
    if (year && Number(s.slice(0, 4)) !== year) return false;
    if (month && Number(s.slice(5, 7)) !== month) return false;
    return true;
};

// 월 보장형 계약이 그 연/월에 '처리 이력(주간 로그)'을 가지는지 — 처리월 목록/스코프 노출 판정용.
export const hasProcessInPeriod = (ct: ClientContract, year: number, month: number): boolean =>
    isMonthlyGuarantee(ct) && (ct.weekly_logs ?? []).some((l) => inYM(l.at, year, month));

// 재계약 회차별 '실제 계약분'(누적 스냅샷 → 델타)과 그 회차 계약월. history는 누적 금액이라 회차분 = 이번−직전.
//   재계약하면 amount/outsource가 누적되고 contract_date가 재계약일로 바뀌는데, 월별 귀속은 회차별 계약월로 쪼개야
//   원래 달 매출/외주가 재계약월로 통째로 이동하지 않는다. (공급가·외주 모두 각 회차 계약월에 귀속)
export type ContractPeriodDelta = { amount: number; outsource: number; contract_date: string | null };
export const contractPeriodDeltas = (ct: ClientContract): ContractPeriodDelta[] => {
    const snaps = [
        ...(ct.history ?? []).map((h) => ({
            amount: h.amount ?? 0,
            contract_date: h.contract_date ?? null,
            outsource: h.outsource ?? 0,
        })),
        { amount: ct.amount ?? 0, contract_date: ct.contract_date ?? null, outsource: ct.outsource ?? 0 },
    ];
    return snaps.map((s, i) => {
        const prev = i > 0 ? snaps[i - 1] : null;
        return {
            amount: s.amount - (prev?.amount ?? 0),
            contract_date: s.contract_date,
            outsource: s.outsource - (prev?.outsource ?? 0),
        };
    });
};

// 특정 연/월에 귀속되는 공급가(매출) — 재계약 회차별 계약월로 쪼개 합산. year·month 0 = 전체(=ct.amount).
//   외주비는 outsourceInPeriod, 매출은 이 헬퍼. 둘 다 회차별 계약월 기준(전체 이동 방지).
export const supplyInPeriod = (ct: ClientContract, year: number, month: number): number => {
    if (!year && !month) return ct.amount || 0;
    return contractPeriodDeltas(ct).reduce((s, p) => (inYM(p.contract_date, year, month) ? s + p.amount : s), 0);
};

// 특정 연/월에 귀속되는 (예상/받은) 외주비 = 매출요약 '외주비' 카드의 월별 값.
//   · 월보장: 주간 로그(처리일 at) 외주비는 그 달에, 아직 처리 안 한 잔여 외주비는 계약월에 귀속
//     → 달마다 합치면 항상 총(받은) 외주비와 같음(사라짐 없음). · 그 외: 계약월(contract_date) 전액.
//   year·month 0 이면 전체(월 무관).
export const outsourceInPeriod = (ct: ClientContract, year: number, month: number): number => {
    const total = ct.outsource || 0; // 예상/받은 외주비(카드 값)
    if (!year && !month) return total;
    // 월보장 아님(브랜드 블로그 등) = 계약월 귀속. 단, 재계약 회차별로 각 회차 계약월에 쪼개 귀속(전체 이동 방지).
    if (!isMonthlyGuarantee(ct))
        return contractPeriodDeltas(ct).reduce((s, p) => (inYM(p.contract_date, year, month) ? s + p.outsource : s), 0);
    const logs = ct.weekly_logs ?? [];
    const unit = ct.unit_outsource ?? 0;
    const amt = (l: RewardWeeklyLog) => (l.count || 0) * (l.outUnit || unit);
    const loggedMonth = logs.reduce((s, l) => (inYM(l.at, year, month) ? s + amt(l) : s), 0);
    const loggedAll = logs.reduce((s, l) => s + amt(l), 0);
    const remainder = Math.max(0, total - loggedAll); // 아직 처리 안 한 외주 = 계약월 귀속
    return loggedMonth + (inYM(ct.contract_date, year, month) ? remainder : 0);
};

// 특정 연/월에 실제 사용(소진)된 외주비 = 남은 차액 계산용.
//   · 월보장: 그 달 주간 로그 외주비 합. · 그 외: 계약월에 completedOutsource 전액. year·month 0 = 전체.
export const usedOutsourceInPeriod = (ct: ClientContract, year: number, month: number): number => {
    if (!year && !month) return completedOutsource(ct);
    if (!isMonthlyGuarantee(ct)) return inYM(ct.contract_date, year, month) ? completedOutsource(ct) : 0;
    const logs = ct.weekly_logs ?? [];
    const unit = ct.unit_outsource ?? 0;
    return logs.reduce((s, l) => (inYM(l.at, year, month) ? s + (l.count || 0) * (l.outUnit || unit) : s), 0);
};

// clientId 주면 그 고객만. 테이블 미생성 등 오류 시에도 앱이 죽지 않도록 [] 반환.
export async function getClientContracts(clientId?: string) {
    let query = supabase.from('client_contracts').select('*').order('created_at', { ascending: true });
    if (clientId) {
        query = query.eq('client_id', clientId);
    }
    const { data, error } = await query.returns<ClientContract[]>();
    return { data: data ?? [], error };
}

export async function insertClientContracts(rows: Array<Partial<ClientContract>>) {
    const { data, error } = await supabase
        .from('client_contracts')
        .insert(rows)
        .select()
        .returns<ClientContract[]>();
    return { data: data ?? [], error };
}

export async function updateClientContract(id: string, payload: Partial<ClientContract>) {
    const { error } = await supabase.from('client_contracts').update(payload).eq('id', id);
    return { error };
}

// 블로그 대시보드에서 진행률(잔여) 수정 → 계약 관리(client_contracts)의 블로그 계약에 반영(양방향 연동).
//   대상 = 그 고객사의 '브랜드 블로그' 계약(없으면 첫 블로그 계약). 진행률만 양방향, 금액·날짜는 계약 관리 전용.
export async function syncContractProgressFromBlog(
    clientId: string | null | undefined,
    remainCount: number,
    blogName?: string | null,
) {
    if (!clientId) return { synced: false };
    const { data } = await getClientContracts(clientId);
    // 브랜드블로그 계약만 대상. 다중 블로그면 blog_name(관리시트 업체명)으로 정확 매칭.
    const blogs = data.filter((c) => c.category === '블로그');
    const target =
        (blogName && blogs.find((c) => (c.blog_name || '') === blogName)) ||
        blogs.find((c) => c.subtype === '브랜드 블로그') ||
        blogs.find((c) => c.subtype === '블로그') ||
        null;
    if (!target) return { synced: false };
    const { error } = await updateClientContract(target.id, { remain_count: remainCount });
    return { synced: !error, error };
}

export async function deleteClientContract(id: string) {
    const { error } = await supabase.from('client_contracts').delete().eq('id', id);
    return { error };
}
