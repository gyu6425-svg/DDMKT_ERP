import { useEffect, useState } from 'react';
import { getCafeRankPosts, type CafeRankPost } from '../../../api/cafeRank';

// 카페 · 대시보드 — '오늘 발행 현황'(하루 5건 KPI) + '오늘까지 발행 건'(누적/계약 목표).
//   대상 업체·계약건수는 고정(계약 기준). 글은 cafe_rank_posts.board 로 매칭.
// board=크롤러 저장값 · goal=계약 총건수 · daily=하루 발행 목표(업체별 상이)
const DAILY_TARGETS: { board: string; goal: number; daily: number }[] = [
    { board: '더맨시스템', goal: 50, daily: 5 },
    { board: '더티클리닉', goal: 10, daily: 5 },
    { board: '더반클린', goal: 50, daily: 5 },
    { board: '설고점', goal: 40, daily: 1 }, // 설고점만 하루 1건
];
const boardKey = (p: CafeRankPost) => p.board || p.cafe_accounts?.board_short || '미분류';
const BOARD_STYLE: Record<string, { bg: string; fg: string }> = {
    더맨시스템: { bg: '#faf5ff', fg: '#7c3aed' },
    더티클리닉: { bg: '#f0fdfa', fg: '#0d9488' },
    더반클린: { bg: '#fdf2f8', fg: '#be185d' },
    설고점: { bg: '#fff7ed', fg: '#c2410c' },
};

function todayKST(): string {
    const now = new Date();
    return new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000).toISOString().slice(0, 10);
}
const mmdd = (iso: string) => { const [, mo, d] = iso.split('-'); return `${Number(mo)}월 ${Number(d)}일`; };

export function CafeDashboardTab() {
    const [posts, setPosts] = useState<CafeRankPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState<Record<string, boolean>>({}); // 업체별 드롭다운 펼침

    const reload = async () => {
        const { data } = await getCafeRankPosts();
        setPosts(data);
        setLoading(false);
    };
    useEffect(() => {
        void reload();
        const iv = setInterval(() => void reload(), 60000);
        return () => clearInterval(iv);
    }, []);

    const today = todayKST();
    const kw = (p: CafeRankPost) => p.keyword_manual || p.keyword || '—';
    // 오늘 발행(published_date=오늘) · 누적(전체) — board 로 업체 매칭.
    const todayCount = (b: string) => posts.filter((p) => boardKey(p) === b && (p.published_date || '').slice(0, 10) === today).length;
    const cumList = (b: string) => posts.filter((p) => boardKey(p) === b).sort((x, y) => (y.created_at || '').localeCompare(x.created_at || ''));

    const todayTotal = DAILY_TARGETS.reduce((s, t) => s + todayCount(t.board), 0);
    const goalTodayTotal = DAILY_TARGETS.reduce((s, t) => s + t.daily, 0);
    const cumGrand = DAILY_TARGETS.reduce((s, t) => s + cumList(t.board).length, 0);

    if (loading) {
        return <div className="rounded-xl border border-[#e2e8f0] bg-white px-6 py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>;
    }

    return (
        <div className="grid gap-4">
            <div>
                <h2 className="m-0 text-base font-bold text-[#0f172a]">카페 · 오늘 발행 현황</h2>
                <p className="m-0 mt-0.5 text-xs text-[#64748b]">{mmdd(today)} · 업체별 하루 목표 발행 체크(설고점=1건, 그 외 5건) · 발행 시 자동 집계 · 60초 자동 갱신</p>
            </div>

            {/* 업체별 오늘 발행 KPI */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                {DAILY_TARGETS.map((t) => {
                    const done = todayCount(t.board);
                    const st = BOARD_STYLE[t.board] || { bg: '#f8fafc', fg: '#475569' };
                    const complete = done >= t.daily;
                    const box = complete ? 'border-2 border-[#16a34a] bg-[#f0fdf4]' : done > 0 ? 'border-2 border-[#eab308] bg-[#fefce8]' : 'border-2 border-[#e2e8f0] bg-white';
                    return (
                        <div className={`rounded-xl p-4 ${box}`} key={t.board}>
                            <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: st.bg, color: st.fg }}>{t.board}</span>
                            <div className="mt-2 flex items-end gap-1">
                                <span className={`text-[28px] font-bold leading-none ${complete ? 'text-[#15803d]' : done > 0 ? 'text-[#a16207]' : 'text-[#94a3b8]'}`}>{done}</span>
                                <span className="mb-0.5 text-[13px] font-semibold text-[#94a3b8]">/ {t.daily}</span>
                            </div>
                            <div className={`mt-1 text-[11px] font-bold ${complete ? 'text-[#15803d]' : 'text-[#b45309]'}`}>{complete ? '✓ 완료' : `${t.daily - done}건 남음`}</div>
                        </div>
                    );
                })}
                <div className={`rounded-xl p-4 ${todayTotal >= goalTodayTotal ? 'border-2 border-[#16a34a] bg-[#f0fdf4]' : 'border-2 border-[#7c3aed] bg-[#f5f3ff]'}`}>
                    <span className="rounded-full bg-[#ede9fe] px-2 py-0.5 text-[11px] font-bold text-[#6d28d9]">오늘 총 발행</span>
                    <div className="mt-2 flex items-end gap-1">
                        <span className="text-[28px] font-bold leading-none text-[#6d28d9]">{todayTotal}</span>
                        <span className="mb-0.5 text-[13px] font-semibold text-[#94a3b8]">/ {goalTodayTotal}</span>
                    </div>
                    <div className="mt-1 text-[11px] font-bold text-[#6d28d9]">{todayTotal >= goalTodayTotal ? '✓ 전 업체 완료' : `${goalTodayTotal - todayTotal}건 남음`}</div>
                </div>
            </div>

            {/* 오늘까지 발행 건 — 업체별 누적/계약목표 드롭다운 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-2 text-[14px] font-bold text-[#0f172a]">누적 발행 건 <span className="text-[12px] font-normal text-[#94a3b8]">{cumGrand}건</span></div>
                <div className="grid gap-2">
                    {DAILY_TARGETS.map((t) => {
                        const bp = cumList(t.board);
                        const okey = `cum:${t.board}`;
                        const isOpen = !!open[okey];
                        const st = BOARD_STYLE[t.board] || { bg: '#f8fafc', fg: '#475569' };
                        const complete = bp.length >= t.goal;
                        return (
                            <div className="rounded-lg border border-[#eef0f2]" key={t.board}>
                                <button type="button" onClick={() => setOpen((o) => ({ ...o, [okey]: !o[okey] }))}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f8fafc]" disabled={bp.length === 0}>
                                    <span className={`text-[9px] text-[#94a3b8] transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                                    <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: st.bg, color: st.fg }}>{t.board}</span>
                                    <span className="text-[13px] font-bold text-[#334155]">{bp.length}건</span>
                                    <span className="text-[11px] font-semibold text-[#94a3b8]" title="계약 총 발행건수(목표)">/ 총 {t.goal}건</span>
                                    {complete ? <span className="text-[11px] font-bold text-[#15803d]">✓ 완료</span> : null}
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
        </div>
    );
}
