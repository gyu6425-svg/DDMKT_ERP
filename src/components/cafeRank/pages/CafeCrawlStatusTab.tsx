import { useEffect, useMemo, useState } from 'react';
import { getCafeRankPosts, type CafeRankPost } from '../../../api/cafeRank';

// 카페 · 크롤링 현황 — 업체(게시판)별 '오늘 측정' 진행·순위 요약을 실시간으로. 60초마다 자동 새로고침.
//   측정은 PC(cafe_rank_crawler / cafe_periodic)가 기록 → 이 화면은 그 결과를 집계만.
const BOARD_ORDER = ['누수', '더티클리닉', '설고점', '더맨시스템'];
const boardKey = (p: CafeRankPost) => p.board || p.cafe_accounts?.board_short || '미분류';
const companyName = (p: CafeRankPost) => p.cafe_accounts?.display_name || boardKey(p);
const boardRank = (b: string) => {
    const i = BOARD_ORDER.indexOf(b);
    return i >= 0 ? i : b === '미분류' ? 999 : 500;
};
const BOARD_FG: Record<string, string> = { 누수: '#1d4ed8', 더티클리닉: '#0d9488', 설고점: '#c2410c', 더맨시스템: '#7c3aed' };

function todayKST(): string {
    const now = new Date();
    return new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000).toISOString().slice(0, 10);
}

type Stat = {
    board: string;
    company: string;
    total: number;
    measuredToday: number;
    ranked: number; // ok
    out: number;
    noSection: number;
    best: number | null;
    pending: number; // 오늘 미측정
};

