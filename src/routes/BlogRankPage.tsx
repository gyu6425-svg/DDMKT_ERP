import { useEffect, useMemo, useState } from 'react';
import {
    extractBlogId,
    getBlogAccounts,
    getBlogPosts,
    insertBlogAccounts,
    updateBlogAccount,
    type BlogAccount,
    type BlogPost,
    type WebMeasurement,
} from '../api/blogRank';
import { useAuth } from '../hooks/useAuth';

type Tab = 'dashboard' | 'sheet' | 'tracker';

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
// 입력 URL/도메인을 비교용 호스트로 정규화(scheme/www/경로/포트 제거). 크롤러 norm_host 와 동일 규칙.
function normHost(input: string): string {
    let s = (input || '').trim();
    if (!s) {
        return '';
    }
    s = s.replace(/^https?:\/\//i, '');
    s = s.split(/[/?#]/)[0];
    s = s.split(':')[0];
    s = s.replace(/^www\./i, '');
    return s.toLowerCase();
}
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
    const [tab, setTab] = useState<Tab>('dashboard');
    const [toast, setToast] = useState('');

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
                <SheetTab accounts={accounts} posts={posts} onReload={load} onToast={showToast} />
            ) : null}
            {tab === 'tracker' ? <TrackerTab accounts={accounts} posts={posts} /> : null}

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

            {webTracked.length ? (
                <Panel
                    title="웹사이트 노출 (업체 기준)"
                    sub="통합검색 '웹사이트' 섹션 · webkr API 추정값이라 신뢰도 낮음"
                >
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
                </Panel>
            ) : null}

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
}: {
    accounts: BlogAccount[];
    posts: BlogPost[];
    onReload: () => Promise<void>;
    onToast: (message: string) => void;
}) {
    const [q, setQ] = useState('');
    const [mgr, setMgr] = useState('');
    const [lowOnly, setLowOnly] = useState(false);
    const [sortKey, setSortKey] = useState<'remain' | 'prog'>('remain');
    const [sortDir, setSortDir] = useState(1);
    const [page, setPage] = useState(1);
    const [importOpen, setImportOpen] = useState(false);
    const [editAcc, setEditAcc] = useState<BlogAccount | null>(null);

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
            </div>

            <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">업체</th>
                            <th className="px-3 py-2 font-semibold">담당</th>
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
                            <th className="px-3 py-2 text-center font-semibold">웹사이트</th>
                            <th className="px-3 py-2 text-center font-semibold">상태</th>
                            <th className="px-3 py-2 font-semibold">비고</th>
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
                                            <WebRankCell account={a} />
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
                                            <span
                                                className="block max-w-[160px] truncate text-xs text-[#94a3b8]"
                                                title={a.note || ''}
                                            >
                                                {a.note || ''}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            <button
                                                className="rounded border border-[#cbd5e1] px-2 py-1 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                                                onClick={() => setEditAcc(a)}
                                                title="웹사이트·대표키워드 설정"
                                                type="button"
                                            >
                                                편집
                                            </button>
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
        </div>
    );
}

