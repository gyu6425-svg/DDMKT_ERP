import { useEffect, useState } from 'react';
import { getBlogAccounts, getBlogPosts, type BlogAccount, type BlogPost } from '../api/blogRank';
import { useAuth } from '../hooks/useAuth';
import BlogPage from './BlogPage';
import type { Tab } from './blogRank/helpers';
import { DashboardTab } from './blogRank/DashboardTab';
import { SheetTab } from './blogRank/SheetTab';
import { TrackerTab } from './blogRank/TrackerTab';
import { CrawlStatusTab } from './blogRank/CrawlStatusTab';

function BlogRankPage() {
    const { isAdmin, loading: authLoading } = useAuth();
    const [accounts, setAccounts] = useState<BlogAccount[]>([]);
    const [posts, setPosts] = useState<BlogPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // 탭을 URL 쿼리(?tab=)에 저장 → 새로고침해도 현재 탭 유지.
    const [tab, setTab] = useState<Tab>(() => {
        const t = new URLSearchParams(window.location.search).get('tab');
        return t === 'sheet' || t === 'tracker' || t === 'crawl' || t === 'writer' ? t : 'dashboard';
    });
    const [toast, setToast] = useState('');
    // 대시보드/시트에서 트래커로 보낼 때의 초기 필터. 일반 탭 이동 시엔 해제.
    const [trackerInOnly, setTrackerInOnly] = useState(false); // 통합 10위 이내만
    const [trackerCo, setTrackerCo] = useState(''); // 특정 업체만(시트 업체명 클릭)
    const [sheetQ, setSheetQ] = useState(''); // 시트 검색 초기값(대시보드 재계약 임박 클릭)
    const goTab = (key: Tab) => {
        setTrackerInOnly(false);
        setTrackerCo('');
        setSheetQ('');
        setTab(key);
    };

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
                        ['crawl', '크롤링 현황'],
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
                        onClick={() => goTab(key)}
                        type="button"
                    >
                        {label}
                    </button>
                ))}
            </div>

            {tab === 'dashboard' ? (
                <DashboardTab
                    accounts={accounts}
                    posts={posts}
                    onGo={goTab}
                    onGoTracker10={() => {
                        setTrackerInOnly(true);
                        setTab('tracker');
                    }}
                    onGoSheetBlog={(name) => {
                        setSheetQ(name);
                        setTab('sheet');
                    }}
                    onToast={showToast}
                />
            ) : null}
            {tab === 'sheet' ? (
                <SheetTab
                    accounts={accounts}
                    posts={posts}
                    onReload={load}
                    onToast={showToast}
                    onGoCrawl={() => setTab('crawl')}
                    onGoTrackerBlog={(id) => {
                        setTrackerCo(id);
                        setTrackerInOnly(false);
                        setTab('tracker');
                    }}
                    initialQ={sheetQ}
                />
            ) : null}
            {tab === 'tracker' ? (
                <TrackerTab
                    accounts={accounts}
                    posts={posts}
                    onReload={load}
                    initialInOnly={trackerInOnly}
                    initialCo={trackerCo}
                />
            ) : null}
            {tab === 'crawl' ? (
                <CrawlStatusTab accounts={accounts} posts={posts} onReload={load} onToast={showToast} />
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

export default BlogRankPage;
