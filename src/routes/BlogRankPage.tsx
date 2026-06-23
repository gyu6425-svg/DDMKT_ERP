import { useEffect, useMemo, useState } from 'react';
import {
    deleteBlogAccount,
    extractBlogId,
    getBlogAccounts,
    getBlogPosts,
    insertBlogAccounts,
    updateBlogAccount,
    updatePostKeyword,
    updatePostMeasurements,
    todayKST,
    extractLogNo,
    type BlogAccount,
    type BlogMeasurement,
    type BlogPost,
    type WebMeasurement,
} from '../api/blogRank';
import { crawlBlog } from '../api/crawlBlog';
import { searchRank, type RankSearchResult } from '../api/rankSearch';
import { useAuth } from '../hooks/useAuth';
import BlogPage from './BlogPage';

type Tab = 'dashboard' | 'sheet' | 'tracker' | 'writer';

const PER_SHEET = 20;
const PER_FEED = 30;

function lastM(post: BlogPost) {
    return post.measurements.length ? post.measurements[post.measurements.length - 1] : null;
}
function prevM(post: BlogPost) {
    return post.measurements.length >= 2
        ? post.measurements[post.measurements.length - 2]
        : null;
}
function progOf(account: BlogAccount): number | null {
    if (account.goal_count == null || account.remain_count == null || account.goal_count === 0) {
        return null;
    }
    return Math.round(((account.goal_count - account.remain_count) / account.goal_count) * 100);
}
function dayN(post: BlogPost): number {
    if (!post.published_date) {
        return post.measurements.length ? post.measurements.length - 1 : 0;
    }
    const diff = Date.now() - new Date(post.published_date).getTime();
    return Math.max(0, Math.floor(diff / 86400000));
}

// ── 웹사이트(회사 단위) 헬퍼 ──
function lastWe(account: BlogAccount): WebMeasurement | null {
    const w = account.website_measurements;
    return w && w.length ? w[w.length - 1] : null;
}
function prevWe(account: BlogAccount): WebMeasurement | null {
    const w = account.website_measurements;
    return w && w.length >= 2 ? w[w.length - 2] : null;
}

