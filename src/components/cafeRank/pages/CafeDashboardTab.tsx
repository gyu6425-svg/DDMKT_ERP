import { useEffect, useMemo, useState } from 'react';
import { getCafeRankPosts, type CafeRankPost } from '../../../api/cafeRank';
import { getCafeAccounts, type CafeAccount } from '../../../api/cafeAccounts';

// 카페 · 대시보드 — '오늘 발행해야 할 업체' 체크. 더맨·더티·더반·설고 각 하루 5건씩 발행 → 담당자가 매일 확인.
//   기록은 cafe_rank_posts.published_date 기준으로 쌓인다(발행 시 자동 편입). 60초 자동 갱신.
const DAILY_TARGETS = ['더맨시스템', '더티클리닉', '더반클린', '설고']; // 하루 5건씩 발행(board 값 기준: 설고점=board '설고')
const DAILY_QUOTA = 5;
const boardKey = (p: CafeRankPost) => p.board || p.cafe_accounts?.board_short || '미분류';
const BOARD_STYLE: Record<string, { bg: string; fg: string }> = {
    더맨시스템: { bg: '#faf5ff', fg: '#7c3aed' },
    더티클리닉: { bg: '#f0fdfa', fg: '#0d9488' },
    더반클린: { bg: '#fdf2f8', fg: '#be185d' },
    설고: { bg: '#fff7ed', fg: '#c2410c' },
};

function todayKST(): string {
    const now = new Date();
    return new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000).toISOString().slice(0, 10);
}
function ymdKST(offsetDays: number): string {
    const t = todayKST();
    const [y, m, d] = t.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}
const mmdd = (iso: string) => { const [, mo, d] = iso.split('-'); return `${Number(mo)}월 ${Number(d)}일`; };

