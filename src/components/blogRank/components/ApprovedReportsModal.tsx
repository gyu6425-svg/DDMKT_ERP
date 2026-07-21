import { useEffect, useMemo, useState } from 'react';
import { getReports, setReportPaid, setReportSettled, type BlogPostReport, type ReportType } from '../../../api/blogPostReports';
import { getProfiles } from '../../../api/profiles';
import { getReporters } from '../../../api/blogRank';

// 블로그 종류 칩 색상 — 브랜드=파랑 · 최적화=초록 · 준최적화=주황 · 저인망=보라.
function kindChipCls(kind: string | null | undefined): string {
    const k = kind ?? '브랜드 블로그';
    if (k === '최적화') return 'bg-[#dcfce7] text-[#15803d]';
    if (k === '준최적화') return 'bg-[#fef3c7] text-[#b45309]';
    if (k === '저인망 배포') return 'bg-[#ede9fe] text-[#7c3aed]';
    return 'bg-[#dbeafe] text-[#1e40af]';
}

// 기자단 승인 처리 내역(내부) — 승인(confirmed)·발행완료(published) 보고를 히스토리 표로.
//   컬럼: 업로드일 / 승인일 / 승인직원 / 업체 / 기자단 / 블로그종류 / 제목 / 회차 / 구분 / 입금 처리.
//   기자단별 드롭다운 필터 · 입금 버튼(누르면 기자단 정산·계약 진행이력이 함께 처리로 전환).
export function ApprovedReportsModal({
    blogNameOf,
    accounts,
    onClose,
}: {
    blogNameOf: (id: string) => string;
    accounts: { id: string; name: string }[];
    onClose: () => void;
}) {
    const [reports, setReports] = useState<BlogPostReport[]>([]);
    const [nameMap, setNameMap] = useState<Record<string, string>>({}); // 직원(reviewed_by) 이름
    const [reporterMap, setReporterMap] = useState<Record<string, string>>({}); // 기자단(reporter_id) 이름
    const [loading, setLoading] = useState(true);
    // 탭 — 전체/저장/발행은 '미입금'만 보여주고, 입금 처리된 건은 '입금 완료' 탭으로 이동한다.
    const [typeTab, setTypeTab] = useState<'all' | ReportType | 'paid'>('all');
    const [blogFilter, setBlogFilter] = useState('all');
    const [reporterFilter, setReporterFilter] = useState('all');
    const [paying, setPaying] = useState<string | null>(null);
    const [settling, setSettling] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        void (async () => {
            const [conf, pub, reps] = await Promise.all([
                getReports({ status: 'confirmed' }),
                getReports({ status: 'published' }),
                getReporters(),
            ]);
            if (!alive) return;
            const merged = [...conf.data, ...pub.data].sort((a, b) =>
                (b.reviewed_at || b.created_at || '').localeCompare(a.reviewed_at || a.created_at || ''),
            );
            setReports(merged);
            const rmap: Record<string, string> = {};
            for (const r of reps.data) rmap[r.id] = r.name || r.email;
            setReporterMap(rmap);
            // 승인 직원 이름 매핑(관리자만 profiles 조회 가능 — 실패 시 '—' 폴백).
            const { data: profs } = await getProfiles();
            const map: Record<string, string> = {};
            for (const p of profs) map[p.id] = p.name || p.email || '직원';
            setNameMap(map);
            setLoading(false);
        })();
        return () => {
            alive = false;
        };
    }, []);

    const typeOf = (r: BlogPostReport): ReportType => r.report_type ?? 'save';
    const reporterNameOf = (r: BlogPostReport) => (r.reporter_id ? reporterMap[r.reporter_id] || '기자단' : '기자단');
    // 미입금(입금 전) 기준 집계 — 입금 처리하면 '입금 완료' 탭으로 넘어간다.
    const unpaid = reports.filter((r) => !r.paid);
    const nUnpaid = unpaid.length;
    const nSave = unpaid.filter((r) => typeOf(r) === 'save').length;
    const nPub = unpaid.filter((r) => typeOf(r) === 'publish').length;
    const nPaid = reports.length - nUnpaid;

    // 기자단 드롭다운 옵션 — 목록에 등장하는 기자단만.
    const reporterOpts = useMemo(() => {
        const ids = new Set<string>();
        reports.forEach((r) => r.reporter_id && ids.add(r.reporter_id));
        return [...ids].map((id) => ({ id, name: reporterMap[id] || '기자단' })).sort((a, b) => a.name.localeCompare(b.name));
    }, [reports, reporterMap]);

    const filtered = useMemo(
        () =>
            reports.filter((r) => {
                // 입금 완료 탭 = 입금된 건만. 그 외 탭 = 미입금 건만(입금하면 목록에서 빠져 입금 완료로 이동).
                if (typeTab === 'paid') {
                    if (!r.paid) return false;
                } else {
                    if (r.paid) return false;
                    if (typeTab !== 'all' && typeOf(r) !== typeTab) return false;
                }
                return (
                    (blogFilter === 'all' || r.blog_account_id === blogFilter) &&
                    (reporterFilter === 'all' || r.reporter_id === reporterFilter)
                );
            }),
        [reports, typeTab, blogFilter, reporterFilter],
    );

    const dateOf = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');

    // 입금 처리 토글 — 정산(report.paid) + 계약 진행이력(week=rpt-id) 동기화.
    const togglePay = async (r: BlogPostReport) => {
        setPaying(r.id);
        const next = !r.paid;
        const { error } = await setReportPaid(r, next);
        setPaying(null);
        if (error) {
            alert('입금 처리 실패: ' + error.message);
            return;
        }
        setReports((prev) => prev.map((x) => (x.id === r.id ? { ...x, paid: next } : x)));
    };

    // 정산 토글(정산/미정산) — 입금의 전 단계 상태 구분. 입금·외주비엔 영향 없음.
    const toggleSettled = async (r: BlogPostReport) => {
        setSettling(r.id);
        const next = !r.settled;
        const { error } = await setReportSettled(r, next);
        setSettling(null);
        if (error) {
            alert('정산 처리 실패: ' + error.message + '\n(blog_post_reports.settled 컬럼이 없으면 docs/blog-report-settled.sql 실행 필요)');
            return;
        }
        setReports((prev) => prev.map((x) => (x.id === r.id ? { ...x, settled: next } : x)));
    };

    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="max-h-[88vh] w-[min(1180px,97vw)] overflow-y-auto rounded-2xl bg-white p-6">
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <h3 className="m-0 text-lg font-bold text-[#0f172a]">기자단 승인 처리 내역</h3>
                        <p className="m-0 mt-0.5 text-[12px] text-[#94a3b8]">
                            승인·발행완료된 기자단 글 · 총 {reports.length}건 (미입금 {nUnpaid} · 입금완료 {nPaid})
                        </p>
                    </div>
                    <button
                        className="rounded-md border border-[#cbd5e1] px-3 py-1 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                </div>

                {/* 저장/발행 탭 */}
                <div className="mb-2 flex gap-1 border-b border-[#e2e8f0]">
                    {(
                        [
                            ['all', `전체 (${nUnpaid})`],
                            ['save', `저장 (${nSave})`],
                            ['publish', `발행 (${nPub})`],
                            ['paid', `입금 완료 (${nPaid})`],
                        ] as ['all' | ReportType | 'paid', string][]
                    ).map(([k, label]) => (
                        <button
                            className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold ${
                                typeTab === k
                                    ? k === 'paid'
                                        ? 'border-[#2563eb] text-[#2563eb]' // 입금 완료 = 파랑(미입금과 구분)
                                        : 'border-[#16a34a] text-[#16a34a]'
                                    : 'border-transparent text-[#94a3b8]'
                            }`}
                            key={k}
                            onClick={() => setTypeTab(k)}
                            type="button"
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* 필터 — 기자단 · 업체 드롭다운 */}
                <div className="mb-3 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-[#64748b]">기자단</span>
                        <select
                            className="h-9 min-w-[150px] rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                            onChange={(e) => setReporterFilter(e.target.value)}
                            value={reporterFilter}
                        >
                            <option value="all">전체 기자단</option>
                            {reporterOpts.map((o) => (
                                <option key={o.id} value={o.id}>
                                    {o.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    {accounts.length > 1 ? (
                        <div className="flex items-center gap-2">
                            <span className="text-[12px] font-semibold text-[#64748b]">업체</span>
                            <select
                                className="h-9 min-w-[150px] rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                                onChange={(e) => setBlogFilter(e.target.value)}
                                value={blogFilter}
                            >
                                <option value="all">전체 업체</option>
                                {accounts.map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ) : null}
                </div>

                {loading ? (
                    <div className="py-12 text-center text-sm text-[#94a3b8]">불러오는 중...</div>
                ) : filtered.length === 0 ? (
                    <div className="py-12 text-center text-sm text-[#94a3b8]">승인 처리된 글이 없습니다.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr className="border-b border-[#e2e8f0] text-left text-[12px] text-[#64748b]">
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">업로드일</th>
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">승인일</th>
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">승인 직원</th>
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">업체</th>
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">기자단</th>
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">블로그 종류</th>
                                    <th className="px-2 py-2 font-semibold">제목</th>
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">회차</th>
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">구분</th>
                                    <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">정산</th>
                                    <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">입금 처리</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((r) => (
                                    <tr className="border-b border-[#f1f5f9] align-top" key={r.id}>
                                        <td className="whitespace-nowrap px-2 py-2 text-[#475569]">{dateOf(r.created_at)}</td>
                                        <td className="whitespace-nowrap px-2 py-2 text-[#475569]">{dateOf(r.reviewed_at)}</td>
                                        <td className="whitespace-nowrap px-2 py-2 font-semibold text-[#334155]">
                                            {r.reviewed_by ? nameMap[r.reviewed_by] || '—' : '—'}
                                        </td>
                                        <td className="whitespace-nowrap px-2 py-2 text-[#334155]">{blogNameOf(r.blog_account_id)}</td>
                                        <td className="whitespace-nowrap px-2 py-2">
                                            <span className="rounded-full bg-[#e0e7ff] px-2 py-0.5 text-[11px] font-bold text-[#4338ca]">
                                                {reporterNameOf(r)}
                                            </span>
                                        </td>
                                        <td className="whitespace-nowrap px-2 py-2">
                                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${kindChipCls(r.blog_kind)}`}>
                                                {r.blog_kind ?? '브랜드 블로그'}
                                            </span>
                                        </td>
                                        <td className="px-2 py-2 text-[#0f172a]">
                                            {r.post_url ? (
                                                <a className="hover:underline" href={r.post_url} rel="noopener noreferrer" target="_blank">
                                                    {r.title || r.post_url}
                                                </a>
                                            ) : (
                                                r.title || '—'
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-2 py-2 text-[#475569]">
                                            {r.round != null ? `${r.round}회차` : '—'}
                                        </td>
                                        <td className="whitespace-nowrap px-2 py-2">
                                            {typeOf(r) === 'publish' ? (
                                                <span className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-[11px] font-bold text-[#1e40af]">발행</span>
                                            ) : (
                                                <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[11px] font-bold text-[#16a34a]">저장</span>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-2 py-2 text-center">
                                            <button
                                                className={`rounded-md px-2.5 py-1 text-[11px] font-bold disabled:opacity-50 ${
                                                    r.settled
                                                        ? 'bg-[#ede9fe] text-[#6d28d9] hover:bg-[#ddd6fe]'
                                                        : 'border border-[#cbd5e1] bg-white text-[#64748b] hover:bg-[#f1f5f9]'
                                                }`}
                                                disabled={settling === r.id}
                                                onClick={() => void toggleSettled(r)}
                                                title={r.settled ? '클릭 시 미정산으로 되돌림' : '정산 처리(입금 전 단계) — 입금·외주비엔 영향 없음'}
                                                type="button"
                                            >
                                                {settling === r.id ? '처리 중…' : r.settled ? '정산' : '미정산'}
                                            </button>
                                        </td>
                                        <td className="whitespace-nowrap px-2 py-2 text-center">
                                            <button
                                                className={`rounded-md px-2.5 py-1 text-[11px] font-bold disabled:opacity-50 ${
                                                    r.paid
                                                        ? 'bg-[#dcfce7] text-[#15803d] hover:bg-[#bbf7d0]'
                                                        : 'bg-[#1e40af] text-white hover:bg-[#1e3a8a]'
                                                }`}
                                                disabled={paying === r.id}
                                                onClick={() => void togglePay(r)}
                                                title={r.paid ? '클릭 시 미입금으로 되돌림' : '입금 처리 — 기자단 정산·계약 진행이력에 함께 반영'}
                                                type="button"
                                            >
                                                {paying === r.id ? '처리 중…' : r.paid ? '입금완료' : '입금'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