export function CafeCrawlStatusTab() {
    const [posts, setPosts] = useState<CafeRankPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [refreshedAt, setRefreshedAt] = useState<string>('');

    const reload = async () => {
        const { data, error } = await getCafeRankPosts();
        if (error) setErr(error.message || '조회 실패');
        else { setErr(''); setPosts(data); }
        setLoading(false);
        setRefreshedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    useEffect(() => {
        void reload();
        const iv = setInterval(() => void reload(), 60000); // 실시간: 60초마다 자동 갱신
        return () => clearInterval(iv);
    }, []);

    const today = todayKST();
    const stats = useMemo<Stat[]>(() => {
        const map = new Map<string, CafeRankPost[]>();
        for (const p of posts) {
            const b = boardKey(p);
            (map.get(b) || map.set(b, []).get(b)!).push(p);
        }
        for (const b of BOARD_ORDER) if (!map.has(b)) map.set(b, []);
        const out: Stat[] = [];
        for (const [b, ps] of map) {
            let measured = 0, ranked = 0, oo = 0, ns = 0, pending = 0, best: number | null = null;
            for (const p of ps) {
                const last = p.measurements?.[p.measurements.length - 1];
                if (last && last.date === today) {
                    measured += 1;
                    if (last.ti_status === 'ok') { ranked += 1; best = best === null ? last.ti : Math.min(best, last.ti); }
                    else if (last.ti_status === 'out') oo += 1;
                    else if (last.ti_status === 'no_section') ns += 1;
                } else pending += 1;
            }
            out.push({ board: b, company: ps[0] ? companyName(ps[0]) : b, total: ps.length, measuredToday: measured, ranked, out: oo, noSection: ns, best, pending });
        }
        return out.sort((a, b) => boardRank(a.board) - boardRank(b.board) || a.board.localeCompare(b.board));
    }, [posts, today]);

    const totals = useMemo(() => {
        const t = { total: 0, measured: 0, ranked: 0, pending: 0 };
        for (const s of stats) { t.total += s.total; t.measured += s.measuredToday; t.ranked += s.ranked; t.pending += s.pending; }
        return t;
    }, [stats]);

    return (
        <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <div>
                    <h2 className="m-0 text-base font-bold text-[#0f172a]">카페 · 크롤링 현황</h2>
                    <p className="m-0 mt-0.5 text-xs text-[#64748b]">
                        업체별 오늘({today}) 측정 진행·순위 요약. PC 크롤러/주기측정기 결과 · 60초마다 자동 갱신
                    </p>
                </div>
                <span className="ml-auto text-[11px] text-[#94a3b8]">{refreshedAt ? `갱신 ${refreshedAt}` : ''}</span>
                <button
                    className="h-8 rounded-md border border-[#cbd5e1] bg-white px-3 text-xs font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                    onClick={() => void reload()}
                    type="button"
                >새로고침</button>
            </div>

            {err ? <div className="rounded-md bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]">{err}</div> : null}

            {/* 전체 요약 카드 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                    { label: '추적 글', value: totals.total, note: `${stats.filter((s) => s.total > 0).length}개 업체` },
                    { label: '오늘 측정', value: `${totals.measured}/${totals.total}`, note: totals.pending ? `대기 ${totals.pending}` : '완료' },
                    { label: '순위내(인기글)', value: totals.ranked, note: '섹션 진입' },
                    { label: '측정 대기', value: totals.pending, note: totals.pending ? '다음 주기 측정' : '없음' },
                ].map((c) => (
                    <div className="rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3" key={c.label}>
                        <span className="block text-xs font-medium text-[#6b7280]">{c.label}</span>
                        <strong className="mt-1 block text-[22px] font-semibold text-[#111111]">{c.value}</strong>
                        <span className="mt-0.5 block text-[11px] text-[#9ca3af]">{c.note}</span>
                    </div>
                ))}
            </div>

            {/* 업체별 현황 표 */}
            <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">업체(게시판)</th>
                            <th className="px-3 py-2 text-center font-semibold">추적 글</th>
                            <th className="px-3 py-2 text-center font-semibold">오늘 측정</th>
                            <th className="px-3 py-2 text-center font-bold text-[#059669]">순위내</th>
                            <th className="px-3 py-2 text-center font-semibold">권외</th>
                            <th className="px-3 py-2 text-center font-semibold">측정불가</th>
                            <th className="px-3 py-2 text-center font-semibold">최고 순위</th>
                            <th className="px-3 py-2 text-center font-semibold">측정 대기</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={8}>불러오는 중…</td></tr>
                        ) : (
                            stats.map((s) => (
                                <tr className="border-b border-[#e2e8f0] last:border-b-0" key={s.board}>
                                    <td className="px-3 py-2 font-semibold" style={{ color: BOARD_FG[s.board] || '#475569' }}>
                                        {s.company}
                                        {s.company !== s.board ? <span className="ml-1 text-[10px] font-normal text-[#94a3b8]">{s.board}</span> : null}
                                    </td>
                                    <td className="px-3 py-2 text-center text-[#475569]">{s.total || '—'}</td>
                                    <td className="px-3 py-2 text-center text-[#475569]">
                                        {s.total ? `${s.measuredToday}/${s.total}` : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-center font-bold text-[#059669]">{s.ranked || (s.total ? 0 : '—')}</td>
                                    <td className="px-3 py-2 text-center text-[#64748b]">{s.total ? s.out : '—'}</td>
                                    <td className="px-3 py-2 text-center text-[#94a3b8]">{s.total ? s.noSection : '—'}</td>
                                    <td className="px-3 py-2 text-center font-semibold text-[#0f172a]">{s.best !== null ? `${s.best}위` : '—'}</td>
                                    <td className="px-3 py-2 text-center">
                                        {s.pending ? <span className="rounded bg-[#fef3c7] px-1.5 py-0.5 text-[11px] font-semibold text-[#b45309]">{s.pending}</span> : <span className="text-[#cbd5e1]">0</span>}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <p className="m-0 text-[11px] leading-5 text-[#9ca3af]">
                ※ 측정 = 네이버 통합검색 인기글 테마 섹션 내 순위. ‘측정 대기’는 발행됐지만 아직 이번 주기에 안 잰 글(신규는 30분 내 자동 측정).
                더티클리닉은 발행이 시작되면 자동으로 편입됩니다.
            </p>
        </div>
    );
}
