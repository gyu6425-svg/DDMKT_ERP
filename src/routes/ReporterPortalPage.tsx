import { useEffect, useState } from 'react';
import { BlogRankProvider, useBlogRank } from '../components/blogRank/lib/BlogRankContext';
import type { Tab } from '../components/blogRank/lib/helpers';
import { DashboardTab } from '../components/blogRank/pages/DashboardTab';
import { SheetTab } from '../components/blogRank/pages/SheetTab';
import { TrackerTab } from '../components/blogRank/pages/TrackerTab';
import { useAuth } from '../hooks/useAuth';
import { useAsParam } from './CustomerCategoryPage';
import { createReport, getReports, markPublished, publishOutUnit, resubmitReport, type BlogPostReport, type ReportType } from '../api/blogPostReports';
import { getReporters } from '../api/blogRank';

type RTab = 'dashboard' | 'sheet' | 'tracker' | 'report' | 'settlement';

// 기자단 글 보고 탭 — 본인 담당 블로그에 쓴 글 URL을 보고. 내부(김다영 등)에게 알림이 감.
function ReportSubmitTab() {
    const { accounts, showToast } = useBlogRank();
    const { profile } = useAuth();
    const [blogId, setBlogId] = useState('');
    const [url, setUrl] = useState('');
    const [title, setTitle] = useState('');
    const [keyword, setKeyword] = useState('');
    const [saving, setSaving] = useState<ReportType | null>(null);
    const [publishing, setPublishing] = useState<string | null>(null);
    const [mine, setMine] = useState<BlogPostReport[]>([]);
    // 내 보고 내역 필터 — 저장/발행 탭 + 블로그별 탭
    const [histTab, setHistTab] = useState<ReportType>('save');
    const [blogFilter, setBlogFilter] = useState('all');
    // 재보고(반려 건 다시 보내기)
    const [reId, setReId] = useState<string | null>(null);
    const [reBlogId, setReBlogId] = useState('');
    const [reUrl, setReUrl] = useState('');
    const [reTitle, setReTitle] = useState('');
    const [reKeyword, setReKeyword] = useState('');
    const [reSaving, setReSaving] = useState(false);

    const loadMine = () => void getReports().then(({ data }) => setMine(data));
    useEffect(loadMine, []);

    const typeOf = (r: BlogPostReport): ReportType => r.report_type ?? 'save';

    const startRe = (r: BlogPostReport) => {
        setReId(r.id);
        setReBlogId(r.blog_account_id);
        setReUrl(r.post_url);
        setReTitle(r.title ?? '');
        setReKeyword(r.keyword || '');
    };
    const doRe = async (r: BlogPostReport) => {
        if (!reBlogId) return showToast('블로그를 선택하세요');
        if (!reUrl.trim()) return showToast('글 주소(URL)를 입력하세요');
        if (!reTitle.trim()) return showToast('제목을 입력하세요(필수)');
        setReSaving(true);
        const { error } = await resubmitReport(r.id, {
            blog_account_id: reBlogId,
            post_url: reUrl.trim(),
            keyword: reKeyword.trim() || null,
            title: reTitle.trim(),
            report_type: typeOf(r),
        });
        setReSaving(false);
        if (error) return showToast('재보고 실패: ' + error.message);
        setReId(null);
        showToast('재보고 완료 · 다시 검토중으로 전환됩니다');
        loadMine();
    };

    const submit = async (type: ReportType) => {
        if (!blogId) return showToast('블로그를 선택하세요');
        if (!url.trim()) return showToast('글 주소(URL)를 입력하세요');
        if (!title.trim()) return showToast('제목을 입력하세요(필수)');
        if (!profile?.id) return showToast('계정 정보를 확인할 수 없습니다');
        setSaving(type);
        const { error, duplicate } = await createReport({
            blog_account_id: blogId,
            reporter_id: profile.id,
            post_url: url.trim(),
            title: title.trim(),
            report_type: type,
            keyword: keyword.trim() || null,
        });
        setSaving(null);
        if (error) return showToast('보고 실패: ' + error.message);
        // 같은 제목/URL을 같은 구분으로 이미 보고한 글 → 중복 등록 방지 알림.
        if (duplicate) {
            setHistTab(type);
            showToast('이미 등록한 글입니다 · 제목이 동일한 보고가 있어요');
            loadMine();
            return;
        }
        setUrl('');
        setTitle('');
        setKeyword('');
        setHistTab(type);
        showToast(`${type === 'publish' ? '발행' : '저장'} 보고 완료 · 담당자에게 전달됩니다`);
        loadMine();
    };

    // 기자단 '발행' 처리 — 저장으로 보고한 글을 발행쪽 히스토리로 이동(재카운트 없음).
    const doPublish = async (r: BlogPostReport) => {
        setPublishing(r.id);
        const { error } = await markPublished(r.id);
        setPublishing(null);
        if (error) return showToast('발행 처리 실패: ' + error.message);
        showToast('발행으로 이동됨 · 발행 히스토리에 표시됩니다');
        loadMine();
    };

    const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name || '블로그';
    const statusTag = (s: BlogPostReport['status']) =>
        s === 'confirmed' || s === 'published'
            ? { t: '승인됨', c: 'bg-[#dcfce7] text-[#16a34a]' }
            : s === 'rejected'
              ? { t: '반려', c: 'bg-[#fee2e2] text-[#dc2626]' }
              : { t: '검토 중', c: 'bg-[#fef3c7] text-[#b45309]' };

    const countType = (t: ReportType) => mine.filter((r) => typeOf(r) === t).length;
    const filtered = mine.filter(
        (r) => typeOf(r) === histTab && (blogFilter === 'all' || r.blog_account_id === blogFilter),
    );

    const inputCls = 'mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm';

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
                    제목(필수)
                    <input
                        className={inputCls}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="글 제목 (제목으로 구분됩니다)"
                        value={title}
                    />
                </label>
                <label className="text-xs font-semibold text-[#475569]">
                    글 주소(URL)
                    <input
                        className={inputCls}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://blog.naver.com/..."
                        value={url}
                    />
                </label>
                <label className="text-xs font-semibold text-[#475569]">
                    키워드(선택)
                    <input
                        className={inputCls}
                        onChange={(e) => setKeyword(e.target.value)}
                        placeholder="노출 키워드"
                        value={keyword}
                    />
                </label>
                <div className="mt-1 flex justify-end gap-2">
                    <button
                        className="rounded-md border border-[#1e40af] bg-white px-4 py-2 text-sm font-bold text-[#1e40af] hover:bg-[#eff6ff] disabled:opacity-60"
                        disabled={!!saving}
                        onClick={() => void submit('save')}
                        type="button"
                    >
                        {saving === 'save' ? '보고 중…' : '📝 저장으로 보고'}
                    </button>
                    <button
                        className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-bold text-white hover:bg-[#1e3a8a] disabled:opacity-60"
                        disabled={!!saving}
                        onClick={() => void submit('publish')}
                        type="button"
                    >
                        {saving === 'publish' ? '보고 중…' : '🚀 발행으로 보고'}
                    </button>
                </div>
                <p className="m-0 text-[11px] text-[#94a3b8]">
                    보통은 <b>저장</b>으로 먼저 보고해 업체가 확인합니다. 담당자가 승인하면 계약 1건 카운트됩니다.
                </p>
            </div>

            <div className="grid gap-2">
                <div className="text-sm font-bold text-[#0f172a]">내 보고 내역</div>
                {/* 저장/발행 탭 */}
                <div className="flex gap-1 border-b border-[#e2e8f0]">
                    {(
                        [
                            ['save', '저장'],
                            ['publish', '발행'],
                        ] as [ReportType, string][]
                    ).map(([k, label]) => (
                        <button
                            className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold ${
                                histTab === k ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8]'
                            }`}
                            key={k}
                            onClick={() => setHistTab(k)}
                            type="button"
                        >
                            {label} <span className="text-xs">({countType(k)})</span>
                        </button>
                    ))}
                </div>
                {/* 블로그별 필터(담당 블로그 여러 개면 헷갈리지 않게) */}
                {accounts.length > 1 ? (
                    <div className="flex flex-wrap gap-1.5">
                        {[{ id: 'all', name: '전체' }, ...accounts].map((a) => (
                            <button
                                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                                    blogFilter === a.id
                                        ? 'border-[#1e40af] bg-[#1e40af] text-white'
                                        : 'border-[#cbd5e1] bg-white text-[#475569]'
                                }`}
                                key={a.id}
                                onClick={() => setBlogFilter(a.id)}
                                type="button"
                            >
                                {a.name}
                            </button>
                        ))}
                    </div>
                ) : null}

                {filtered.length === 0 ? (
                    <p className="m-0 rounded-md bg-[#f8fafc] px-4 py-6 text-center text-sm text-[#94a3b8]">
                        {histTab === 'save' ? '저장 보고 내역이 없습니다.' : '발행 보고 내역이 없습니다.'}
                    </p>
                ) : (
                    <div className="overflow-hidden rounded-md border border-[#e2e8f0] bg-white">
                        {filtered.map((r) => {
                            const st = statusTag(r.status);
                            const editing = reId === r.id;
                            return (
                                <div className="border-b border-[#f1f5f9] px-3 py-2 text-sm last:border-b-0" key={r.id}>
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
                                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${st.c}`}>
                                                {st.t}
                                            </span>
                                            {/* 저장 탭 항목엔 '발행' 버튼 — 눌러 발행 히스토리로 이동(재카운트 없음) */}
                                            {histTab === 'save' && r.status !== 'rejected' ? (
                                                <button
                                                    className="rounded bg-[#059669] px-2 py-0.5 text-[11px] font-bold text-white hover:bg-[#047857] disabled:opacity-50"
                                                    disabled={publishing === r.id}
                                                    onClick={() => void doPublish(r)}
                                                    title="이 글을 발행했다면 눌러 발행 히스토리로 이동"
                                                    type="button"
                                                >
                                                    {publishing === r.id ? '…' : '발행'}
                                                </button>
                                            ) : null}
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
                                                onChange={(e) => setReTitle(e.target.value)}
                                                placeholder="제목(필수)"
                                                value={reTitle}
                                            />
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
                                                    {reSaving ? '보고 중…' : '재보고'}
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

// 정산 내역 탭 — 회사가 '승인'해 확정된 보고 = 외주비(건당 8,000원, 대박종합주방 10,000)가 쌓인 내역.
//   컬럼: 성함 · 업체 · 글 제목 · 금액. (회차 n/n은 진행률 기준으로 추후 반영) 읽기 전용.
function SettlementTab() {
    const { accounts } = useBlogRank();
    const { profile } = useAuth();
    const [rows, setRows] = useState<BlogPostReport[]>([]);
    const [names, setNames] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        void Promise.all([getReports(), getReporters()]).then(([rep, reps]) => {
            if (!alive) return;
            // 승인 확정(= 외주비 계상됨)만: confirmed(현행) / published(구 데이터).
            setRows(rep.data.filter((r) => r.status === 'confirmed' || r.status === 'published'));
            const m: Record<string, string> = {};
            reps.data.forEach((r) => (m[r.id] = r.name || r.email));
            setNames(m);
            setLoading(false);
        });
        return () => {
            alive = false;
        };
    }, []);

    const companyOf = (id: string) => accounts.find((a) => a.id === id)?.name || '블로그';
    const reporterName = (r: BlogPostReport) =>
        (r.reporter_id ? names[r.reporter_id] : null) || profile?.name || '기자단';
    const amountOf = (r: BlogPostReport) => publishOutUnit(companyOf(r.blog_account_id));
    const total = rows.reduce((s, r) => s + amountOf(r), 0);

    return (
        <div className="grid gap-3">
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-5">
                <div className="flex items-center justify-between">
                    <div className="text-sm font-bold text-[#0f172a]">정산 내역</div>
                    <div className="text-sm text-[#64748b]">
                        누적 외주비{' '}
                        <b className="text-[#1e40af]">{total.toLocaleString('ko-KR')}원</b> · {rows.length}건
                    </div>
                </div>
                <p className="mt-1 mb-0 text-xs text-[#94a3b8]">
                    회사에서 <b>승인</b>한 글에 대해 건당 외주비(8,000원 · 대박종합주방 10,000원)가 자동으로 쌓입니다.
                </p>
            </div>
            <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-4 py-2 font-semibold">성함</th>
                            <th className="px-4 py-2 font-semibold">업체</th>
                            <th className="px-4 py-2 font-semibold">글 제목</th>
                            <th className="px-4 py-2 text-right font-semibold">금액</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td className="px-4 py-10 text-center text-sm text-[#94a3b8]" colSpan={4}>
                                    불러오는 중…
                                </td>
                            </tr>
                        ) : rows.length ? (
                            rows.map((r) => (
                                <tr className="border-b border-[#f1f5f9] last:border-b-0" key={r.id}>
                                    <td className="px-4 py-2 font-semibold text-[#334155]">{reporterName(r)}</td>
                                    <td className="px-4 py-2 text-[#475569]">{companyOf(r.blog_account_id)}</td>
                                    <td className="max-w-[320px] truncate px-4 py-2 text-[#475569]">
                                        {r.title || '제목 없음'}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-2 text-right font-bold text-[#1e40af]">
                                        {amountOf(r).toLocaleString('ko-KR')}원
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td className="px-4 py-10 text-center text-sm text-[#94a3b8]" colSpan={4}>
                                    아직 승인되어 정산된 글이 없습니다.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// 기자단 ERP 포털 — 본인 담당 블로그만(RLS 스코프) 읽기전용 + 글 보고.
function ReporterShell() {
    const { accounts, posts, loading, error, reload, toastMsg, tab, goTab } = useBlogRank();
    // 대시보드/내블로그/순위는 context tab 사용(대시보드 KPI 클릭 네비게이션이 먹히도록). 글 보고·정산 내역은 별도 플래그.
    const [extraTab, setExtraTab] = useState<'report' | 'settlement' | null>(null);
    const active: RTab = extraTab
        ? extraTab
        : tab === 'sheet'
          ? 'sheet'
          : tab === 'tracker'
            ? 'tracker'
            : 'dashboard';
    const select = (key: RTab) => {
        if (key === 'report' || key === 'settlement') {
            setExtraTab(key);
            return;
        }
        setExtraTab(null);
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
                        ['settlement', '정산 내역'],
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
            {active === 'settlement' ? <SettlementTab /> : null}

            {toastMsg ? (
                <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-[#0f172a] px-5 py-2.5 text-sm font-medium text-white shadow-lg">
                    {toastMsg}
                </div>
            ) : null}
        </section>
    );
}

function ReporterPortalPage() {
    const as = useAsParam(); // 내부 미리보기 대상 기자단 id(있으면 그 기자단 시점)
    return (
        <BlogRankProvider previewReporterId={as || null} reporterMode>
            <ReporterShell />
        </BlogRankProvider>
    );
}

export default ReporterPortalPage;
