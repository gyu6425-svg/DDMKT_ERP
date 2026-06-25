import type { BlogAccount, BlogPost, WebMeasurement } from '../../api/blogRank';

export type Tab = 'dashboard' | 'sheet' | 'tracker' | 'crawl' | 'writer';

export const PER_SHEET = 20;
export const PER_FEED = 30;

// 원 단위 숫자 → '1,234,000'
export function fmtWon(n: number) {
    return n.toLocaleString('ko-KR');
}
// 값+날짜 이력의 현재값 = 마지막 항목(있으면) 아니면 레거시 단일값.
export function currentField(history: { value: string }[] | null, legacy: string | null): string {
    if (history && history.length) return history[history.length - 1].value;
    return legacy || '';
}

// 현재 계약 = contracts 마지막(있으면), 없으면 레거시 contract_date 를 시작일로.
export function currentContract(
    a: Pick<BlogAccount, 'contracts' | 'contract_date'>,
): { start: string; end?: string } | null {
    if (a.contracts && a.contracts.length) return a.contracts[a.contracts.length - 1];
    if (a.contract_date) return { start: a.contract_date };
    return null;
}

// 현재 계약 시작일(셀 표시용).
export function latestContractDate(a: Pick<BlogAccount, 'contracts' | 'contract_date'>): string {
    return currentContract(a)?.start || '';
}

// ── 재계약 임박 판정(계약 건수 기준) = 잔여 발행 건수가 거의 소진됐는가 ──
//   2026-06-24: 계약 만료일 기준 → 계약 건수(잔여 건수) 기준으로 변경(사용자 요청).
//   잔여 ≤ IMMINENT_REMAIN(0 포함) 이면 계약분을 거의 다 발행 → 재계약 준비 시점.
const IMMINENT_REMAIN = 3; // 잔여 건수가 이 값 이하면 '임박'
const URGENT_REMAIN = 1; // 잔여 1건 이하 = 매우 임박(빨강)
export function isRenewalImminent(a: Pick<BlogAccount, 'goal_count' | 'remain_count'>): boolean {
    if (a.goal_count == null || a.remain_count == null) return false; // 계약 건수 미입력이면 판정 불가
    return a.remain_count <= IMMINENT_REMAIN;
}

// 잔여 건수 → 재계약 경고 레벨. 1건 이하=빨강(매우 임박), 2~3건=노랑(임박), 그 외 null.
//   2026-06-25 사용자 요청: 3건부터 노랑, 1건부터 빨강.
export type RenewLevel = 'red' | 'yellow' | null;
export function renewLevel(a: Pick<BlogAccount, 'goal_count' | 'remain_count'>): RenewLevel {
    if (a.goal_count == null || a.remain_count == null) return null;
    if (a.remain_count <= URGENT_REMAIN) return 'red';
    if (a.remain_count <= IMMINENT_REMAIN) return 'yellow';
    return null;
}

// 누적 계약금액 합계. amounts 있으면 합산, 없으면 레거시 amount 텍스트에서 숫자 파싱.
export function amountTotal(a: Pick<BlogAccount, 'amounts' | 'amount'>): number {
    if (a.amounts && a.amounts.length) {
        return a.amounts.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    }
    const m = (a.amount || '').replace(/[^\d]/g, '');
    return m ? Number(m) : 0;
}

export function lastM(post: BlogPost) {
    return post.measurements.length ? post.measurements[post.measurements.length - 1] : null;
}
export function prevM(post: BlogPost) {
    return post.measurements.length >= 2
        ? post.measurements[post.measurements.length - 2]
        : null;
}
export function progOf(account: BlogAccount): number | null {
    if (account.goal_count == null || account.remain_count == null || account.goal_count === 0) {
        return null;
    }
    return Math.round(((account.goal_count - account.remain_count) / account.goal_count) * 100);
}
export function dayN(post: BlogPost): number {
    if (!post.published_date) {
        return post.measurements.length ? post.measurements.length - 1 : 0;
    }
    const diff = Date.now() - new Date(post.published_date).getTime();
    return Math.max(0, Math.floor(diff / 86400000));
}

// ── 웹사이트(회사 단위) 헬퍼 ──
export function lastWe(account: BlogAccount): WebMeasurement | null {
    const w = account.website_measurements;
    return w && w.length ? w[w.length - 1] : null;
}
export function prevWe(account: BlogAccount): WebMeasurement | null {
    const w = account.website_measurements;
    return w && w.length >= 2 ? w[w.length - 2] : null;
}

export function fmtRank(rank: number, status: string): string {
    if (status === 'fail') return '실패';
    if (status === 'out' || rank > 30) return '권외';
    return `${rank}위`;
}
