import BlogPage from './BlogPage';
import type { Tab } from '../components/blogRank/lib/helpers';
import { BlogRankProvider, useBlogRank } from '../components/blogRank/lib/BlogRankContext';
import { DashboardTab } from '../components/blogRank/pages/DashboardTab';
import { SheetTab } from '../components/blogRank/pages/SheetTab';
import { TrackerTab } from '../components/blogRank/pages/TrackerTab';
import { CrawlStatusTab } from '../components/blogRank/pages/CrawlStatusTab';

// 블로그 대시보드 = 얇은 셸: Provider(공유 상태) + 헤더 + 탭바 + 활성 페이지.
//   5개 기능은 각자 useBlogRank()로 필요한 값만 읽는 독립 페이지 컴포넌트.
function BlogRankShell() {
    const { isAdmin, authLoading, accounts, posts, loading, error, reload, tab, goTab, toastMsg } = useBlogRank();

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
                    onClick={() => void reload()}
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
                        onClick={() => goTab(key as Tab)}
                        type="button"
                    >
                        {label}
                    </button>
                ))}
            </div>

            {tab === 'dashboard' ? <DashboardTab /> : null}
            {tab === 'sheet' ? <SheetTab /> : null}
            {tab === 'tracker' ? <TrackerTab /> : null}
            {tab === 'crawl' ? <CrawlStatusTab /> : null}
            {tab === 'writer' ? <BlogPage /> : null}

            {toastMsg ? (
                <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-[#0f172a] px-5 py-2.5 text-sm font-medium text-white shadow-lg">
                    {toastMsg}
                </div>
            ) : null}
        </section>
    );
}

function BlogRankPage() {
    return (
        <BlogRankProvider>
            <BlogRankShell />
        </BlogRankProvider>
    );
}

export default BlogRankPage;