// ───────────────────────── 업체 편집(웹사이트·대표키워드) ─────────────────────────
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
    const [websiteUrl, setWebsiteUrl] = useState(account.website_url ?? '');
    const [repKeyword, setRepKeyword] = useState(account.rep_keyword ?? '');
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        // website_url 은 저장 직전 호스트로 정규화(DB엔 항상 호스트만). 빈 값은 NULL.
        const { error } = await updateBlogAccount(account.id, {
            website_url: normHost(websiteUrl) || null,
            rep_keyword: repKeyword.trim() || null,
        });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        await onReload();
        onToast('웹사이트 정보 저장 완료');
        onClose();
    };

    const previewHost = normHost(websiteUrl);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-[min(520px,94vw)] rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">{account.name} · 웹사이트 추적 설정</h3>
                <p className="mt-1 mb-4 text-sm text-[#64748b]">
                    통합검색 '웹사이트' 섹션에서 회사 홈페이지 순위를 추적합니다. 둘 다 입력해야 측정됩니다.
                    <br />
                    <span className="text-[#7c3aed]">순위는 webkr API 추정값이라 신뢰도가 통합·블로그탭보다 낮습니다.</span>
                </p>

                <label className="mb-1 block text-xs font-semibold text-[#334155]">회사 홈페이지 (블로그 아님)</label>
                <input
                    className="h-10 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="예: momo-cleaning.com 또는 https://www.momo-cleaning.com"
                    value={websiteUrl}
                />
                <p className="mt-1 mb-3 text-[11px] text-[#94a3b8]">
                    저장 시 호스트만 보관:{' '}
                    {previewHost ? (
                        <span className="font-mono text-[#475569]">{previewHost}</span>
                    ) : (
                        <span className="text-[#94a3b8]">(미설정 → 해당없음)</span>
                    )}
                </p>

                <label className="mb-1 block text-xs font-semibold text-[#334155]">대표키워드</label>
                <input
                    className="h-10 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                    onChange={(e) => setRepKeyword(e.target.value)}
                    placeholder="예: 과천 입주청소"
                    value={repKeyword}
                />

                <div className="mt-5 flex justify-end gap-2">
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
}: {
    accounts: BlogAccount[];
    posts: BlogPost[];
}) {
    const [co, setCo] = useState('');
    const [inOnly, setInOnly] = useState(false);
    const [page, setPage] = useState(1);

    const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name || '블로그';

    const filtered = useMemo(() => {
        const list = posts.filter(
            (p) =>
                (co === '' || p.blog_account_id === co) &&
                (!inOnly || (p.measurements.length && (lastM(p)?.ti ?? 99) <= 10)),
        );
        return [...list].sort((a, b) => dayN(a) - dayN(b));
    }, [posts, co, inOnly]);

    const pages = Math.max(1, Math.ceil(filtered.length / PER_FEED));
    const current = Math.min(page, pages);
    const pageRows = filtered.slice((current - 1) * PER_FEED, current * PER_FEED);

    return (
        <div className="grid gap-3">
            <div className="rounded-md border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-xs text-[#92400e]">
                ℹ️ 순위 측정은 <b>사무실 PC의 파이썬 크롤러</b>가 매일 자동 수집해 기록합니다. 이 화면은 그 결과를 표시합니다.
            </div>

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
                            <th className="px-3 py-2 text-center font-semibold">통합탭</th>
                            <th className="px-3 py-2 text-center font-semibold">블로그탭</th>
                            <th className="px-3 py-2 text-center font-semibold">일별 추이</th>
                            <th className="px-3 py-2 text-center font-semibold">경과</th>
                            <th className="px-3 py-2 text-center font-semibold">측정</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pageRows.length ? (
                            pageRows.map((p) => (
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
                                        <div className="max-w-[360px] text-[13px] font-medium text-[#0f172a]">
                                            {p.title || '제목 없음'}
                                        </div>
                                        {p.keyword ? (
                                            <span className="mt-1 inline-block rounded bg-[#ede9fe] px-1.5 py-0.5 text-[10px] font-semibold text-[#7c3aed]">
                                                #{p.keyword}
                                            </span>
                                        ) : null}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <RankCell post={p} keyName="ti" />
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <RankCell post={p} keyName="bl" />
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
                            ))
                        ) : (
                            <tr>
                                <td className="px-3 py-12 text-center text-sm text-[#64748b]" colSpan={8}>
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
            const cells = line.split('\t').map((c) => c.trim());
            if (cells.length < 2) {
                return;
            }
            const name = cells[0];
            const url = cells.find((c) => c.includes('blog.naver.com'));
            if (!name || !url) {
                skipped += 1;
                return;
            }
            if (existingUrls.has(url) || existingNames.has(name) || payloads.some((p) => p.blog_url === url)) {
                skipped += 1;
                return;
            }
            const nums = cells
                .map((c) => {
                    const m = c.match(/^(\d+)\s*건?$/);
                    return m ? Number(m[1]) : null;
                })
                .filter((v): v is number => v !== null);
            const weekly = cells.find((c) => /주\s*\d/.test(c)) || null;
            const manager =
                cells.find(
                    (c, ci) =>
                        ci > 0 &&
                        c &&
                        !c.includes('http') &&
                        !/\d/.test(c) &&
                        c.length <= 4 &&
                        c !== weekly,
                ) || null;

            payloads.push({
                blog_id: extractBlogId(url),
                blog_url: url,
                goal_count: nums[0] ?? null,
                is_active: true,
                manager,
                name,
                remain_count: nums[1] ?? null,
                weekly,
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
                    구글 시트에서 행을 복사해 그대로 붙여넣으세요. 열 예시:{' '}
                    <span className="rounded bg-[#f1f5f9] px-1 text-xs">
                        업체명 · 계약건수 · 잔여건수 · 주발행 · 담당 · 블로그 URL
                    </span>
                    <br />
                    <b className="text-[#d97706]">아이디·비밀번호는 붙여넣지 마세요 — 계정 정보는 저장하지 않습니다.</b>
                </p>
                <textarea
                    className="min-h-[160px] w-full resize-y rounded-md border-2 border-dashed border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 font-mono text-xs"
                    onChange={(e) => setText(e.target.value)}
                    placeholder={
                        '참조와이엘\t30건\t30건\t주 2회\t장지영\thttps://blog.naver.com/puleenbe\n조와이엘\t30건\t30건\t주 5회\t\thttps://blog.naver.com/puleenbe1'
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
