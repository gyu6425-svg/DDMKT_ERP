import type { BlogAccount, BlogPost, WebMeasurement } from '../../api/blogRank';

export type Tab = 'dashboard' | 'sheet' | 'tracker' | 'writer';

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

// ── 재계약 임박 판정 = 현재 계약의 '종료일'이 다가왔거나 지났는가 ──
const IMMINENT_DAYS = 30; // 종료일 며칠 전부터 '임박'
export function isRenewalImminent(a: Pick<BlogAccount, 'contracts' | 'contract_date'>): boolean {
    const c = currentContract(a);
    if (!c || !c.end) return false; // 종료일 없으면 판정 불가
    const endTime = new Date(c.end).getTime();
    if (Number.isNaN(endTime)) return false;
    const daysUntil = (endTime - Date.now()) / 86400000;
    return daysUntil <= IMMINENT_DAYS;
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
