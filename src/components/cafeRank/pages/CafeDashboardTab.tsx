import { useEffect, useMemo, useState } from 'react';
import { getCafeRankPosts, type CafeRankPost } from '../../../api/cafeRank';

// 카페 · 대시보드 — 업체(게시판)별 성과를 한눈에. 각 카드: 글 수 · 인기글 진입 · 최고순위 · 상위 키워드.
const BOARD_ORDER = ['누수', '더티클리닉', '설고점', '더맨시스템'];
const boardKey = (p: CafeRankPost) => p.board || p.cafe_accounts?.board_short || '미분류';
const companyName = (p: CafeRankPost) => p.cafe_accounts?.display_name || boardKey(p);
const boardRank = (b: string) => {
    const i = BOARD_ORDER.indexOf(b);
    return i >= 0 ? i : b === '미분류' ? 999 : 500;
};
const BOARD_STYLE: Record<string, { bg: string; fg: string }> = {
    누수: { bg: '#eff6ff', fg: '#1d4ed8' },
    더티클리닉: { bg: '#f0fdfa', fg: '#0d9488' },
    설고점: { bg: '#fff7ed', fg: '#c2410c' },
    더맨시스템: { bg: '#faf5ff', fg: '#7c3aed' },
};

function todayKST(): string {
    const now = new Date();
    return new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000).toISOString().slice(0, 10);
}

export function CafeDashboardTab() {
    const [posts, setPosts] = useState<CafeRankPost[]>([]);
    const [loading, setLoading] = useState(true);

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
    const cards = useMemo(() => {
        const map = new Map<string, CafeRankPost[]>();
        for (const p of posts) {
            const b = boardKey(p);
            (map.get(b) || map.set(b, []).get(b)!).push(p);
        }
        for (const b of BOARD_ORDER) if (!map.has(b)) map.set(b, []);
        return [...map.entries()]
            .map(([b, ps]) => {
                const withRank = ps
                    .map((p) => ({ p, m: p.measurements?.[p.measurements.length - 1] }))
                    .filter((x) => x.m && x.m.ti_status === 'ok')
                    .sort((a, b2) => (a.m!.ti - b2.m!.ti));
                const measuredToday = ps.filter((p) => p.measurements?.[p.measurements.length - 1]?.date === today).length;
                return {
                    board: b,
                    company: ps[0] ? companyName(ps[0]) : b,
                    total: ps.length,
                    ranked: withRank.length,
                    best: withRank[0]?.m?.ti ?? null,
                    measuredToday,
                    top: withRank.slice(0, 3).map((x) => ({ kw: x.p.keyword_manual || x.p.keyword || '—', ti: x.m!.ti })),
                };
            })
            .sort((a, b) => boardRank(a.board) - boardRank(b.board) || a.board.localeCompare(b.board));
    }, [posts, today]);

    if (loading) {
        return <div className="rounded-xl border border-[#e2e8f0] bg-white px-6 py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>;
    }

    return (
        <div className="grid gap-4">
            <div>
                <h2 className="m-0 text-base font-bold text-[#0f172a]">카페 · 대시보드</h2>
                <p className="m-0 mt-0.5 text-xs text-[#64748b]">마이클의 정보 세상 · 업체(게시판)별 인기글 성과 · 60초마다 자동 갱신</p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {cards.map((c) => {
                    const st = BOARD_STYLE[c.board] || { bg: '#f8fafc', fg: '#475569' };
                    return (
                        <div className="rounded-xl border border-[#e5e7eb] bg-white p-4" key={c.board}>
                            <div className="flex items-center justify-between">
                                <span className="rounded-full px-2.5 py-1 text-[12px] font-bold" style={{ background: st.bg, color: st.fg }}>
                                    {c.company}
                                </span>
                                <span className="text-[11px] text-[#94a3b8]">{c.total}글</span>
                            </div>
                            {c.total === 0 ? (
                                <div className="mt-4 text-center text-[13px] text-[#94a3b8]">발행 전<br /><span className="text-[11px]">발행 시 자동 편입</span></div>
                            ) : (
                                <>
                                    <div className="mt-3 flex items-end gap-3">
                                        <div>
                                            <div className="text-[26px] font-bold leading-none" style={{ color: st.fg }}>{c.best !== null ? `${c.best}위` : '—'}</div>
                                            <div className="mt-1 text-[10px] text-[#9ca3af]">최고 순위</div>
                                        </div>
                                        <div className="ml-auto text-right">
                                            <div className="text-[15px] font-bold text-[#059669]">{c.ranked}<span className="text-[11px] font-normal text-[#94a3b8]">/{c.total}</span></div>
                                            <div className="mt-1 text-[10px] text-[#9ca3af]">인기글 진입</div>
                                        </div>
                                    </div>
                                    <div className="mt-3 border-t border-[#f1f5f9] pt-2">
                                        {c.top.length ? c.top.map((t, i) => (
                                            <div className="flex items-center justify-between py-0.5 text-[12px]" key={i}>
                                                <span className="truncate text-[#475569]">{t.kw}</span>
                                                <span className="ml-2 shrink-0 font-bold" style={{ color: st.fg }}>{t.ti}위</span>
                                            </div>
                                        )) : <div className="py-1 text-[11px] text-[#94a3b8]">인기글 진입 없음</div>}
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
