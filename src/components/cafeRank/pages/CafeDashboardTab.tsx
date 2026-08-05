import { useEffect, useMemo, useState } from 'react';
import { getCafeRankPosts, latestCafeMeasure, type CafeRankPost } from '../../../api/cafeRank';
import { getCafeAccounts, type CafeAccount } from '../../../api/cafeAccounts';
import { listActiveDeployTargets, type DeployDashTarget } from '../../../api/cafeDeployRequests';
import { downloadCsv, todayTag } from '../../../lib/exportCsv';
import { latestKwAudit, auditStale, type KwAudit } from '../../../api/cafeKwAudit';

// 누적 발행 글 목록 → 엑셀(CSV).
function exportCumList(board: string, bp: CafeRankPost[], kwOf: (p: CafeRankPost) => string) {
    const headers = ['발행일', '키워드', '제목', '카페/게시판', '현재 순위', '실적'];
    const rows = bp.map((p) => {
        const m = latestCafeMeasure(p.measurements);
        const rankText = !m ? '-' : m.ti_status === 'ok' ? `${m.ti}위` : m.ti_status === 'out' ? '권외' : m.ti_status === 'no_section' ? '측정불가' : '실패';
        const perf = p.top5_achieved_at && !p.top5_seeded ? '실적' : p.top5_seeded ? '기준' : p.top5_since ? '5위 진입' : '-';
        return [p.published_date ?? '', kwOf(p), p.title ?? '', p.cafe_accounts?.display_name || p.cafe_name || '', rankText, perf];
    });
    downloadCsv(`누적발행_${board}_${todayTag()}`, headers, rows);
}

// 카페 · 대시보드 — '오늘 발행 현황'(하루 5건 KPI) + '오늘까지 발행 건'(누적/계약 목표).
//   대상 업체·계약건수는 고정(계약 기준). 글은 cafe_rank_posts.board 로 매칭.
// board=크롤러 저장값 · goal=계약 총건수 · daily=하루 발행 목표(업체별 상이)
const DAILY_TARGETS: { board: string; goal: number; daily: number; kpi?: boolean }[] = [
    { board: '더맨시스템', goal: 50, daily: 5 },
    { board: '더티클리닉', goal: 10, daily: 5 }, // 자체발행 중 — 하루 목표 5건
    { board: '더반클린', goal: 50, daily: 5 },
    { board: '설고점', goal: 40, daily: 1 }, // 설고점만 하루 1건
    { board: '누수상담소', goal: 40, daily: 0, kpi: false }, // 자사 운영 — 오늘 발행 KPI 카드에서 제외(누적 발행엔 유지)
];
const boardKey = (p: CafeRankPost) => p.board || p.cafe_accounts?.board_short || '미분류';
const BOARD_STYLE: Record<string, { bg: string; fg: string }> = {
    더맨시스템: { bg: '#faf5ff', fg: '#7c3aed' },
    더티클리닉: { bg: '#f0fdfa', fg: '#0d9488' },
    더반클린: { bg: '#fdf2f8', fg: '#be185d' },
    설고점: { bg: '#fff7ed', fg: '#c2410c' },
    누수상담소: { bg: '#eff6ff', fg: '#2563eb' },
};

function todayKST(): string {
    const now = new Date();
    return new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000).toISOString().slice(0, 10);
}
const mmdd = (iso: string) => { const [, mo, d] = iso.split('-'); return `${Number(mo)}월 ${Number(d)}일`; };