export function CafeDashboardTab() {
    const [posts, setPosts] = useState<CafeRankPost[]>([]);
    const [accounts, setAccounts] = useState<CafeAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState<Record<string, boolean>>({}); // 업체별 드롭다운 펼침(`${섹션}:${업체}`)

    const reload = async () => {
        const [rp, ac] = await Promise.all([getCafeRankPosts(), getCafeAccounts()]);
        setPosts(rp.data);
        setAccounts(ac.data);
        setLoading(false);
    };
    // 업체(board) → 계약 목표건수(goal_count). 오늘/어제 목록 우측 '총 N건'에 표시.
    const goalByBoard = useMemo(() => {
        const m: Record<string, number> = {};
        for (const a of accounts) {
            if (a.board_short && a.goal_count != null) m[a.board_short] = Math.max(m[a.board_short] || 0, a.goal_count);
        }
        return m;
    }, [accounts]);
    useEffect(() => {
        void reload();
        const iv = setInterval(() => void reload(), 60000);
        return () => clearInterval(iv);
    }, []);

    const today = todayKST();
    const yesterday = ymdKST(-1);

    // 발행일(published_date) 기준 그 날짜 글만.
    const onDate = (date: string) => posts.filter((p) => (p.published_date || '').slice(0, 10) === date);
    const countBy = (date: string, board: string) => onDate(date).filter((p) => boardKey(p) === board).length;

    const todayTotal = DAILY_TARGETS.reduce((s, b) => s + countBy(today, b), 0);
    const goalTotal = DAILY_TARGETS.length * DAILY_QUOTA;

    // 발행 글 목록(업체 순 → 최신순).
    const listOf = (date: string) =>
        onDate(date)
            .filter((p) => DAILY_TARGETS.includes(boardKey(p)))
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    const todayList = useMemo(() => listOf(today), [posts, today]);
    const yList = useMemo(() => listOf(yesterday), [posts, yesterday]);

    if (loading) {
        return <div className="rounded-xl border border-[#e2e8f0] bg-white px-6 py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>;
    }

    const kw = (p: CafeRankPost) => p.keyword_manual || p.keyword || '—';

    return (
        <div className="grid gap-4">
            <div>
                <h2 className="m-0 text-base font-bold text-[#0f172a]">카페 · 오늘 발행 현황</h2>
                <p className="m-0 mt-0.5 text-xs text-[#64748b]">{mmdd(today)} · 업체별 하루 {DAILY_QUOTA}건 발행 체크 · 발행 시 자동 집계 · 60초 자동 갱신</p>
            </div>

            {/* 업체별 오늘 발행 KPI 카드 */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                {DAILY_TARGETS.map((b) => {
                    const done = countBy(today, b);
                    const st = BOARD_STYLE[b] || { bg: '#f8fafc', fg: '#475569' };
                    const complete = done >= DAILY_QUOTA;
                    const box = complete
                        ? 'border-2 border-[#16a34a] bg-[#f0fdf4]'
                        : done > 0
                            ? 'border-2 border-[#eab308] bg-[#fefce8]'
                            : 'border-2 border-[#e2e8f0] bg-white';
                    return (
                        <div className={`rounded-xl p-4 ${box}`} key={b}>
                            <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: st.bg, color: st.fg }}>{b}</span>
                            <div className="mt-2 flex items-end gap-1">
                                <span className={`text-[28px] font-bold leading-none ${complete ? 'text-[#15803d]' : done > 0 ? 'text-[#a16207]' : 'text-[#94a3b8]'}`}>{done}</span>
                                <span className="mb-0.5 text-[13px] font-semibold text-[#94a3b8]">/ {DAILY_QUOTA}</span>
                            </div>
                            <div className={`mt-1 text-[11px] font-bold ${complete ? 'text-[#15803d]' : 'text-[#b45309]'}`}>
                                {complete ? '✓ 완료' : `${DAILY_QUOTA - done}건 남음`}
                            </div>
                        </div>
                    );
                })}
                {/* 오늘 총합 카드 */}
                <div className={`rounded-xl p-4 ${todayTotal >= goalTotal ? 'border-2 border-[#16a34a] bg-[#f0fdf4]' : 'border-2 border-[#7c3aed] bg-[#f5f3ff]'}`}>
                    <span className="rounded-full bg-[#ede9fe] px-2 py-0.5 text-[11px] font-bold text-[#6d28d9]">오늘 총 발행</span>
                    <div className="mt-2 flex items-end gap-1">
                        <span className="text-[28px] font-bold leading-none text-[#6d28d9]">{todayTotal}</span>
                        <span className="mb-0.5 text-[13px] font-semibold text-[#94a3b8]">/ {goalTotal}</span>
                    </div>
                    <div className="mt-1 text-[11px] font-bold text-[#6d28d9]">{todayTotal >= goalTotal ? '✓ 전 업체 완료' : `${goalTotal - todayTotal}건 남음`}</div>
                </div>
            </div>

            {/* 오늘 / 어제 발행 글 — 업체별 드롭다운으로 확인 */}
            {[{ key: 'today', label: `오늘(${mmdd(today)}) 발행`, rows: todayList }, { key: 'yest', label: `어제(${mmdd(yesterday)}) 발행`, rows: yList }].map((sec) => (
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4" key={sec.key}>
                    <div className="mb-2 text-[14px] font-bold text-[#0f172a]">{sec.label} <span className="text-[12px] font-normal text-[#94a3b8]">{sec.rows.length}건</span></div>
                    <div className="grid gap-2">
                        {DAILY_TARGETS.map((b) => {
                            const bp = sec.rows.filter((p) => boardKey(p) === b);
                            const okey = `${sec.key}:${b}`;
                            const isOpen = !!open[okey];
                            const st = BOARD_STYLE[b] || { bg: '#f8fafc', fg: '#475569' };
                            const complete = sec.key === 'today' && bp.length >= DAILY_QUOTA;
                            return (
                                <div className="rounded-lg border border-[#eef0f2]" key={b}>
                                    <button type="button" onClick={() => setOpen((o) => ({ ...o, [okey]: !o[okey] }))}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f8fafc]" disabled={bp.length === 0}>
                                        <span className={`text-[9px] text-[#94a3b8] transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                                        <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: st.bg, color: st.fg }}>{b}</span>
                                        <span className="text-[13px] font-bold text-[#334155]">{bp.length}건</span>
                                        <span className="text-[11px] font-semibold text-[#94a3b8]" title="계약 총 발행건수(목표)">/ 총 {goalByBoard[b] ?? 0}건</span>
                                        {sec.key === 'today' && complete ? <span className="text-[11px] font-bold text-[#15803d]">✓ 완료</span> : null}
                                        {bp.length === 0 ? <span className="ml-auto text-[11px] text-[#cbd5e1]">발행 없음</span> : null}
                                    </button>
                                    {isOpen && bp.length ? (
                                        <div className="overflow-x-auto border-t border-[#eef0f2] px-3 py-2">
                                            <table className="w-full min-w-[520px] border-collapse text-[13px]">
                                                <thead>
                                                    <tr className="border-b border-[#f1f5f9] text-left text-[#94a3b8]">
                                                        {['키워드', '제목', '카페/게시판'].map((h) => <th key={h} className="px-2 py-1 font-semibold">{h}</th>)}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {bp.map((p) => (
                                                        <tr key={p.id} className="border-b border-[#f8fafc] text-[#334155]">
                                                            <td className="whitespace-nowrap px-2 py-1.5 font-semibold">{kw(p)}</td>
                                                            <td className="max-w-[300px] truncate px-2 py-1.5" title={p.title ?? ''}>{p.title ?? '—'}</td>
                                                            <td className="whitespace-nowrap px-2 py-1.5 text-[12px] text-[#64748b]">{p.cafe_accounts?.display_name || p.cafe_name || '—'}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
