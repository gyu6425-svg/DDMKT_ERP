import { useEffect, useState } from 'react';
import { BlogRankProvider, useBlogRank } from '../components/blogRank/lib/BlogRankContext';
import type { Tab } from '../components/blogRank/lib/helpers';
import { DashboardTab } from '../components/blogRank/pages/DashboardTab';
import { SheetTab } from '../components/blogRank/pages/SheetTab';
import { TrackerTab } from '../components/blogRank/pages/TrackerTab';
import { useAuth } from '../hooks/useAuth';
import { createReport, getReports, resubmitReport, type BlogPostReport } from '../api/blogPostReports';

type RTab = 'dashboard' | 'sheet' | 'tracker' | 'report';

// 기자단 글 보고 탭 — 본인 담당 블로그에 쓴 글 URL을 보고. 내부(김다영 등)에게 알림이 감.
function ReportSubmitTab() {
    const { accounts, showToast } = useBlogRank();
    const { profile } = useAuth();
    const [blogId, setBlogId] = useState('');
    const [url, setUrl] = useState('');
    const [title, setTitle] = useState('');
    const [keyword, setKeyword] = useState('');
    const [saving, setSaving] = useState(false);
    const [mine, setMine] = useState<BlogPostReport[]>([]);
    // 재보고(반려 건 다시 보내기)
    const [reId, setReId] = useState<string | null>(null);
    const [reBlogId, setReBlogId] = useState('');
    const [reUrl, setReUrl] = useState('');
    const [reKeyword, setReKeyword] = useState('');
    const [reSaving, setReSaving] = useState(false);

    const loadMine = () => void getReports().then(({ data }) => setMine(data));
    useEffect(loadMine, []);

    const startRe = (r: BlogPostReport) => {
        setReId(r.id);
        setReBlogId(r.blog_account_id);
        setReUrl(r.post_url);
        setReKeyword(r.keyword || '');
    };
    const doRe = async (r: BlogPostReport) => {
        if (!reBlogId) return showToast('블로그를 선택하세요');
        if (!reUrl.trim()) return showToast('글 주소(URL)를 입력하세요');
        setReSaving(true);
        const { error } = await resubmitReport(r.id, {
            blog_account_id: reBlogId,
            post_url: reUrl.trim(),
            keyword: reKeyword.trim() || null,
            title: r.title,
        });
        setReSaving(false);
        if (error) return showToast('재보고 실패: ' + error.message);
        setReId(null);
        showToast('재보고 완료 · 다시 검토중으로 전환됩니다');
        loadMine();
    };

    const submit = async () => {
        if (!blogId) return showToast('블로그를 선택하세요');
        if (!url.trim()) return showToast('글 주소(URL)를 입력하세요');
        if (!profile?.id) return showToast('계정 정보를 확인할 수 없습니다');
        setSaving(true);
        const { error } = await createReport({
            blog_account_id: blogId,
            reporter_id: profile.id,
            post_url: url.trim(),
            title: title.trim() || null,
            keyword: keyword.trim() || null,
        });
        setSaving(false);
        if (error) return showToast('보고 실패: ' + error.message);
        setUrl('');
        setTitle('');
        setKeyword('');
        showToast('글 보고 완료 · 담당자에게 전달됩니다');
        loadMine();
    };

    const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name || '블로그';
    const statusTag = (s: BlogPostReport['status']) =>
        s === 'confirmed'
            ? { t: '확인됨', c: 'bg-[#dcfce7] text-[#16a34a]' }
            : s === 'rejected'
              ? { t: '반려', c: 'bg-[#fee2e2] text-[#dc2626]' }
              : { t: '검토 중', c: 'bg-[#fef3c7] text-[#b45309]' };

    return (
        <div className="grid gap-4">
            <div className="grid gap-2 rounded-lg border border-[#e2e8f0] bg-white p-4">
                <div className="text-sm font-bold text-[#0f172a]">새 글 보고</div>
                <label className="text-xs font-semibold text-[#475569]">
                    블로그
                    <select
                        className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                        onChange={(e) => setBlogId(e.target.value)}
                        value={blogId}
                    >
                        <option value="">담당 블로그 선택</option>
                        {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                                {a.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="text-xs font-semibold text-[#475569]">
                    글 주소(URL)
                    <input
                        className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://blog.naver.com/..."
                        value={url}
                    />
                </label>
                <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs font-semibold text-[#475569]">
                        제목(선택)
                        <input
                            className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="글 제목"
                            value={title}
                        />
                    </label>
                    <label className="text-xs font-semibold text-[#475569]">
                        키워드(선택)
                        <input
                            className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                            onChange={(e) => setKeyword(e.target.value)}
                            placeholder="노출 키워드"
                            value={keyword}
                        />
                    </label>
                </div>
                <div className="flex justify-end">
                    <button
                        className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        disabled={saving}
                        onClick={() => void submit()}
                        type="button"
                    >
                        {saving ? '보고 중…' : '글 보고'}
                    </button>
                </div>
            </div>

            <div className="grid gap-1">
                <div className="text-sm font-bold text-[#0f172a]">내 보고 내역</div>
                {mine.length === 0 ? (
                    <p className="m-0 rounded-md bg-[#f8fafc] px-4 py-6 text-center text-sm text-[#94a3b8]">
                        아직 보고한 글이 없습니다.
                    </p>
                ) : (
                    <div className="overflow-hidden rounded-md border border-[#e2e8f0] bg-white">
                        {mine.map((r) => {
                            const st = statusTag(r.status);
                            const editing = reId === r.id;
                            return (
                                <div
                                    className="border-b border-[#f1f5f9] px-3 py-2 text-sm last:border-b-0"
                                    key={r.id}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="truncate font-semibold text-[#334155]">
                                                {nameOf(r.blog_account_id)} · {r.title || '제목 없음'}
                                            </div>
                                            <a
                                                className="block truncate text-xs text-[#7c3aed] hover:underline"
                                                href={r.post_url}
                                                rel="noopener noreferrer"
                                                target="_blank"
                                            >
                                                {r.post_url}
                                            </a>
                                            {r.status === 'rejected' && r.note ? (
                                                <div className="mt-0.5 text-[11px] font-semibold text-[#dc2626]">
                                                    반려 사유: {r.note}
                                                </div>
                                            ) : null}
                                        </div>
                                        <div className="flex shrink-0 items-center gap-1">
                                            <span
                                                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${st.c}`}
                                            >
                                                {st.t}
                                            </span>
                                            {r.status === 'rejected' && !editing ? (
                                                <button
                                                    className="rounded border border-[#1e40af] px-2 py-0.5 text-[11px] font-semibold text-[#1e40af] hover:bg-[#eff6ff]"
                                                    onClick={() => startRe(r)}
                                                    type="button"
                                                >
                                                    재보고
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                    {editing ? (
                                        <div className="mt-2 grid gap-2 rounded-md border border-[#c7d2fe] bg-[#eef2ff] p-2">
                                            <select
                                                className="h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                                                onChange={(e) => setReBlogId(e.target.value)}
                                                value={reBlogId}
                                            >
                                                <option value="">블로그 선택</option>
                                                {accounts.map((a) => (
                                                    <option key={a.id} value={a.id}>
                                                        {a.name}
                                                    </option>
                                                ))}
                                            </select>
                                            <input
                                                className="h-9 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                                                onChange={(e) => setReUrl(e.target.value)}
                                                placeholder="글 주소(URL)"
                                                value={reUrl}
                                            />
                                            <input
                                                className="h-9 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                                                onChange={(e) => setReKeyword(e.target.value)}
                                                placeholder="키워드(선택)"
                                                value={reKeyword}
                                            />
                                            <div className="flex justify-end gap-1">
                                                <button
                                                    className="rounded-md border border-[#cbd5e1] px-3 py-1.5 text-xs font-semibold text-[#64748b]"
                                                    onClick={() => setReId(null)}
                                                    type="button"
                                                >
                                                    취소
                                                </button>
                                                <button
                                                    className="rounded-md bg-[#1e40af] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                                                    disabled={reSaving}
                                                    onClick={() => void doRe(r)}
                                                    type="button"
                                                >
                                                    {reSaving ? '보고 중…' : '글 보고'}
                                                </button>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

// 기자단 ERP 포털 — 본인 담당 블로그만(RLS 스코프) 읽기전용 + 글 보고.
function ReporterShell() {
    const { accounts, posts, loading, error, reload, toastMsg, tab, goTab } = useBlogRank();
    // 대시보드/내블로그/순위는 context tab 사용(대시보드 KPI 클릭 네비게이션이 먹히도록). 글 보고는 별도 플래그.
    const [reportMode, setReportMode] = useState(false);
    const active: RTab = reportMode ? 'report' : tab === 'sheet' ? 'sheet' : tab === 'tracker' ? 'tracker' : 'dashboard';
    const select = (key: RTab) => {
        if (key === 'report') {
            setReportMode(true);
            return;
        }
        setReportMode(false);
        goTab(key as Tab);
    };

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
                        ['dashboard', '대시보드'],
                        ['sheet', '내 블로그'],
                        ['tracker', '순위 트래커'],
                        ['report', '글 보고'],
                    ] as const
                ).map(([key, label]) => (
                    <button
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                            active === key ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8]'
                        }`}
                        key={key}
                        onClick={() => select(key as RTab)}
                        type="button"
                    >
                        {label}
                    </button>
                ))}
            </div>

            {active === 'dashboard' ? <DashboardTab /> : null}
            {active === 'sheet' ? <SheetTab /> : null}
            {active === 'tracker' ? <TrackerTab /> : null}
            {active === 'report' ? <ReportSubmitTab /> : null}

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
