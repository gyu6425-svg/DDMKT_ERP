import type { Tab } from '../components/blogRank/lib/helpers';
import { BlogRankProvider, useBlogRank } from '../components/blogRank/lib/BlogRankContext';
import { SheetTab } from '../components/blogRank/pages/SheetTab';
import { TrackerTab } from '../components/blogRank/pages/TrackerTab';

// 기자단 ERP 포털 — 본인이 담당하는 블로그만(RLS 스코프) 읽기전용으로.
//   내 블로그(SheetTab, 관리 UI 숨김) + 순위 트래커(TrackerTab). 크롤/발급/편집 없음.
function ReporterShell() {
    const { accounts, posts, loading, error, reload, tab, goTab, toastMsg } = useBlogRank();

    // 기자단은 sheet/tracker 2탭만. dashboard 등으로 진입해도 sheet 로 취급.
    const active: 'sheet' | 'tracker' = tab === 'tracker' ? 'tracker' : 'sheet';

    return (
        <section className="grid gap-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">기자단 대시보드</h2>
                        <span className="rounded-full bg-[#ede9fe] px-2.5 py-1 text-xs font-bold text-[#6d28d9]">
                            기자단 뷰
                        </span>
                    </div>
                    <p className="mt-1 mb-0 text-sm text-[#64748b]">
                        내가 담당하는 블로그와 글 순위를 한눈에{' '}
                        {loading ? '· 불러오는 중...' : `· 블로그 ${accounts.length}개 · 글 ${posts.length}건`}
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
                        ['sheet', '내 블로그'],
                        ['tracker', '순위 트래커'],
                    ] as const
                ).map(([key, label]) => (
                    <button
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                            active === key ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8]'
                        }`}
                        key={key}
                        onClick={() => goTab(key as Tab)}
                        type="button"
                    >
                        {label}
                    </button>
                ))}
            </div>

            {active === 'tracker' ? <TrackerTab /> : <SheetTab />}

            {toastMsg ? (
                <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-[#0f172a] px-5 py-2.5 text-sm font-medium text-white shadow-lg">
                    {toastMsg}
                </div>
            ) : null}
        </section>
    );
}

function ReporterPortalPage() {
    return (
        <BlogRankProvider reporterMode>
            <ReporterShell />
        </BlogRankProvider>
    );
}

export default ReporterPortalPage;
