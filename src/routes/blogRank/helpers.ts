import type { BlogAccount, BlogPost, WebMeasurement } from '../../api/blogRank';

export type Tab = 'dashboard' | 'sheet' | 'tracker' | 'writer';

export const PER_SHEET = 20;
export const PER_FEED = 30;

// 원 단위 숫자 → '1,234,000'
export function fmtWon(n: number) {
    return n.toLocaleString('ko-KR');
}
// 현재 유효 계약일 = 마지막 재계약일(있으면) 아니면 최초 계약일.
export function latestContractDate(a: Pick<BlogAccount, 'renewals' | 'contract_date'>): string {
    if (a.renewals && a.renewals.length) {
        const last = a.renewals[a.renewals.length - 1];
        if (last && last.date) return last.date;
    }
    return a.contract_date || '';
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