function BlogRankPage() {
    const { isAdmin, loading: authLoading } = useAuth();
    const [accounts, setAccounts] = useState<BlogAccount[]>([]);
    const [posts, setPosts] = useState<BlogPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // 탭을 URL 쿼리(?tab=)에 저장 → 새로고침해도 현재 탭 유지.
    const [tab, setTab] = useState<Tab>(() => {
        const t = new URLSearchParams(window.location.search).get('tab');
        return t === 'sheet' || t === 'tracker' || t === 'writer' ? t : 'dashboard';
    });
    const [toast, setToast] = useState('');

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (tab === 'dashboard') {
            params.delete('tab');
        } else {
            params.set('tab', tab);
        }
        const qs = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }, [tab]);

    const showToast = (message: string) => {
        setToast(message);
        window.setTimeout(() => setToast(''), 2200);
    };

    const load = async () => {
        setLoading(true);
        setError('');
        const [accRes, postRes] = await Promise.all([getBlogAccounts(), getBlogPosts()]);
        if (accRes.error || postRes.error) {
            setError(
                (accRes.error || postRes.error)?.message ||
                    '데이터를 불러오지 못했습니다. blog-rank-tables.sql 실행을 확인하세요.',
            );
            setLoading(false);
            return;
        }
        setAccounts(accRes.data);
        setPosts(postRes.data);
        setLoading(false);
    };

    const isAllowed = !authLoading && isAdmin;

    useEffect(() => {
        if (isAllowed) {
            void load();
        }
    }, [isAllowed]);

    // 관리자 전용 페이지
    if (!authLoading && !isAdmin) {
        return (
            <section className="grid place-items-center py-24 text-center">
                <div>
                    <h2 className="m-0 text-lg font-bold text-[#0f172a]">관리자 전용 페이지</h2>
                    <p className="mt-2 text-sm text-[#64748b]">
                        블로그 대시보드는 관리자 계정만 접근할 수 있습니다.
                    </p>
                </div>
            </section>
        );
    }

    return (
        <section className="grid gap-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">블로그 대시보드</h2>
                    <p className="mt-1 mb-0 text-sm text-[#64748b]">
                        블로그 발행 관리 + 네이버 순위 추적{' '}
                        {loading ? '· 불러오는 중...' : `· 블로그 ${accounts.length}개 · 추적 글 ${posts.length}건`}
                    </p>
                </div>
                <button
                    className="inline-flex h-10 items-center justify-center rounded-md bg-[#1e40af] px-4 text-sm font-semibold text-white"
                    onClick={() => void load()}
                    type="button"
                >
                    새로고침
                </button>
            </div>

            {error ? (
                <p className="m-0 rounded-md bg-[#fee2e2] px-4 py-3 text-sm text-[#dc2626]">{error}</p>
            ) : null}

            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {(
                    [
                        ['dashboard', '대시보드'],
                        ['sheet', '블로그 관리 시트'],
                        ['tracker', '순위 트래커'],
                        ['writer', '블로그 작성기'],
                    ] as const
                ).map(([key, label]) => (
                    <button
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                            tab === key
                                ? 'border-[#1e40af] text-[#1e40af]'
                                : 'border-transparent text-[#94a3b8]'
                        }`}
                        key={key}
                        onClick={() => setTab(key)}
                        type="button"
                    >
                        {label}
                    </button>
                ))}
            </div>

            {tab === 'dashboard' ? (
                <DashboardTab accounts={accounts} posts={posts} onGo={setTab} />
            ) : null}
            {tab === 'sheet' ? (
                <SheetTab
                    accounts={accounts}
                    posts={posts}
                    onReload={load}
                    onToast={showToast}
                    onGoTracker={() => setTab('tracker')}
                />
            ) : null}
            {tab === 'tracker' ? (
                <TrackerTab accounts={accounts} posts={posts} onReload={load} />
            ) : null}
            {tab === 'writer' ? <BlogPage /> : null}

            {toast ? (
                <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-[#0f172a] px-5 py-2.5 text-sm font-medium text-white shadow-lg">
                    {toast}
                </div>
            ) : null}
        </section>
    );
}

// ───────────────────────── 대시보드 ─────────────────────────
function DashboardTab({
    accounts,
    posts,
    onGo,
}: {
    accounts: BlogAccount[];
    posts: BlogPost[];
    onGo: (tab: Tab) => void;
}) {
    const withGoal = accounts.filter((a) => a.goal_count != null && a.remain_count != null);
    const done = withGoal.reduce((s, a) => s + ((a.goal_count || 0) - (a.remain_count || 0)), 0);
    const goal = withGoal.reduce((s, a) => s + (a.goal_count || 0), 0);
    const measured = posts.filter((p) => p.measurements.length);
    const inTen = measured.filter((p) => (lastM(p)?.ti ?? 99) <= 10).length;
    const lowCnt = accounts.filter((a) => a.remain_count != null && a.remain_count <= 3 && a.is_active).length;
    const stopCnt = accounts.filter((a) => !a.is_active).length;

    const attn = accounts
        .filter((a) => (a.remain_count != null && a.remain_count <= 3 && a.is_active) || !a.is_active)
        .map((a) => ({
            account: a,
            label: !a.is_active ? '중단' : '재계약',
            tag: !a.is_active ? 'stop' : 'low',
            why: !a.is_active ? a.note || '진행 중단' : `잔여 ${a.remain_count}건 · 재계약 시점 임박`,
        }));

    const moves = posts
        .filter((p) => p.measurements.length >= 2)
        .map((p) => ({ p, d: (prevM(p)?.ti ?? 0) - (lastM(p)?.ti ?? 0) }))
        .filter((x) => x.d !== 0)
        .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
        .slice(0, 6);

    // 웹사이트(업체 기준) 지표 — 글 단위 KPI 와 모수가 다르므로 별도 섹션으로 분리.
    const webTracked = accounts.filter((a) => a.website_url && a.rep_keyword);
    const webMeasured = webTracked.filter((a) => lastWe(a));
    const webExposed = webMeasured.filter((a) => lastWe(a)?.status === 'ok').length;
    const webIn10 = webMeasured.filter((a) => {
        const m = lastWe(a);
        return m?.status === 'ok' && m.we <= 10;
    }).length;

    return (
        <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label="관리 블로그" value={`${accounts.length}`} sub={`진행 ${accounts.length - stopCnt} · 중단 ${stopCnt}`} />
                <Kpi
                    label="전체 진행률"
                    value={goal ? `${Math.round((done / goal) * 100)}%` : '—'}
                    accent="#1e40af"
                    sub={`발행 ${done} / 계약 ${goal}건`}
                />
                <Kpi
                    label="통합탭 10위 이내"
                    value={measured.length ? `${inTen}` : '—'}
                    accent="#059669"
                    sub={measured.length ? `측정 ${measured.length}건 중` : '크롤링 후 계산'}
                />
                <Kpi
                    label="잔여 3건 이하"
                    value={`${lowCnt}`}
                    accent={lowCnt ? '#d97706' : undefined}
                    sub="재계약 영업 타이밍"
                />
            </div>

            <Panel
                title="웹사이트 노출 (업체 기준)"
                sub="통합검색 '웹사이트' 섹션 · webkr API 추정값이라 신뢰도 낮음"
            >
                {webTracked.length ? (
                    <div className="grid grid-cols-3 gap-3">
                        <Kpi
                            label="추적 업체"
                            value={`${webTracked.length}`}
                            sub={`측정 ${webMeasured.length}개`}
                        />
                        <Kpi
                            label="노출 중"
                            value={`${webExposed}`}
                            accent="#7c3aed"
                            sub="웹사이트 섹션 내 노출"
                        />
                        <Kpi
                            label="10위 이내"
                            value={`${webIn10}`}
                            accent="#7c3aed"
                            sub="업체 기준"
                        />
                    </div>
                ) : (
                    <Empty text="아직 웹사이트 추적 업체가 없습니다 · '블로그 관리 시트' 탭에서 업체 '편집' → 회사 홈페이지·대표키워드를 등록하세요" />
                )}
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="오늘 챙겨야 할 블로그" sub="잔여 임박 · 진행 중단">
                    {attn.length ? (
                        <div className="grid gap-1">
                            {attn.map(({ account, label, tag, why }) => (
                                <button
                                    className="flex items-center justify-between rounded-md px-2 py-2 text-left hover:bg-[#f8fafc]"
                                    key={account.id}
                                    onClick={() => onGo('sheet')}
                                    type="button"
                                >
                                    <span className="min-w-0">
                                        <span className="block text-sm font-semibold">{account.name}</span>
                                        <span className="block truncate text-xs text-[#94a3b8]">{why}</span>
                                    </span>
                                    <Tag kind={tag as 'stop' | 'low'}>{label}</Tag>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <Empty text="지금은 챙길 블로그가 없어요" />
                    )}
                </Panel>

                <Panel title="최근 순위 변동" sub="이전 대비 통합탭 순위 변화">
                    {moves.length ? (
                        <div className="grid gap-1">
                            {moves.map(({ p, d }) => (
                                <div
                                    className="flex items-center justify-between rounded-md px-2 py-2"
                                    key={p.id}
                                >
                                    <span className="min-w-0">
                                        <span className="block truncate text-xs font-semibold">
                                            {(p.title || '제목 없음').slice(0, 32)}
                                        </span>
                                        <span className="block text-xs text-[#94a3b8]">#{p.keyword || '-'}</span>
                                    </span>
                                    <span className="flex items-center gap-2 whitespace-nowrap">
                                        <span className="text-sm font-bold">{lastM(p)?.ti}위</span>
                                        <span
                                            className="text-xs font-bold"
                                            style={{ color: d > 0 ? '#dc2626' : '#1e40af' }}
                                        >
                                            {d > 0 ? `▲${d}` : `▼${Math.abs(d)}`}
                                        </span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Empty text="측정이 2회 이상이면 변동이 표시됩니다" />
                    )}
                </Panel>
            </div>
        </div>
    );
}

// ───────────────────────── 관리 시트 ─────────────────────────
function SheetTab({
    accounts,
    posts,
    onReload,
    onToast,
    onGoTracker,
}: {
    accounts: BlogAccount[];
    posts: BlogPost[];
    onReload: () => Promise<void>;
    onToast: (message: string) => void;
    onGoTracker: () => void;
}) {
    const [q, setQ] = useState('');
    const [mgr, setMgr] = useState('');
    const [lowOnly, setLowOnly] = useState(false);
    const [sortKey, setSortKey] = useState<'remain' | 'prog'>('remain');
    const [sortDir, setSortDir] = useState(1);
    const [page, setPage] = useState(1);
    const [importOpen, setImportOpen] = useState(false);
    const [editAcc, setEditAcc] = useState<BlogAccount | null>(null);
    const [noteAcc, setNoteAcc] = useState<BlogAccount | null>(null);
    const [crawlingId, setCrawlingId] = useState<string | null>(null);

    // 서버리스 즉시 크롤 — 터미널 없이 이 블로그의 RSS+순위 측정·기록.
    const doCrawl = async (a: BlogAccount) => {
        setCrawlingId(a.id);
        onToast(`${a.name} 측정 중...`);
        try {
            const r = await crawlBlog(a.id);
            await onReload();
            const errNote = r.errors?.length ? ` (${r.errors.join(', ')})` : '';
            onToast(`${a.name} 측정 완료 · 글 ${r.postsMeasured} · 키워드 ${r.keywordsMeasured}${errNote}`);
        } catch (e) {
            onToast(`측정 실패: ${e instanceof Error ? e.message : ''}`);
        } finally {
            setCrawlingId(null);
        }
    };

    const [bulkBusy, setBulkBusy] = useState(false);
    // 일괄삭제 — 현재 표(필터 적용)에 보이는 업체를 한 번에 삭제(측정 이력 포함). 되돌릴 수 없음.
    const bulkDelete = async () => {
        const targets = filtered;
        if (!targets.length || bulkBusy) {
            return;
        }
        if (
            !window.confirm(
                `현재 목록의 ${targets.length}개 업체를 모두 삭제할까요?\n측정 이력까지 함께 삭제되며 되돌릴 수 없습니다.`,
            )
        ) {
            return;
        }
        setBulkBusy(true);
        onToast(`${targets.length}개 삭제 중...`);
        let failed = 0;
        for (const a of targets) {
            const { error } = await deleteBlogAccount(a.id);
            if (error) failed += 1;
        }
        await onReload();
        setBulkBusy(false);
        onToast(`삭제 완료 · ${targets.length - failed}개${failed ? ` (실패 ${failed})` : ''}`);
    };

    const [bulkCrawlBusy, setBulkCrawlBusy] = useState(false);
    const [crawlDone, setCrawlDone] = useState<{ ok: number; failed: number } | null>(null);
    // 전체 측정 — 현재 표(필터 적용)에 보이는 업체를 위에서부터 차례로 즉시 크롤(RSS+순위 측정).
    const bulkCrawl = async () => {
        const targets = filtered;
        if (!targets.length || bulkCrawlBusy) {
            return;
        }
        if (
            !window.confirm(
                `현재 목록의 ${targets.length}개 업체를 모두 측정할까요?\n순서대로 진행되며 시간이 다소 걸릴 수 있습니다.`,
            )
        ) {
            return;
        }
        setBulkCrawlBusy(true);
        let done = 0;
        let failed = 0;
        for (const a of targets) {
            setCrawlingId(a.id);
            onToast(`전체 측정 중... (${done + 1}/${targets.length}) ${a.name}`);
            try {
                await crawlBlog(a.id);
            } catch {
                failed += 1;
            }
            done += 1;
        }
        setCrawlingId(null);
        await onReload();
        setBulkCrawlBusy(false);
        setCrawlDone({ ok: done - failed, failed });
    };

    const managers = useMemo(
        () => [...new Set(accounts.map((a) => a.manager).filter(Boolean))] as string[],
        [accounts],
    );

    const postCountOf = (id: string) => posts.filter((p) => p.blog_account_id === id);

    const filtered = useMemo(() => {
        let list = accounts.filter(
            (a) =>
                (!q || a.name.includes(q)) &&
                (!mgr || a.manager === mgr) &&
                (!lowOnly || (a.remain_count != null && a.remain_count <= 3)),
        );
        list = [...list].sort((x, y) => {
            if (sortKey === 'prog') {
                return ((progOf(x) ?? -1) - (progOf(y) ?? -1)) * sortDir;
            }
            return ((x.remain_count ?? 999) - (y.remain_count ?? 999)) * sortDir;
        });
        return list;
    }, [accounts, q, mgr, lowOnly, sortKey, sortDir]);

    const pages = Math.max(1, Math.ceil(filtered.length / PER_SHEET));
    const current = Math.min(page, pages);
    const pageRows = filtered.slice((current - 1) * PER_SHEET, current * PER_SHEET);

    const toggleSort = (key: 'remain' | 'prog') => {
        if (sortKey === key) {
            setSortDir((d) => -d);
        } else {
            setSortKey(key);
            setSortDir(1);
        }
    };

    return (
        <div className="grid gap-3">
            {crawlDone ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#a7f3d0] bg-[#ecfdf5] px-4 py-3">
                    <span className="text-lg">✅</span>
                    <div className="mr-auto">
                        <div className="text-sm font-bold text-[#065f46]">자동 측정이 완료되었습니다</div>
                        <div className="text-xs text-[#047857]">
                            {crawlDone.ok}개 측정 완료
                            {crawlDone.failed ? ` · 실패 ${crawlDone.failed}개` : ''} · 순위 트래커에서 결과를
                            확인하세요
                        </div>
                    </div>
                    <button
                        className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md bg-[#059669] px-4 text-sm font-semibold text-white"
                        onClick={() => {
                            setCrawlDone(null);
                            onGoTracker();
                        }}
                        type="button"
                    >
                        순위 트래커 보러가기
                    </button>
                    <button
                        aria-label="닫기"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[#047857] hover:bg-[#d1fae5]"
                        onClick={() => setCrawlDone(null)}
                        type="button"
                    >
                        ✕
                    </button>
                </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
                <input
                    className="h-9 min-w-[180px] flex-1 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                    onChange={(e) => {
                        setQ(e.target.value);
                        setPage(1);
                    }}
                    placeholder="업체명 검색..."
                    value={q}
                />
                <select
                    className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-xs"
                    onChange={(e) => {
                        setMgr(e.target.value);
                        setPage(1);
                    }}
                    value={mgr}
                >
                    <option value="">담당 전체</option>
                    {managers.map((m) => (
                        <option key={m}>{m}</option>
                    ))}
                </select>
                <label className="flex items-center gap-1 text-xs text-[#334155]">
                    <input checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} type="checkbox" />
                    잔여 3건 이하만
                </label>
                <span className="ml-auto text-xs text-[#64748b]">{filtered.length}개</span>
                <button
                    className="inline-flex h-9 items-center rounded-md bg-[#1e40af] px-3 text-xs font-semibold text-white"
                    onClick={() => setImportOpen(true)}
                    type="button"
                >
                    시트 붙여넣기 등록
                </button>
                <button
                    className="inline-flex h-9 items-center rounded-md bg-[#059669] px-3 text-xs font-semibold text-white hover:bg-[#047857] disabled:opacity-50"
                    disabled={bulkCrawlBusy || bulkBusy || filtered.length === 0}
                    onClick={() => void bulkCrawl()}
                    title="현재 목록의 모든 업체를 위에서부터 차례로 측정"
                    type="button"
                >
                    {bulkCrawlBusy ? '측정 중…' : '전체 측정'}
                </button>
                <button
                    className="inline-flex h-9 items-center rounded-md border border-[#fca5a5] bg-white px-3 text-xs font-semibold text-[#dc2626] disabled:opacity-50"
                    disabled={bulkBusy || bulkCrawlBusy || filtered.length === 0}
                    onClick={() => void bulkDelete()}
                    type="button"
                >
                    {bulkBusy ? '삭제 중…' : '일괄삭제'}
                </button>
            </div>

            <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">업체</th>
                            <th className="px-3 py-2 font-semibold">담당</th>
                            <th className="px-3 py-2 font-semibold">기자단</th>
                            <th
                                className="cursor-pointer px-3 py-2 font-semibold"
                                onClick={() => toggleSort('prog')}
                            >
                                진행률 {sortKey === 'prog' ? (sortDir > 0 ? '▲' : '▼') : ''}
                            </th>
                            <th
                                className="cursor-pointer px-3 py-2 text-center font-semibold"
                                onClick={() => toggleSort('remain')}
                            >
                                잔여 {sortKey === 'remain' ? (sortDir > 0 ? '▲' : '▼') : ''}
                            </th>
                            <th className="px-3 py-2 text-center font-semibold">주 발행</th>
                            <th className="px-3 py-2 text-center font-semibold">추적 글</th>
                            <th className="px-3 py-2 text-center font-semibold">통합 10위↓</th>
                            <th className="px-3 py-2 text-center font-semibold">상태</th>
                            <th className="px-3 py-2 font-semibold">특이사항</th>
                            <th className="px-3 py-2 text-center font-semibold">관리</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pageRows.length ? (
                            pageRows.map((a) => {
                                const p = progOf(a);
                                const myPosts = postCountOf(a.id);
                                const measured = myPosts.filter((x) => x.measurements.length);
                                const inTen = measured.filter((x) => (lastM(x)?.ti ?? 99) <= 10).length;
                                const pc = p == null ? '#94a3b8' : p >= 70 ? '#059669' : p >= 40 ? '#d97706' : '#dc2626';
                                return (
                                    <tr key={a.id} className="border-b border-[#e2e8f0]">
                                        <td className="px-3 py-2">
                                            <div className="font-semibold">{a.name}</div>
                                            <a
                                                className="text-[11px] text-[#94a3b8] hover:underline"
                                                href={a.blog_url}
                                                rel="noreferrer"
                                                target="_blank"
                                            >
                                                {a.blog_id || extractBlogId(a.blog_url)}
                                            </a>
                                            {a.contract_date || a.amount ? (
                                                <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-[#64748b]">
                                                    {a.contract_date ? (
                                                        <span>📅 {a.contract_date}</span>
                                                    ) : null}
                                                    {a.amount ? (
                                                        <span className="font-semibold text-[#475569]">
                                                            💰 {a.amount}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            ) : null}
                                        </td>
                                        <td className="px-3 py-2">
                                            {a.manager ? (
                                                <span className="rounded bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-semibold text-[#475569]">
                                                    {a.manager}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-[#94a3b8]">미지정</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            {a.reporter ? (
                                                <span className="rounded bg-[#ede9fe] px-2 py-0.5 text-[11px] font-semibold text-[#6d28d9]">
                                                    {a.reporter}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-[#94a3b8]">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            {p == null ? (
                                                <span className="text-xs text-[#94a3b8]">계약건수 미입력</span>
                                            ) : (
                                                <div className="min-w-[120px]">
                                                    <div className="flex items-baseline justify-between gap-2">
                                                        <span className="text-sm font-bold" style={{ color: pc }}>
                                                            {p}%
                                                        </span>
                                                        <span className="text-[10px] text-[#94a3b8]">
                                                            {(a.goal_count || 0) - (a.remain_count || 0)}/{a.goal_count}건
                                                        </span>
                                                    </div>
                                                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#eef2f7]">
                                                        <div style={{ background: pc, width: `${p}%`, height: '100%' }} />
                                                    </div>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            {a.remain_count == null ? (
                                                <span className="text-xs text-[#94a3b8]">—</span>
                                            ) : (
                                                <span
                                                    className="text-sm font-bold"
                                                    style={{ color: a.remain_count <= 3 ? '#dc2626' : '#0f172a' }}
                                                >
                                                    {a.remain_count}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-center text-xs text-[#64748b]">
                                            {a.weekly || '—'}
                                        </td>
                                        <td className="px-3 py-2 text-center text-sm font-semibold">
                                            {myPosts.length}
                                        </td>
                                        <td className="px-3 py-2 text-center text-sm">
                                            {measured.length ? (
                                                <span className="font-semibold text-[#059669]">
                                                    {inTen}/{measured.length}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-[#94a3b8]">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            {!a.is_active ? (
                                                <Tag kind="stop">중단</Tag>
                                            ) : a.remain_count != null && a.remain_count <= 3 ? (
                                                <Tag kind="low">재계약 임박</Tag>
                                            ) : a.goal_count == null ? (
                                                <Tag kind="muted">정보 부족</Tag>
                                            ) : (
                                                <Tag kind="run">진행 중</Tag>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-1">
                                                <span
                                                    className="block max-w-[140px] truncate text-xs text-[#94a3b8]"
                                                    title={a.note || ''}
                                                >
                                                    {a.note || '—'}
                                                </span>
                                                <button
                                                    className="shrink-0 rounded border border-[#cbd5e1] px-1.5 py-0.5 text-[10px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                                                    onClick={() => setNoteAcc(a)}
                                                    title="특이사항 자세히 보기·수정"
                                                    type="button"
                                                >
                                                    자세히
                                                </button>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            <div className="flex justify-center gap-1">
                                                <button
                                                    className="rounded bg-[#059669] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#047857] disabled:opacity-50"
                                                    disabled={crawlingId === a.id || bulkCrawlBusy}
                                                    onClick={() => void doCrawl(a)}
                                                    title="터미널 없이 이 블로그 RSS+순위를 지금 측정"
                                                    type="button"
                                                >
                                                    {crawlingId === a.id ? '측정 중…' : '지금 측정'}
                                                </button>
                                                <button
                                                    className="rounded border border-[#cbd5e1] px-2 py-1 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                                                    onClick={() => setEditAcc(a)}
                                                    title="업체 정보·계정·특이사항 편집"
                                                    type="button"
                                                >
                                                    편집
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        ) : (
                            <tr>
                                <td className="px-3 py-12 text-center text-sm text-[#64748b]" colSpan={11}>
                                    등록된 블로그가 없습니다 · '시트 붙여넣기 등록'으로 추가하세요
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                <Pager pages={pages} current={current} onGo={setPage} />
            </div>

            {importOpen ? (
                <ImportModal
                    existing={accounts}
                    onClose={() => setImportOpen(false)}
                    onReload={onReload}
                    onToast={onToast}
                />
            ) : null}

            {editAcc ? (
                <AccountEditModal
                    account={editAcc}
                    onClose={() => setEditAcc(null)}
                    onReload={onReload}
                    onToast={onToast}
                />
            ) : null}
            {noteAcc ? (
                <NoteModal
                    account={noteAcc}
                    onClose={() => setNoteAcc(null)}
                    onReload={onReload}
                    onToast={onToast}
                />
            ) : null}
        </div>
    );
}

// ───────────────────────── 특이사항 자세히 보기·수정 ─────────────────────────
function NoteModal({
    account,
    onClose,
    onReload,
    onToast,
}: {
    account: BlogAccount;
    onClose: () => void;
    onReload: () => Promise<void>;
    onToast: (message: string) => void;
}) {
    const [note, setNote] = useState(account.note ?? '');
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        const { error } = await updateBlogAccount(account.id, { note: note.trim() || null });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        await onReload();
        onToast('특이사항 저장 완료');
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-[min(560px,94vw)] rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">{account.name} · 특이사항</h3>
                <p className="mt-1 mb-3 text-sm text-[#64748b]">자유롭게 보고 수정할 수 있습니다.</p>
                <textarea
                    autoFocus
                    className="min-h-[200px] w-full resize-y rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-sm"
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="특이사항을 입력하세요"
                    value={note}
                />
                <div className="mt-4 flex justify-end gap-2">
                    <button
                        className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                    <button
                        className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        disabled={saving}
                        onClick={() => void save()}
                        type="button"
                    >
                        {saving ? '저장 중…' : '저장'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ───────────────────────── 업체 편집(시트 항목·계정) ─────────────────────────
function AccountEditModal({
    account,
    onClose,
    onReload,
    onToast,
}: {
    account: BlogAccount;
    onClose: () => void;
    onReload: () => Promise<void>;
    onToast: (message: string) => void;
}) {
    // 시트 전체 항목(편집에서 수정 가능)
    const [name, setName] = useState(account.name ?? '');
    const [manager, setManager] = useState(account.manager ?? '');
    const [blogUrl, setBlogUrl] = useState(account.blog_url ?? '');
    const [contractDate, setContractDate] = useState(account.contract_date ?? '');
    const [amount, setAmount] = useState(account.amount ?? '');
    const [goalCount, setGoalCount] = useState(account.goal_count?.toString() ?? '');
    const [remainCount, setRemainCount] = useState(account.remain_count?.toString() ?? '');
    const [weekly, setWeekly] = useState(account.weekly ?? '');
    const [reporter, setReporter] = useState(account.reporter ?? '');
    const [manageSheet, setManageSheet] = useState(account.manage_sheet_url ?? '');
    const [note, setNote] = useState(account.note ?? '');
    const [isActive, setIsActive] = useState(account.is_active);
    // 계정(별도 '보기'에서만 노출)
    const [loginId, setLoginId] = useState(account.login_id ?? '');
    const [loginPw, setLoginPw] = useState(account.login_pw ?? '');
    const [showCred, setShowCred] = useState(false);
    const [saving, setSaving] = useState(false);
    const [confirmDel, setConfirmDel] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const save = async () => {
        setSaving(true);
        const parseNum = (v: string) => {
            const m = v.match(/\d+/);
            return m ? Number(m[0]) : null;
        };
        const { error } = await updateBlogAccount(account.id, {
            name: name.trim() || account.name,
            manager: manager.trim() || null,
            blog_url: blogUrl.trim() || account.blog_url,
            blog_id: extractBlogId(blogUrl) || account.blog_id,
            contract_date: contractDate.trim() || null,
            amount: amount.trim() || null,
            goal_count: parseNum(goalCount),
            remain_count: parseNum(remainCount),
            weekly: weekly.trim() || null,
            reporter: reporter.trim() || null,
            manage_sheet_url: manageSheet.trim() || null,
            note: note.trim() || null,
            is_active: isActive,
            login_id: loginId.trim() || null,
            login_pw: loginPw.trim() || null,
        });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        await onReload();
        onToast('저장 완료');
        onClose();
    };

    // blog_posts 는 ON DELETE CASCADE 로 함께 삭제됨(측정 이력 포함).
    const remove = async () => {
        setDeleting(true);
        const { error } = await deleteBlogAccount(account.id);
        setDeleting(false);
        if (error) {
            onToast(`삭제 오류: ${error.message}`);
            return;
        }
        await onReload();
        onToast(`'${account.name}' 삭제 완료`);
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="max-h-[90vh] w-[min(520px,94vw)] overflow-y-auto rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">{account.name} · 추적 설정</h3>

                {/* ── 관리 정보(시트 전체 항목 · 편집에서 모두 수정 가능) ── */}
                <div className="mt-4 grid gap-2 rounded-lg border border-[#e2e8f0] p-3">
                    <div className="text-xs font-bold text-[#334155]">관리 정보</div>
                    <div className="grid grid-cols-2 gap-2">
                        {(
                            [
                                ['업체명', name, setName, ''],
                                ['담당', manager, setManager, ''],
                                ['계약일자', contractDate, setContractDate, '2026-06-22'],
                                ['금액', amount, setAmount, '예: 500,000'],
                                ['계약건수', goalCount, setGoalCount, '20'],
                                ['잔여건수', remainCount, setRemainCount, '6'],
                                ['주 발행', weekly, setWeekly, '주 5회'],
                                ['기자단', reporter, setReporter, 'A팀'],
                            ] as Array<[string, string, (v: string) => void, string]>
                        ).map(([label, value, setter, ph]) => (
                            <label
                                className="block text-xs font-semibold text-[#334155]"
                                key={label}
                            >
                                <span className="mb-1 block">{label}</span>
                                <input
                                    className="h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                                    onChange={(e) => setter(e.target.value)}
                                    placeholder={ph}
                                    value={value}
                                />
                            </label>
                        ))}
                    </div>
                    <label className="block text-xs font-semibold text-[#334155]">
                        <span className="mb-1 block">발행 URL</span>
                        <input
                            className="h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                            onChange={(e) => setBlogUrl(e.target.value)}
                            placeholder="https://blog.naver.com/..."
                            value={blogUrl}
                        />
                    </label>
                    <label className="block text-xs font-semibold text-[#334155]">
                        <span className="mb-1 block">발행 관리시트</span>
                        <input
                            className="h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                            onChange={(e) => setManageSheet(e.target.value)}
                            placeholder="관리 시트 링크"
                            value={manageSheet}
                        />
                    </label>
                    <label className="block text-xs font-semibold text-[#334155]">
                        <span className="mb-1 block">특이사항</span>
                        <textarea
                            className="min-h-[56px] w-full resize-y rounded-md border border-[#cbd5e1] bg-white px-2 py-1.5 text-sm"
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="메모/특이사항"
                            value={note}
                        />
                    </label>
                    <label className="flex items-center gap-2 text-xs font-semibold text-[#334155]">
                        <input
                            checked={isActive}
                            onChange={(e) => setIsActive(e.target.checked)}
                            type="checkbox"
                        />
                        진행중(활성) — 끄면 ‘진행 중단’ 상태
                    </label>
                </div>

                {/* ── 계정 정보(아이디/비밀번호) — 표에는 안 보이고 여기서만 보기·수정 ── */}
                <div className="mt-3 grid gap-2 rounded-lg border border-[#fde68a] bg-[#fffbeb] p-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#92400e]">
                            계정 정보 (아이디 · 비밀번호)
                        </span>
                        <button
                            className="rounded-md border border-[#fbbf24] bg-white px-2 py-1 text-[11px] font-semibold text-[#92400e]"
                            onClick={() => setShowCred((v) => !v)}
                            type="button"
                        >
                            {showCred ? '숨기기' : '보기'}
                        </button>
                    </div>
                    {showCred ? (
                        <div className="grid grid-cols-2 gap-2">
                            {(
                                [
                                    ['아이디', loginId, setLoginId],
                                    ['비밀번호', loginPw, setLoginPw],
                                ] as Array<[string, string, (v: string) => void]>
                            ).map(([label, value, setter]) => (
                                <label
                                    className="block text-xs font-semibold text-[#92400e]"
                                    key={label}
                                >
                                    <span className="mb-1 block">{label}</span>
                                    <div className="flex gap-1">
                                        <input
                                            className="h-9 w-full rounded-md border border-[#fbbf24] bg-white px-2 text-sm"
                                            onChange={(e) => setter(e.target.value)}
                                            value={value}
                                        />
                                        <button
                                            className="shrink-0 rounded-md border border-[#fbbf24] bg-white px-2 text-[11px] font-semibold text-[#92400e]"
                                            onClick={() => {
                                                void navigator.clipboard.writeText(value);
                                                onToast(`${label} 복사됨`);
                                            }}
                                            type="button"
                                        >
                                            복사
                                        </button>
                                    </div>
                                </label>
                            ))}
                        </div>
                    ) : (
                        <p className="m-0 text-[11px] text-[#92400e]">
                            ‘보기’를 눌러 아이디·비밀번호를 확인·수정하세요. (표에는 노출되지 않습니다)
                        </p>
                    )}
                </div>

                <div className="mt-5 flex items-center gap-2">
                    {confirmDel ? (
                        <span className="flex items-center gap-2 text-xs text-[#dc2626]">
                            측정 이력까지 삭제됩니다.
                            <button
                                className="rounded-md bg-[#dc2626] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                                disabled={deleting}
                                onClick={() => void remove()}
                                type="button"
                            >
                                {deleting ? '삭제 중...' : '정말 삭제'}
                            </button>
                            <button
                                className="text-xs font-semibold text-[#64748b]"
                                onClick={() => setConfirmDel(false)}
                                type="button"
                            >
                                취소
                            </button>
                        </span>
                    ) : (
                        <button
                            className="rounded-md border border-[#fecaca] px-3 py-2 text-sm font-semibold text-[#dc2626] hover:bg-[#fef2f2]"
                            onClick={() => setConfirmDel(true)}
                            type="button"
                        >
                            업체 삭제
                        </button>
                    )}
                    <button
                        className="ml-auto rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                    <button
                        className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        disabled={saving}
                        onClick={() => void save()}
                        type="button"
                    >
                        {saving ? '저장 중...' : '저장'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ───────────────────────── 트래커 ─────────────────────────
function TrackerTab({
    accounts,
    posts,
    onReload,
}: {
    accounts: BlogAccount[];
    posts: BlogPost[];
    onReload: () => Promise<void>;
}) {
    const [co, setCo] = useState('');
    const [nameQ, setNameQ] = useState('');
    const [inOnly, setInOnly] = useState(false);
    const [page, setPage] = useState(1);

    const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name || '블로그';

    const filtered = useMemo(() => {
        const q = nameQ.trim().toLowerCase();
        const list = posts.filter(
            (p) =>
                (co === '' || p.blog_account_id === co) &&
                (q === '' || nameOf(p.blog_account_id).toLowerCase().includes(q)) &&
                (!inOnly || (p.measurements.length && (lastM(p)?.ti ?? 99) <= 10)),
        );
        return [...list].sort((a, b) => dayN(a) - dayN(b));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [posts, co, nameQ, inOnly, accounts]);

    const pages = Math.max(1, Math.ceil(filtered.length / PER_FEED));
    const current = Math.min(page, pages);
    const pageRows = filtered.slice((current - 1) * PER_FEED, current * PER_FEED);

    return (
        <div className="grid gap-3">
            <input
                aria-label="블로그 이름 검색"
                className="h-11 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                onChange={(e) => {
                    setNameQ(e.target.value);
                    setPage(1);
                }}
                placeholder="블로그 이름 검색 (예: 더현대) — 일부만 입력해도 됩니다"
                value={nameQ}
            />

            <div className="flex flex-wrap items-center gap-2">
                <select
                    className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-xs"
                    onChange={(e) => {
                        setCo(e.target.value);
                        setPage(1);
                    }}
                    value={co}
                >
                    <option value="">블로그 전체</option>
                    {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                            {a.name}
                        </option>
                    ))}
                </select>
                <label className="flex items-center gap-1 text-xs text-[#334155]">
                    <input checked={inOnly} onChange={(e) => setInOnly(e.target.checked)} type="checkbox" />
                    통합 10위 이내만
                </label>
                <span className="ml-auto text-xs text-[#64748b]">{filtered.length}건</span>
            </div>

            <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">발행</th>
                            <th className="px-3 py-2 font-semibold">블로그</th>
                            <th className="px-3 py-2 font-semibold">제목 · 자동 키워드</th>
                            <th className="px-3 py-2 font-semibold">키워드 검색</th>
                            <th className="px-3 py-2 text-center font-semibold">통합탭</th>
                            <th className="px-3 py-2 text-center font-semibold">블로그탭</th>
                            <th className="px-3 py-2 text-center font-semibold">웹사이트</th>
                            <th className="px-3 py-2 text-center font-semibold">일별 추이</th>
                            <th className="px-3 py-2 text-center font-semibold">경과</th>
                            <th className="px-3 py-2 text-center font-semibold">측정</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pageRows.length ? (
                            pageRows.map((p) => {
                                const acc = accounts.find((a) => a.id === p.blog_account_id) ?? null;
                                return (
                                <tr key={p.id} className="border-b border-[#e2e8f0]">
                                    <td className="px-3 py-2 text-xs font-semibold text-[#475569]">
                                        {p.published_date
                                            ? new Date(p.published_date).toLocaleDateString('ko-KR', {
                                                  day: '2-digit',
                                                  month: '2-digit',
                                              })
                                            : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-xs font-semibold text-[#475569]">
                                        {nameOf(p.blog_account_id)}
                                    </td>
                                    <td className="px-3 py-2">
                                        {(() => {
                                            const postLink = p.post_url || acc?.blog_url || '';
                                            const inner = (
                                                <>
                                                    <div className="max-w-[360px] truncate text-[13px] font-medium text-[#0f172a] group-hover:text-[#7c3aed] group-hover:underline">
                                                        {p.title || '제목 없음'}
                                                    </div>
                                                    {p.keyword_manual || p.keyword ? (
                                                        <span className="mt-1 inline-block rounded bg-[#ede9fe] px-1.5 py-0.5 text-[10px] font-semibold text-[#7c3aed]">
                                                            #{p.keyword_manual || p.keyword}
                                                            {p.keyword_manual ? ' (수정됨)' : ''}
                                                        </span>
                                                    ) : null}
                                                </>
                                            );
                                            return postLink ? (
                                                <a
                                                    className="group block cursor-pointer"
                                                    href={postLink}
                                                    rel="noopener noreferrer"
                                                    target="_blank"
                                                    title="실제 블로그 글로 이동"
                                                >
                                                    {inner}
                                                </a>
                                            ) : (
                                                <div>{inner}</div>
                                            );
                                        })()}
                                    </td>
                                    <td className="px-3 py-2">
                                        <PostSearchCell account={acc} post={p} onSaved={onReload} />
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <RankCell post={p} keyName="ti" />
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <RankCell post={p} keyName="bl" />
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        {acc ? (
                                            <WebRankCell account={acc} />
                                        ) : (
                                            <span className="text-xs text-[#94a3b8]">—</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <Sparkline post={p} />
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <span className="rounded bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-semibold text-[#475569]">
                                            D+{dayN(p)}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-center text-xs text-[#94a3b8]">
                                        {p.measurements.length}회
                                    </td>
                                </tr>
                                );
                            })
                        ) : (
                            <tr>
                                <td className="px-3 py-12 text-center text-sm text-[#64748b]" colSpan={10}>
                                    아직 수집된 글이 없습니다 · 파이썬 크롤러 실행 후 표시됩니다
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                <Pager pages={pages} current={current} onGo={setPage} />
            </div>
        </div>
    );
}


// 인라인 즉시검색 — 키워드 입력 → 서버리스가 네이버 측정 → 그 블로그의 통합/블로그탭 순위 즉시 표시.
// 자동키워드 순위(기본, RankCell)와 별개. 'blog_id 매칭'이라 '글'이 아니라 '블로그 노출 순위'.
function fmtRank(rank: number, status: string): string {
    if (status === 'fail') return '실패';
    if (status === 'out' || rank > 30) return '권외';
    return `${rank}위`;
}

function PostSearchCell({
    account,
    post,
    onSaved,
}: {
    account: BlogAccount | null;
    post: BlogPost;
    onSaved: () => Promise<void>;
}) {
    const [kw, setKw] = useState('');
    const [busy, setBusy] = useState(false);
    const [res, setRes] = useState<RankSearchResult | null>(null);
    const [err, setErr] = useState('');
    // 자동키워드 수동 수정
    const effectiveKw = post.keyword_manual || post.keyword || '';
    const [editing, setEditing] = useState(false);
    const [editVal, setEditVal] = useState(effectiveKw);
    const [saving, setSaving] = useState(false);

    if (!account) {
        return <span className="text-xs text-[#94a3b8]">—</span>;
    }
    const blogId = account.blog_id || extractBlogId(account.blog_url);

    const run = async () => {
        const q = kw.trim();
        if (!q || !blogId) {
            return;
        }
        setBusy(true);
        setErr('');
        try {
            setRes(await searchRank(q, blogId));
        } catch (e) {
            setErr(e instanceof Error ? e.message : '검색 실패');
            setRes(null);
        } finally {
            setBusy(false);
        }
    };

    const saveKeyword = async () => {
        setSaving(true);
        setErr('');
        // 1) 키워드 먼저 무조건 저장(측정 실패해도 저장은 유지).
        const { error } = await updatePostKeyword(post.id, editVal);
        if (error) {
            setErr(error.message || '키워드 저장 실패');
            setSaving(false);
            return; // 저장 실패 시 편집창 유지
        }
        // 2) 저장된 실효 키워드로 즉시 재측정해 통합탭/블로그탭 반영.
        const effective = editVal.trim() || post.keyword || '';
        const prevEffective = post.keyword_manual || post.keyword || '';
        const keywordChanged = effective !== prevEffective;
        const today = todayKST();
        // 키워드가 바뀌면 이전 키워드의 측정 이력은 버린다(서로 다른 키워드 순위로 delta 비교되는 오류 방지).
        let next: BlogMeasurement[] = keywordChanged
            ? []
            : post.measurements.filter((m) => m.date !== today);
        let measured = false;
        if (effective && blogId) {
            try {
                const r = await searchRank(effective, blogId, extractLogNo(post.post_url || ''));
                next = [
                    ...next,
                    { date: today, ti: r.ti, ti_status: r.ti_status, bl: r.bl, bl_status: r.bl_status },
                ];
                measured = true;
            } catch (e) {
                setErr(`키워드 저장됨 · 측정 실패: ${e instanceof Error ? e.message : ''}`);
            }
        }
        // 측정 성공했거나(레코드 추가) 키워드가 바뀌어 이력을 비웠으면 measurements 영속화.
        if (measured || keywordChanged) {
            await updatePostMeasurements(post.id, next);
        }
        setSaving(false);
        setEditing(false);
        await onSaved();
    };

    return (
        <div className="min-w-[300px]">
            {editing ? (
                <div className="flex gap-1">
                    <input
                        aria-label="자동키워드 수정"
                        autoFocus
                        className="h-11 w-full min-w-0 rounded-md border border-[#a78bfa] bg-white px-2.5 text-sm"
                        onChange={(e) => setEditVal(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void saveKeyword()}
                        placeholder="자동키워드 직접 입력"
                        value={editVal}
                    />
                    <button
                        className="flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-[#7c3aed] px-4 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={saving}
                        onClick={() => void saveKeyword()}
                        type="button"
                    >
                        {saving ? '측정 중…' : '저장'}
                    </button>
                    <button
                        className="flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-[#cbd5e1] bg-white px-3 text-sm font-semibold text-[#475569]"
                        onClick={() => {
                            setEditing(false);
                            setEditVal(effectiveKw);
                        }}
                        type="button"
                    >
                        취소
                    </button>
                </div>
            ) : (
                <div className="flex gap-1">
                    <input
                        aria-label="키워드 직접 검색"
                        className="h-11 w-full min-w-0 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                        onChange={(e) => setKw(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void run()}
                        placeholder="키워드 직접 검색"
                        value={kw}
                    />
                    <button
                        className="flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-[#1e40af] px-4 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={busy || !kw.trim()}
                        onClick={() => void run()}
                        title="이 블로그가 입력 키워드로 몇 위인지 즉시 검색"
                        type="button"
                    >
                        {busy ? '…' : '검색'}
                    </button>
                    <button
                        className="flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-[#7c3aed] px-4 text-sm font-semibold text-white"
                        onClick={() => {
                            setEditVal(effectiveKw);
                            setEditing(true);
                        }}
                        title="이 글의 자동키워드를 직접 수정(다음 자동 측정도 이 값으로 유지)"
                        type="button"
                    >
                        수정
                    </button>
                </div>
            )}
            {post.keyword_manual ? (
                <div className="mt-1 text-[10px] font-semibold text-[#7c3aed]">수동 키워드 #{post.keyword_manual}</div>
            ) : null}
            {res ? (
                <div className="mt-1 text-[11px] font-semibold text-[#0f172a]">
                    <span className="text-[#94a3b8]">#{res.keyword}</span> · 통합{' '}
                    <span className="text-[#059669]">{fmtRank(res.ti, res.ti_status)}</span> · 블로그{' '}
                    <span className="text-[#1e40af]">{fmtRank(res.bl, res.bl_status)}</span>
                </div>
            ) : err ? (
                <div className="mt-1 text-[10px] text-[#dc2626]">{err}</div>
            ) : null}
        </div>
    );
}

function RankCell({ post, keyName }: { post: BlogPost; keyName: 'ti' | 'bl' }) {
    if (!post.measurements.length) {
        return <span className="text-[11px] font-semibold text-[#d97706]">측정 대기</span>;
    }
    const cur = post.measurements[post.measurements.length - 1][keyName];
    const prev = post.measurements.length >= 2 ? post.measurements[post.measurements.length - 2][keyName] : null;
    const inTop = cur <= 10;
    const color = inTop ? (keyName === 'ti' ? '#059669' : '#1e40af') : '#94a3b8';
    let delta = <span className="block text-[10px] text-[#94a3b8]">첫 측정</span>;
    if (prev != null) {
        const diff = prev - cur;
        delta =
            diff > 0 ? (
                <span className="block text-[10px] font-bold text-[#dc2626]">▲{diff}</span>
            ) : diff < 0 ? (
                <span className="block text-[10px] font-bold text-[#1e40af]">▼{Math.abs(diff)}</span>
            ) : (
                <span className="block text-[10px] text-[#94a3b8]">—</span>
            );
    }
    return (
        <span>
            <span className="text-sm font-bold" style={{ color }}>
                {cur > 30 ? '권외' : `${cur}위`}
            </span>
            {delta}
        </span>
    );
}

// 웹사이트(회사 단위) 순위 셀. 글 단위 RankCell 과 별개 — SheetTab(업체 표)에서만 사용.
// 신뢰도가 ti/bl 보다 낮아(webkr API 추정) 색상을 보라(#7c3aed)로 구분하고 배지를 단다.
function WebRankCell({ account }: { account: BlogAccount }) {
    if (!account.website_url || !account.rep_keyword) {
        return <span className="text-xs text-[#94a3b8]">해당없음</span>;
    }
    const last = lastWe(account);
    if (!last) {
        return <span className="text-[11px] font-semibold text-[#d97706]">측정 대기</span>;
    }
    if (last.status === 'fail') {
        return (
            <span className="text-[11px] text-[#94a3b8]" title="측정 실패(API/네트워크). 진짜 권외와 다름.">
                측정 실패
            </span>
        );
    }
    if (last.status !== 'ok' || last.we > 30) {
        return (
            <span title="웹사이트 섹션 미노출 또는 권외 · webkr API 추정">
                <span className="text-sm font-bold text-[#94a3b8]">권외</span>
                <span className="block text-[10px] text-[#94a3b8]">미노출 포함</span>
            </span>
        );
    }
    const prev = prevWe(account);
    let delta = <span className="block text-[10px] text-[#94a3b8]">첫 측정</span>;
    if (prev && prev.status === 'ok') {
        const diff = prev.we - last.we;
        delta =
            diff > 0 ? (
                <span className="block text-[10px] font-bold text-[#dc2626]">▲{diff}</span>
            ) : diff < 0 ? (
                <span className="block text-[10px] font-bold text-[#1e40af]">▼{Math.abs(diff)}</span>
            ) : (
                <span className="block text-[10px] text-[#94a3b8]">—</span>
            );
    }
    return (
        <span title="webkr API 추정 · 화면 순위와 다를 수 있음(신뢰도 낮음)">
            <span className="text-sm font-bold text-[#7c3aed]">{last.we}위</span>
            {delta}
        </span>
    );
}

function Sparkline({ post }: { post: BlogPost }) {
    const pts = post.measurements;
    if (pts.length < 2) {
        return <span className="text-[11px] text-[#94a3b8]">측정 {pts.length}회</span>;
    }
    const W = 140;
    const H = 40;
    const padL = 4;
    const padR = 10;
    const padT = 6;
    const padB = 5;
    const maxRank = Math.max(15, ...pts.map((m) => Math.max(m.ti, m.bl)));
    const x = (i: number) => padL + (i / (pts.length - 1)) * (W - padL - padR);
    const y = (r: number) => padT + ((r - 1) / (maxRank - 1)) * (H - padT - padB);
    const line = (key: 'ti' | 'bl') => pts.map((m, i) => `${x(i)},${y(m[key])}`).join(' ');
    const li = pts.length - 1;
    return (
        <svg height={H} viewBox={`0 0 ${W} ${H}`} width={W}>
            <line
                stroke="#e2e8f0"
                strokeDasharray="3 3"
                strokeWidth="1"
                x1={padL}
                x2={W - padR}
                y1={y(10)}
                y2={y(10)}
            />
            <polyline fill="none" points={line('ti')} stroke="#059669" strokeWidth="2" />
            <polyline fill="none" points={line('bl')} stroke="#1e40af" strokeWidth="2" />
            <circle cx={x(li)} cy={y(pts[li].ti)} fill="#059669" r="2.6" />
            <circle cx={x(li)} cy={y(pts[li].bl)} fill="#1e40af" r="2.6" />
        </svg>
    );
}

// ───────────────────────── 시트 붙여넣기 모달 ─────────────────────────
function ImportModal({
    existing,
    onClose,
    onReload,
    onToast,
}: {
    existing: BlogAccount[];
    onClose: () => void;
    onReload: () => Promise<void>;
    onToast: (message: string) => void;
}) {
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);

    // 한 줄을 칸으로 분리. 탭이 있으면 탭, 없으면 슬래시(/). URL·날짜 속 내부 슬래시는 보호 후 분리(깨짐 방지).
    const splitFields = (line: string): string[] => {
        if (line.includes('\t')) {
            return line.split('\t').map((c) => c.trim());
        }
        const prot: string[] = [];
        const mark = (m: string) => {
            prot.push(m);
            return `\uF8FF${prot.length - 1}\uF8FF`;
        };
        let s = line.replace(/(?:https?:\/\/)?[\w.-]+\.[a-z]{2,}(?:\/[^\s]*)?/gi, mark); // URL/도메인 보호
        s = s.replace(/\d{1,4}\/\d{1,2}\/\d{1,4}/g, mark); // 2026/06/23 형식 날짜 보호
        return s
            .split('/')
            .map((c) => c.replace(/\uF8FF(\d+)\uF8FF/g, (_, i) => prot[Number(i)]).trim());
    };
    const toNum = (v: string | undefined): number | null => {
        const m = (v || '').match(/\d+/);
        return m ? Number(m[0]) : null;
    };

    const doImport = async () => {
        const raw = text.trim();
        if (!raw) {
            return;
        }
        const existingUrls = new Set(existing.map((a) => a.blog_url));
        const existingNames = new Set(existing.map((a) => a.name));
        const payloads: Array<Partial<BlogAccount>> = [];
        let skipped = 0;

        raw.split('\n').forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed) {
                return;
            }
            // 고정 순서: 업체명 / 계약일자 / 금액 / 계약건수 / 잔여건수 / 주 발행건수 / 아이디 / 비밀번호 / 기자단 / 발행 관리시트 / 발행 URL
            let f = splitFields(trimmed);
            // 맨 앞 행번호(12칸+이고 첫 칸이 숫자만) 제거.
            if (f.length >= 12 && /^\d+$/.test(f[0])) {
                f = f.slice(1);
            }
            const blogUrl =
                f[10] && f[10].includes('blog.naver.com')
                    ? f[10]
                    : f.find((c) => c && c.includes('blog.naver.com'));
            if (!blogUrl) {
                skipped += 1;
                return;
            }
            const name =
                f[0] && !f[0].includes('http') && !f[0].includes('blog.naver.com')
                    ? f[0]
                    : extractBlogId(blogUrl) || '블로그';
            if (
                existingUrls.has(blogUrl) ||
                existingNames.has(name) ||
                payloads.some((p) => p.blog_url === blogUrl)
            ) {
                skipped += 1;
                return;
            }
            const sheet = f[9] && f[9].includes('http') ? f[9] : null;
            payloads.push({
                blog_id: extractBlogId(blogUrl),
                blog_url: blogUrl,
                name,
                contract_date: f[1] || null,
                amount: f[2] || null,
                goal_count: toNum(f[3]),
                remain_count: toNum(f[4]),
                weekly: f[5] || null,
                login_id: f[6] || null,
                login_pw: f[7] || null,
                reporter: f[8] || null,
                manage_sheet_url: sheet,
                is_active: true,
            });
        });

        if (!payloads.length) {
            onToast(`등록할 항목이 없습니다 (중복/형식 ${skipped}건 건너뜀)`);
            return;
        }

        setSaving(true);
        const { error } = await insertBlogAccounts(payloads);
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        await onReload();
        onToast(`${payloads.length}개 등록 완료${skipped ? ` · ${skipped}건 건너뜀` : ''}`);
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-[min(620px,94vw)] rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">시트 붙여넣기 등록</h3>
                <p className="mt-1 mb-3 text-sm text-[#64748b]">
                    한 줄에 블로그 하나. 칸은 <b>슬래시( / )</b>로 구분하고, 아래 <b>고정 순서</b>로 입력하세요(빈 칸은 그냥 비워두면 됩니다):
                    <br />
                    <span className="mt-1 inline-block rounded bg-[#f1f5f9] px-1.5 py-1 text-xs">
                        업체명 / 계약일자 / 금액 / 계약건수 / 잔여건수 / 주 발행건수 / 아이디 / 비밀번호 / 기자단 / 발행 관리시트 / 발행 URL
                    </span>
                    <br />
                    URL·날짜 속 슬래시는 자동으로 보호되니 그대로 붙여넣으셔도 됩니다. (블로그 URL만 붙여넣어도 등록 가능 · 엑셀에서 복사한 탭 구분도 인식)
                </p>
                <textarea
                    className="min-h-[160px] w-full resize-y rounded-md border-2 border-dashed border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 font-mono text-xs"
                    onChange={(e) => setText(e.target.value)}
                    placeholder={
                        '참조와이엘 / 2026-06-01 / 100만원 / 30건 / 25건 / 주5회 / myid / mypw / 장지영 / https://docs.google.com/sheet / https://blog.naver.com/puleenbe\n든든한누수탐지 / / / 20건 / 6건 / 주3회 / / / / / https://blog.naver.com/st7al_i_byid-\nhttps://blog.naver.com/bau_j2'
                    }
                    value={text}
                />
                <div className="mt-4 flex justify-end gap-2">
                    <button
                        className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                    <button
                        className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        disabled={saving}
                        onClick={() => void doImport()}
                        type="button"
                    >
                        {saving ? '등록 중...' : '등록하기'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ───────────────────────── 공용 ─────────────────────────
function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
    return (
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
            <p className="m-0 text-xs text-[#64748b]">{label}</p>
            <p className="m-0 mt-1 text-2xl font-bold" style={{ color: accent ?? '#0f172a' }}>
                {value}
            </p>
            {sub ? <p className="m-0 mt-0.5 text-[11px] text-[#94a3b8]">{sub}</p> : null}
        </div>
    );
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
            <h3 className="m-0 text-sm font-bold text-[#0f172a]">{title}</h3>
            {sub ? <p className="m-0 mt-0.5 mb-2 text-[11px] text-[#94a3b8]">{sub}</p> : null}
            {children}
        </div>
    );
}

function Tag({ kind, children }: { kind: 'run' | 'stop' | 'low' | 'muted'; children: React.ReactNode }) {
    const map: Record<string, string> = {
        low: 'bg-[#fef3c7] text-[#d97706]',
        muted: 'bg-[#f1f5f9] text-[#94a3b8]',
        run: 'bg-[#d1fae5] text-[#059669]',
        stop: 'bg-[#fee2e2] text-[#dc2626]',
    };
    return (
        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${map[kind]}`}>{children}</span>
    );
}

function Empty({ text }: { text: string }) {
    return <p className="m-0 py-8 text-center text-xs text-[#94a3b8]">{text}</p>;
}

function Pager({ pages, current, onGo }: { pages: number; current: number; onGo: (p: number) => void }) {
    if (pages <= 1) {
        return null;
    }
    return (
        <div className="flex items-center justify-center gap-1.5 p-3">
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                <button
                    className={`min-w-[30px] rounded px-2 py-1 text-xs font-semibold ${
                        p === current ? 'bg-[#1e40af] text-white' : 'text-[#64748b] hover:bg-[#f1f5f9]'
                    }`}
                    key={p}
                    onClick={() => onGo(p)}
                    type="button"
                >
                    {p}
                </button>
            ))}
        </div>
    );
}

export default BlogRankPage;
