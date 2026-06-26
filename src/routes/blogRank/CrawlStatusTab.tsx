import { useEffect, useMemo, useRef, useState } from 'react';
import { crawlBlog } from '../../api/crawlBlog';
import { todayKST, type BlogAccount, type BlogPost } from '../../api/blogRank';
import { supabase } from '../../lib/supabase';
import { SameDayModal, type SameDayRow } from './SameDayModal';

type CrawlStatus = {
    updated_at: string;
    running: boolean;
    phase: string | null;
    current_blog: string | null;
    done: number;
    total: number;
};

type Status = 'done' | 'partial' | 'fail' | 'pending';
const LABEL: Record<Status, string> = { done: '완료', partial: '일부 실패', fail: '실패', pending: '대기' };
const COLOR: Record<Status, string> = { done: '#059669', partial: '#d97706', fail: '#dc2626', pending: '#94a3b8' };

// 크롤링 현황 — 오늘 측정 상황을 실시간(자동 새로고침)으로 보여주고, 블로그별 성공/실패를 리스트로.
//   PC 자동 크롤러(매일 05시)가 DB에 쌓는 측정을 폴링해 그대로 보여준다. '전체 측정 시작'은 웹에서 즉시 크롤.
export function CrawlStatusTab({
    accounts,
    posts,
    onReload,
    onToast,
}: {
    accounts: BlogAccount[];
    posts: BlogPost[];
    onReload: () => Promise<void>;
    onToast: (m: string) => void;
}) {
    const today = todayKST();
    const isDone = (a: BlogAccount) =>
        a.goal_count != null && a.remain_count != null && a.goal_count > 0 && a.remain_count === 0;
    // 활성 블로그, 진행 중(계약 미완료) 먼저.
    const active = useMemo(
        () => accounts.filter((a) => a.is_active).sort((x, y) => (isDone(x) ? 1 : 0) - (isDone(y) ? 1 : 0)),
        [accounts],
    );

    // 블로그별 오늘 측정 집계.
    const blogRows = useMemo(() => {
        const agg = new Map<string, { measured: number; tiOk: number; blOk: number; fail: number }>();
        for (const p of posts) {
            const m = p.measurements.find((x) => x.date === today);
            if (!m) continue;
            const s = agg.get(p.blog_account_id) || { measured: 0, tiOk: 0, blOk: 0, fail: 0 };
            s.measured += 1;
            if (m.ti_status === 'fail' || m.bl_status === 'fail') s.fail += 1;
            if (m.ti_status === 'ok') s.tiOk += 1;
            if (m.bl_status === 'ok') s.blOk += 1;
            agg.set(p.blog_account_id, s);
        }
        return active.map((a) => {
            const s = agg.get(a.id) || { measured: 0, tiOk: 0, blOk: 0, fail: 0 };
            const status: Status =
                s.measured === 0 ? 'pending' : s.fail === s.measured ? 'fail' : s.fail > 0 ? 'partial' : 'done';
            return { a, ...s, status };
        });
    }, [posts, active, today]);

    const counts = useMemo(() => {
        const c = { done: 0, partial: 0, fail: 0, pending: 0, posts: 0, tiOk: 0, blOk: 0, failPosts: 0 };
        for (const r of blogRows) {
            c[r.status] += 1;
            c.posts += r.measured;
            c.tiOk += r.tiOk;
            c.blOk += r.blOk;
            c.failPosts += r.fail;
        }
        return c;
    }, [blogRows]);

    // 당일 측정 글 = '오늘 발행(published_date=오늘)'된 글 중 오늘 측정까지 끝난 글. (글 수 / 그 글을 가진 블로그 수)
    const todayLabel = (() => {
        const [, mo, day] = today.split('-');
        return `${Number(mo)}월${Number(day)}일`;
    })();
    const sameDayRows = useMemo<SameDayRow[]>(() => {
        const out: SameDayRow[] = [];
        for (const p of posts) {
            if ((p.published_date || '').slice(0, 10) !== today) continue;
            const m = p.measurements.find((x) => x.date === today);
            if (!m) continue;
            out.push({ post: p, account: accounts.find((a) => a.id === p.blog_account_id) ?? null, m });
        }
        return out;
    }, [posts, today, accounts]);
    const sameDay = {
        posts: sameDayRows.length,
        blogs: new Set(sameDayRows.map((r) => r.post.blog_account_id)).size,
    };
    const [showSameDay, setShowSameDay] = useState(false);

    // ── 자동 새로고침(실시간) ──
    const [auto, setAuto] = useState(true);
    const [lastAt, setLastAt] = useState('');
    const reloadRef = useRef(onReload);
    reloadRef.current = onReload;
    useEffect(() => {
        if (!auto) return;
        const id = window.setInterval(() => {
            void reloadRef.current().then(() => setLastAt(new Date().toLocaleTimeString('ko-KR')));
        }, 15000);
        return () => window.clearInterval(id);
    }, [auto]);

    // ── PC 크롤러 실시간 진행(crawl_status 폴링, 5초) ──
    const [cs, setCs] = useState<CrawlStatus | null>(null);
    const prevDoneRef = useRef(-1);
    useEffect(() => {
        const fetchCs = async () => {
            const { data } = await supabase
                .from('crawl_status')
                .select('updated_at,running,phase,current_blog,done,total')
                .eq('id', 1)
                .maybeSingle();
            const next = (data as CrawlStatus) ?? null;
            setCs(next);
            // 진행(done)이 바뀌면 측정 데이터도 즉시 갱신 → 아래 KPI/칩(완료·실패·대기)/표가 실시간으로 따라감.
            if (next && next.done !== prevDoneRef.current) {
                prevDoneRef.current = next.done;
                void reloadRef.current().then(() => setLastAt(new Date().toLocaleTimeString('ko-KR')));
            }
        };
        void fetchCs();
        const id = window.setInterval(() => void fetchCs(), 5000);
        return () => window.clearInterval(id);
    }, []);
    // 최근 90초 내 업데이트면 '진행 중'으로 본다(크롤이 죽어도 영원히 진행중으로 안 남게).
    // 라이브 판정: 측정 중은 90초, '휴식(분산 청크 사이 갭)'은 갱신이 뜸하므로 30분까지 인정 → 휴식 갭에도 배너 유지.
    const csAge = cs ? Date.now() - new Date(cs.updated_at).getTime() : Infinity;
    const csResting = !!cs && cs.running && cs.phase === 'rest';
    const csLive = !!cs && cs.running && (csAge < 90000 || (csResting && csAge < 1800000));
    const csPct = cs && cs.total ? Math.round((cs.done / cs.total) * 100) : 0;
    // 크롤러가 current_blog 에 실어 보낸 예상 완료시각('완료 ~HH:MM') 파싱.
    const etaStr = (cs?.current_blog || '').match(/완료\s*~\s*(\d{1,2}:\d{2})/)?.[1] || '';

    // 하단 게이지 = '전체 블로그' 진행률(예: 0/64). 청크 단위가 아니라 활성 블로그 전체 중 오늘 측정된 블로그 수.
    //   칩(완료/일부실패/실패)과 동일 소스라 현재 크롤 진행이 그대로 반영됨.
    const measuredBlogs = counts.done + counts.partial + counts.fail;
    const gaugeDone = measuredBlogs;
    const gaugeTotal = active.length;
    const gaugePct = gaugeTotal ? Math.round((gaugeDone / gaugeTotal) * 100) : 0;

    // 상단 게이지 = 라운드로빈 '이번 라운드' 진행. 라운드 N = 전체 블로그의 N번째 최신글을 1개씩 도는 중.
    //   current_blog 형태 '업체명 · 라운드 N' → 업체명/라운드번호 파싱. 이번 라운드에서 몇 블로그 돌았는지 표시.
    const curName = (cs?.current_blog || '').split('·')[0].trim();
    const roundNo = Number((cs?.current_blog || '').match(/라운드\s*(\d+)/)?.[1] || 0);
    const postCountByBlog = new Map<string, number>();
    for (const p of posts) postCountByBlog.set(p.blog_account_id, (postCountByBlog.get(p.blog_account_id) || 0) + 1);
    // 이번 라운드에 참여하는 블로그 = N번째 글이 있는(=총 글 ≥ N) 활성 블로그. 라운드 완료 블로그 = 오늘 N글 이상 측정.
    const roundTotal = roundNo ? active.filter((a) => (postCountByBlog.get(a.id) || 0) >= roundNo).length : 0;
    const roundDone = roundNo ? blogRows.filter((r) => r.measured >= roundNo).length : 0;
    const roundPct = roundTotal ? Math.round((roundDone / roundTotal) * 100) : 0;

    // ── 웹에서 전체 측정(서버리스) ──
    const [running, setRunning] = useState(false);
    const [done, setDone] = useState(0);
    const [currentId, setCurrentId] = useState<string | null>(null);
    const cancelRef = useRef(false);
    const start = async () => {
        if (running || !active.length) return;
        cancelRef.current = false;
        setRunning(true);
        setDone(0);
        for (let i = 0; i < active.length; i += 1) {
            if (cancelRef.current) break;
            const a = active[i];
            setCurrentId(a.id);
            try {
                let r = await crawlBlog(a.id);
                for (let pass = 1; r.postsRemaining > 0 && pass < 6; pass += 1) {
                    if (cancelRef.current) break;
                    r = await crawlBlog(a.id);
                }
            } catch {
                /* 개별 실패는 표에 fail 로 반영됨 */
            }
            setDone(i + 1);
            await onReload(); // 각 블로그 후 갱신 → 표/게이지 실시간 반영
        }
        setCurrentId(null);
        setRunning(false);
        onToast(cancelRef.current ? '측정 중단됨' : '전체 측정 완료');
    };

    const [filter, setFilter] = useState<'all' | Status>('all');
    const shown = filter === 'all' ? blogRows : blogRows.filter((r) => r.status === filter);

    const Card = ({
        label,
        value,
        color,
        sub,
        highlight,
        onClick,
    }: {
        label: string;
        value: number;
        color: string;
        sub?: string;
        highlight?: boolean;
        onClick?: () => void;
    }) => {
        const cls = `rounded-lg px-4 py-3 text-left ${
            highlight
                ? 'border-2 border-[#2563eb] bg-[#eff6ff] shadow-sm ring-1 ring-[#bfdbfe]'
                : 'border border-[#e2e8f0] bg-white'
        } ${onClick ? 'cursor-pointer transition hover:shadow-md hover:ring-2 hover:ring-[#93c5fd]' : ''}`;
        const inner = (
            <>
                <div className={`text-xs ${highlight ? 'font-bold text-[#1e40af]' : 'text-[#64748b]'}`}>{label}</div>
                <div className="mt-0.5 text-2xl font-bold" style={{ color }}>
                    {value}
                </div>
                {sub ? <div className="mt-0.5 text-[11px] font-semibold text-[#2563eb]">{sub}</div> : null}
            </>
        );
        return onClick ? (
            <button className={cls} onClick={onClick} type="button">
                {inner}
            </button>
        ) : (
            <div className={cls}>{inner}</div>
        );
    };
    const Chip = ({ k, label }: { k: 'all' | Status; label: string }) => (
        <button
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
                filter === k ? 'bg-[#1e40af] text-white' : 'bg-[#f1f5f9] text-[#475569] hover:bg-[#e2e8f0]'
            }`}
            onClick={() => setFilter(k)}
            type="button"
        >
            {label}
        </button>
    );

    return (
        <div className="grid gap-4">
            {/* PC 크롤러 실시간 진행 배너 — 측정 중이면 진행률, 청크 사이 '휴식 갭'이면 휴식 안내(차단 예방) */}
            {csLive && cs ? (
                <div
                    className={`rounded-xl border p-4 ${
                        csResting ? 'border-[#fcd34d] bg-[#fffbeb]' : 'border-[#bfdbfe] bg-[#eff6ff]'
                    }`}
                >
                    <div className="mb-1 flex items-center justify-between text-sm">
                        <span className={`font-bold ${csResting ? 'text-[#b45309]' : 'text-[#1e40af]'}`}>
                            <span className="mr-1 animate-pulse">{csResting ? '⏸' : '●'}</span>
                            {csResting
                                ? ` 차단 예방 휴식 중 — ${(cs.current_blog || '').replace(/\s*·\s*완료\s*~\s*\d{1,2}:\d{2}\s*$/, '')}`
                                : roundNo
                                  ? ` 라운드 ${roundNo} 진행 중 · 완료 ${roundNo - 1}회${curName ? ` · 현재: ${curName}` : ''}`
                                  : ` 크롤러 진행 중${curName ? ` · 현재: ${curName}` : ''}`}
                        </span>
                        <span className="font-bold text-[#0f172a]">
                            {etaStr ? <span className="mr-2 font-semibold text-[#7c3aed]">예상 완료 {etaStr}</span> : null}
                            {csResting ? '휴식' : roundNo ? `${roundDone}/${roundTotal} 블로그 · ${roundPct}%` : `${csPct}%`}
                        </span>
                    </div>
                    <div className={`h-3 overflow-hidden rounded-full ${csResting ? 'bg-[#fef3c7]' : 'bg-white'}`}>
                        <div
                            className={`h-full rounded-full transition-all duration-500 ${
                                csResting ? 'animate-pulse bg-[#d97706]' : 'bg-[#1e40af]'
                            }`}
                            style={{ width: `${csResting ? 100 : roundNo ? roundPct : csPct}%` }}
                        />
                    </div>
                </div>
            ) : null}

            {/* 상단: 상태 + 컨트롤 */}
            <div className="flex flex-wrap items-center gap-3">
                <h3 className="m-0 text-base font-bold text-[#0f172a]">크롤링 현황 · {today}</h3>
                <label className="flex items-center gap-1 text-xs text-[#334155]">
                    <input checked={auto} onChange={(e) => setAuto(e.target.checked)} type="checkbox" />
                    실시간 자동 새로고침(15초)
                </label>
                {lastAt ? <span className="text-[11px] text-[#94a3b8]">마지막 갱신 {lastAt}</span> : null}
                <div className="ml-auto flex gap-2">
                    <button
                        className="rounded-md border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                        onClick={() => void onReload().then(() => setLastAt(new Date().toLocaleTimeString('ko-KR')))}
                        type="button"
                    >
                        지금 새로고침
                    </button>
                    {running ? (
                        <button
                            className="rounded-md bg-[#dc2626] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#b91c1c]"
                            onClick={() => {
                                cancelRef.current = true;
                                onToast('현재 블로그까지 마치고 중단합니다…');
                            }}
                            type="button"
                        >
                            중단
                        </button>
                    ) : (
                        <button
                            className="rounded-md bg-[#1e40af] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#1e3a8a] disabled:opacity-50"
                            disabled={!active.length}
                            onClick={() => void start()}
                            title="이 브라우저에서 활성 블로그를 순서대로 즉시 측정(진행 중인 곳부터)"
                            type="button"
                        >
                            전체 측정 시작
                        </button>
                    )}
                </div>
            </div>

            {/* KPI — '지금'(현재 크롤 세션) 기준 실시간 카운트. 측정 수는 crawl_status(이번 run done)로 즉시 반영. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Card label="지금 측정한 글" value={csLive && cs ? cs.done : counts.posts} color="#0f172a" />
                <Card
                    label={`당일 측정 글 (${todayLabel})`}
                    value={sameDay.posts}
                    color="#2563eb"
                    sub={`블로그 ${sameDay.blogs}곳 · 눌러서 목록·발행보고`}
                    highlight
                    onClick={() => setShowSameDay(true)}
                />
                <Card label="통합탭 노출" value={counts.tiOk} color="#059669" />
                <Card label="블로그탭 노출" value={counts.blOk} color="#1e40af" />
                <Card label="실패 글" value={counts.failPosts} color={counts.failPosts ? '#dc2626' : '#94a3b8'} />
            </div>

            {/* 하단 게이지: 전체 블로그 진행률(활성 블로그 중 오늘 측정된 블로그) */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#1e40af]">
                        전체 블로그 {gaugeDone}/{gaugeTotal} 측정 {csLive ? '진행 중' : '완료'}
                        {running && currentId ? (
                            <>
                                {' · '}
                                <span className="animate-pulse">●</span> 측정 중:{' '}
                                <b>{accounts.find((a) => a.id === currentId)?.name || '…'}</b> ({done}/{active.length})
                            </>
                        ) : null}
                    </span>
                    <span className="font-bold text-[#0f172a]">{gaugePct}%</span>
                </div>
                <div className="h-4 overflow-hidden rounded-full bg-[#eef2f7]">
                    <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${gaugePct}%`, background: csLive ? '#1e40af' : gaugePct === 100 ? '#059669' : '#1e40af' }}
                    />
                </div>
            </div>

            {/* 필터 칩 */}
            <div className="flex flex-wrap gap-2">
                <Chip k="all" label={`전체 ${blogRows.length}`} />
                <Chip k="done" label={`완료 ${counts.done}`} />
                <Chip k="partial" label={`일부 실패 ${counts.partial}`} />
                <Chip k="fail" label={`실패 ${counts.fail}`} />
                <Chip k="pending" label={`대기 ${counts.pending}`} />
            </div>

            {/* 블로그별 성공/실패 리스트 */}
            <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">블로그</th>
                            <th className="px-3 py-2 font-semibold">담당</th>
                            <th className="px-3 py-2 text-center font-semibold">측정 글</th>
                            <th className="px-3 py-2 text-center font-semibold text-[#059669]">통합 노출</th>
                            <th className="px-3 py-2 text-center font-semibold text-[#1e40af]">블로그탭 노출</th>
                            <th className="px-3 py-2 text-center font-semibold text-[#dc2626]">실패</th>
                            <th className="px-3 py-2 text-center font-semibold">상태</th>
                        </tr>
                    </thead>
                    <tbody>
                        {shown.length ? (
                            shown.map((r) => (
                                <tr
                                    key={r.a.id}
                                    className={`border-b border-[#e2e8f0] ${
                                        r.a.id === currentId ? 'bg-[#eff6ff]' : ''
                                    }`}
                                >
                                    <td className="px-3 py-2">
                                        <a
                                            className="font-semibold text-[#0f172a] hover:text-[#1e40af] hover:underline"
                                            href={r.a.blog_url}
                                            rel="noreferrer"
                                            target="_blank"
                                        >
                                            {r.a.name}
                                        </a>
                                    </td>
                                    <td className="px-3 py-2 text-xs text-[#64748b]">{r.a.manager || '—'}</td>
                                    <td className="px-3 py-2 text-center text-[#475569]">{r.measured || '—'}</td>
                                    <td className="px-3 py-2 text-center font-semibold text-[#059669]">
                                        {r.tiOk || '—'}
                                    </td>
                                    <td className="px-3 py-2 text-center font-semibold text-[#1e40af]">
                                        {r.blOk || '—'}
                                    </td>
                                    <td className="px-3 py-2 text-center font-semibold text-[#dc2626]">
                                        {r.fail || '—'}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <span
                                            className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                                            style={{ background: `${COLOR[r.status]}1a`, color: COLOR[r.status] }}
                                        >
                                            {LABEL[r.status]}
                                        </span>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={7}>
                                    해당 상태의 블로그가 없습니다.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
            <p className="text-[11px] text-[#94a3b8]">
                PC 자동 크롤러(05시)가 측정하는 동안 이 표가 실시간으로 채워집니다. ‘전체 측정 시작’은 이 브라우저에서
                직접 크롤하며, 창을 닫으면 멈춥니다.
            </p>

            {showSameDay ? (
                <SameDayModal
                    rows={sameDayRows}
                    dayLabel={todayLabel}
                    onClose={() => setShowSameDay(false)}
                    onToast={onToast}
                />
            ) : null}
        </div>
    );
}