export function CafeDashboardTab() {
    const [posts, setPosts] = useState<CafeRankPost[]>([]);
    const [accounts, setAccounts] = useState<CafeAccount[]>([]);   // 실적(진행률) 베이스라인 done_count 집계용
    const [deployTargets, setDeployTargets] = useState<DeployDashTarget[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState<Record<string, boolean>>({}); // 업체별 드롭다운 펼침
    const [audit, setAudit] = useState<KwAudit | null>(null);      // 인기탭 스캔 자가점검 결과(이상 시 배너)

    const reload = async () => {
        const [{ data }, accs, dep, au] = await Promise.all([getCafeRankPosts(), getCafeAccounts(), listActiveDeployTargets(), latestKwAudit()]);
        setPosts(data);
        setAccounts(accs.data ?? []);
        setDeployTargets(dep);
        setAudit(au);
        setLoading(false);
    };
    useEffect(() => {
        void reload();
        const iv = setInterval(() => void reload(), 60000);
        return () => clearInterval(iv);
    }, []);

    const today = todayKST();
    // 발행 대상 = 고정업체 + 신규 접수(미션시작일 지난 것만 자동 편입). board 로 중복 제거(고정 우선).
    const targets = useMemo(() => {
        const fixedBoards = new Set(DAILY_TARGETS.map((t) => t.board));
        const seen = new Set<string>();
        const dyn = deployTargets
            .filter((d) => d.board && !fixedBoards.has(d.board) && d.mission_start <= today)
            .filter((d) => (seen.has(d.board) ? false : (seen.add(d.board), true)))
            .map((d) => ({ board: d.board, goal: d.goal, daily: d.daily, kpi: undefined as boolean | undefined }));
        return [...DAILY_TARGETS, ...dyn];
    }, [deployTargets, today]);
    const kw = (p: CafeRankPost) => p.keyword_manual || p.keyword || '—';
    // 오늘 발행(published_date=오늘) · 누적(전체) — board 로 업체 매칭.
    const todayCount = (b: string) => posts.filter((p) => boardKey(p) === b && (p.published_date || '').slice(0, 10) === today).length;
    // 발행 최신순(위=최근). 발행일 desc, 없으면 등록시각 desc.
    const cumList = (b: string) => posts.filter((p) => boardKey(p) === b).sort((x, y) =>
        (y.published_date || '').localeCompare(x.published_date || '')
        || (y.created_at || '').localeCompare(x.created_at || ''));

    // 진행(실적) = 수동 베이스라인(done_count) + 5위 24h 달성(top5_achieved). 관리시트·계약과 동일 기준.
    //   '누적 발행 글 수'(cumList)와 다름 — 계약 진행은 24h 유지 달성분만 +1.
    const achievedCount = (b: string) => posts.filter((p) => boardKey(p) === b && p.top5_achieved_at && !p.top5_seeded).length;
    const baseByBoard = useMemo(() => {
        const m = new Map<string, number>();
        for (const a of accounts) m.set(a.board_short || '', (m.get(a.board_short || '') || 0) + (a.done_count || 0));
        return m;
    }, [accounts]);
    const siljeok = (b: string) => (baseByBoard.get(b) || 0) + achievedCount(b);

    const KPI_TARGETS = targets.filter((t) => t.kpi !== false); // 오늘 발행 KPI 카드 대상(누수상담소=자사 운영 제외)
    const todayTotal = KPI_TARGETS.reduce((s, t) => s + todayCount(t.board), 0);
    const goalTodayTotal = KPI_TARGETS.reduce((s, t) => s + t.daily, 0);
    const cumGrand = targets.reduce((s, t) => s + siljeok(t.board), 0);   // 진행률 = 실적(이전건+24h달성) 합

    if (loading) {
        return <div className="rounded-xl border border-[#e2e8f0] bg-white px-6 py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>;
    }

    return (
        <div className="grid gap-4">
            {/* 인기탭 스캔 자가점검 경고 — 누락·오탐·차단을 사람이 눈치채기 전에 여기서 알린다.
                정상이면 아무것도 띄우지 않는다(테이블 없으면 조용히 숨김). */}
            {audit && (!audit.ok || auditStale(audit)) ? (
                <div className={`rounded-lg border p-3 text-[13px] ${audit.status === 'blocked'
                    ? 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]' : 'border-[#fecaca] bg-[#fef2f2] text-[#991b1b]'}`}>
                    <b>
                        {auditStale(audit) ? '⚠ 인기탭 스캔 자가점검이 하루 넘게 안 돌았습니다'
                            : audit.status === 'blocked' ? '⚠ 인기탭 스캔 점검 불가 (차단)'
                                : '🚨 인기탭 스캔 이상 감지'}
                    </b>
                    <div className="mt-1">{audit.summary}</div>
                    {(audit.alerts ?? []).map((a, i) => <div key={i} className="mt-0.5">· {a}</div>)}
                    <div className="mt-1 text-[11px] opacity-70">
                        점검 시각 {new Date(audit.run_at).toLocaleString('ko-KR')}
                        {audit.status === 'blocked' ? ' · 스캔이 몰린 시간대일 수 있습니다. 잠시 후 다시 점검하면 해소됩니다.' : ''}
                    </div>
                </div>
            ) : null}
            <div>
                <h2 className="m-0 text-base font-bold text-[#0f172a]">카페 · 오늘 발행 현황</h2>
                <p className="m-0 mt-0.5 text-xs text-[#64748b]">{mmdd(today)} · 업체별 하루 목표 발행 체크(설고점=1건, 그 외 5건) · 발행 시 자동 집계 · 60초 자동 갱신</p>
            </div>

            {/* 업체별 오늘 발행 KPI (누수상담소=자사 운영 제외) */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                {KPI_TARGETS.map((t) => {
                    const done = todayCount(t.board);
                    const st = BOARD_STYLE[t.board] || { bg: '#f8fafc', fg: '#475569' };
                    const off = t.daily === 0; // 일일 발행 안 하는 업체
                    const complete = !off && done >= t.daily;
                    const box = off ? 'border-2 border-[#e2e8f0] bg-[#f8fafc] opacity-70' : complete ? 'border-2 border-[#16a34a] bg-[#f0fdf4]' : done > 0 ? 'border-2 border-[#eab308] bg-[#fefce8]' : 'border-2 border-[#e2e8f0] bg-white';
                    return (
                        <div className={`rounded-xl p-4 ${box}`} key={t.board}>
                            <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: st.bg, color: st.fg }}>{t.board}</span>
                            <div className="mt-2 flex items-end gap-1">
                                <span className={`text-[28px] font-bold leading-none ${complete ? 'text-[#15803d]' : done > 0 ? 'text-[#a16207]' : 'text-[#94a3b8]'}`}>{done}</span>
                                <span className="mb-0.5 text-[13px] font-semibold text-[#94a3b8]">/ {t.daily}</span>
                            </div>
                            <div className={`mt-1 text-[11px] font-bold ${off ? 'text-[#94a3b8]' : complete ? 'text-[#15803d]' : 'text-[#b45309]'}`}>{off ? '미진행' : complete ? '✓ 완료' : `${t.daily - done}건 남음`}</div>
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
                <div className="mb-2 text-[14px] font-bold text-[#0f172a]">진행 (실적 기준) <span className="text-[12px] font-normal text-[#94a3b8]">{cumGrand}건</span><span className="ml-1 text-[11px] font-normal text-[#cbd5e1]">· 실적 = 이전건 + 5위 24h 달성(24h+1)</span></div>
                <div className="grid gap-2">
                    {targets.map((t) => {
                        const bp = cumList(t.board);
                        const pubN = bp.length + (baseByBoard.get(t.board) || 0);   // 실제 발행 = 트래커글 + 이전건(마이클카페 등)
                        const done = siljeok(t.board);        // 실적 = 이전건 + 24h 달성 (진행률 기준)
                        const okey = `cum:${t.board}`;
                        const isOpen = !!open[okey];
                        const st = BOARD_STYLE[t.board] || { bg: '#f8fafc', fg: '#475569' };
                        const complete = done >= t.goal;
                        return (
                            <div className="rounded-lg border border-[#eef0f2]" key={t.board}>
                                <button type="button" onClick={() => setOpen((o) => ({ ...o, [okey]: !o[okey] }))}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f8fafc]" disabled={bp.length === 0}>
                                    <span className={`text-[9px] text-[#94a3b8] transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                                    <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: st.bg, color: st.fg }}>{t.board}</span>
                                    <span className="rounded-full bg-[#eff6ff] px-1.5 py-0.5 text-[10px] font-bold text-[#2563eb]">실적</span>
                                    <span className="text-[13px] font-bold text-[#2563eb]" title="실적 = 이전건 + 5위 24h 달성(24h+1)">{done}건</span>
                                    <span className="text-[11px] font-semibold text-[#94a3b8]" title="계약 총 발행건수(목표)">/ 총 {t.goal}건</span>
                                    {complete ? <span className="text-[11px] font-bold text-[#15803d]">✓ 완료</span> : null}
                                    <span className="ml-auto text-[11px] text-[#94a3b8]" title="실제 발행한 글 수">발행 {pubN}건</span>
                                </button>
                                {isOpen && bp.length ? (
                                    <div className="overflow-x-auto border-t border-[#eef0f2] px-3 py-2">
                                        <div className="mb-2 flex justify-end">
                                            <button type="button" onClick={() => exportCumList(t.board, bp, kw)}
                                                className="rounded-md border border-[#16a34a] px-2.5 py-1 text-[11px] font-bold text-[#15803d] hover:bg-[#f0fdf4]">
                                                엑셀 다운로드
                                            </button>
                                        </div>
                                        <table className="w-full min-w-[720px] border-collapse text-[13px]">
                                            <thead>
                                                <tr className="border-b border-[#f1f5f9] text-left text-[#94a3b8]">
                                                    {['발행일', '키워드', '제목', '카페/게시판', '현재 순위', '실적'].map((h) => <th key={h} className="px-2 py-1 font-semibold">{h}</th>)}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {bp.map((p) => {
                                                    const m = latestCafeMeasure(p.measurements);
                                                    const rankText = !m ? '-' : m.ti_status === 'ok' ? `${m.ti}위` : m.ti_status === 'out' ? '권외' : m.ti_status === 'no_section' ? '측정불가' : '실패';
                                                    const rankCls = m?.ti_status === 'ok' ? (m.ti <= 5 ? 'font-bold text-[#166534]' : 'text-[#334155]') : 'text-[#94a3b8]';
                                                    const achieved = p.top5_achieved_at && !p.top5_seeded;
                                                    return (
                                                        <tr key={p.id} className="border-b border-[#f8fafc] align-top text-[#334155]">
                                                            <td className="whitespace-nowrap px-2 py-1.5 text-[12px] text-[#64748b]">{p.published_date ?? '—'}</td>
                                                            <td className="whitespace-nowrap px-2 py-1.5 font-semibold">{kw(p)}</td>
                                                            <td className="max-w-[280px] truncate px-2 py-1.5" title={p.title ?? ''}>{p.title ?? '—'}</td>
                                                            <td className="whitespace-nowrap px-2 py-1.5 text-[12px] text-[#64748b]">{p.cafe_accounts?.display_name || p.cafe_name || '—'}</td>
                                                            <td className={`whitespace-nowrap px-2 py-1.5 ${rankCls}`}>{rankText}</td>
                                                            <td className="whitespace-nowrap px-2 py-1.5">
                                                                {achieved ? <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[11px] font-bold text-[#166534]">✓ 실적</span>
                                                                    : p.top5_seeded ? <span className="rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-semibold text-[#94a3b8]">기준</span>
                                                                    : p.top5_since ? <span className="text-[11px] text-[#b45309]">5위 진입</span>
                                                                    : <span className="text-[11px] text-[#cbd5e1]">-</span>}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
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
