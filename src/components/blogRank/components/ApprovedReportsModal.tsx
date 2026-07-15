import { useEffect, useMemo, useState } from 'react';
import { getReports, type BlogPostReport, type ReportType } from '../../../api/blogPostReports';
import { getProfiles } from '../../../api/profiles';

// 기자단 승인 처리 내역(내부) — 승인(confirmed)·발행완료(published) 보고를 히스토리 표로.
//   컬럼: 업로드일 / 승인일 / 승인직원 / 업체 / 제목 / 회차 / 구분(저장·발행). 최근 승인순.
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
    const [nameMap, setNameMap] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [typeTab, setTypeTab] = useState<'all' | ReportType>('all');
    const [blogFilter, setBlogFilter] = useState('all');

    useEffect(() => {
        let alive = true;
        setLoading(true);
        void (async () => {
            const [conf, pub] = await Promise.all([
                getReports({ status: 'confirmed' }),
                getReports({ status: 'published' }),
            ]);
            if (!alive) return;
            const merged = [...conf.data, ...pub.data].sort((a, b) =>
                (b.reviewed_at || b.created_at || '').localeCompare(a.reviewed_at || a.created_at || ''),
            );
            setReports(merged);
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
    const nSave = reports.filter((r) => typeOf(r) === 'save').length;
    const nPub = reports.filter((r) => typeOf(r) === 'publish').length;
    const filtered = useMemo(
        () =>
            reports.filter(
                (r) =>
                    (typeTab === 'all' || typeOf(r) === typeTab) &&
                    (blogFilter === 'all' || r.blog_account_id === blogFilter),
            ),
        [reports, typeTab, blogFilter],
    );

    const dateOf = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');

    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="max-h-[88vh] w-[min(1040px,97vw)] overflow-y-auto rounded-2xl bg-white p-6">
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <h3 className="m-0 text-lg font-bold text-[#0f172a]">기자단 승인 처리 내역</h3>
                        <p className="m-0 mt-0.5 text-[12px] text-[#94a3b8]">
                            승인·발행완료된 기자단 글 전체 · 총 {reports.length}건
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
                            ['all', `전체 (${reports.length})`],
                            ['save', `저장 (${nSave})`],
                            ['publish', `발행 (${nPub})`],
                        ] as ['all' | ReportType, string][]
                    ).map(([k, label]) => (
                        <button
                            className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold ${
                                typeTab === k ? 'border-[#16a34a] text-[#16a34a]' : 'border-transparent text-[#94a3b8]'
                            }`}
                            key={k}
                            onClick={() => setTypeTab(k)}
                            type="button"
                        >
                            {label}
                        </button>
                    ))}
                </div>
                {/* 블로그(업체)별 필터 — 드롭다운 */}
                {accounts.length > 1 ? (
                    <div className="mb-3 flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-[#64748b]">업체</span>
                        <select
                            className="h-9 min-w-[180px] rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
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
                                    <th className="px-2 py-2 font-semibold">제목</th>
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">회차</th>
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">구분</th>
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
