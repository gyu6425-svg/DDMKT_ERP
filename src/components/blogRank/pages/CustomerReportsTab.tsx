import { useEffect, useMemo, useState } from 'react';
import { getReports, type BlogPostReport, type ReportStatus, type ReportType } from '../../../api/blogPostReports';
import { useBlogRank } from '../lib/BlogRankContext';

// 고객 ERP — '저장,발행 성과' 탭. 본인 업체 블로그들의 기자단 저장/발행 보고 이력(읽기 전용).
//   RLS(bpr 고객 본인 읽기)로 본인 업체 블로그 보고만 조회. 블로그별 + 저장/발행 필터.
const TYPE_BADGE: Record<ReportType, { t: string; c: string }> = {
    save: { t: '저장', c: 'bg-[#eef2ff] text-[#4338ca]' },
    publish: { t: '발행', c: 'bg-[#ecfdf5] text-[#047857]' },
};
const STATUS_BADGE: Record<ReportStatus, { t: string; c: string }> = {
    pending: { t: '승인 대기', c: 'bg-[#fef9c3] text-[#a16207]' },
    confirmed: { t: '승인됨', c: 'bg-[#dcfce7] text-[#15803d]' },
    rejected: { t: '반려', c: 'bg-[#fee2e2] text-[#b91c1c]' },
    published: { t: '발행완료', c: 'bg-[#dbeafe] text-[#1d4ed8]' },
};

export function CustomerReportsTab() {
    const { accounts } = useBlogRank();
    const [reports, setReports] = useState<BlogPostReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [typeFilter, setTypeFilter] = useState<'all' | ReportType>('all');
    const [blogFilter, setBlogFilter] = useState('all');

    useEffect(() => {
        let alive = true;
        setLoading(true);
        void getReports().then(({ data }) => {
            if (!alive) return;
            setReports(data);
            setLoading(false);
        });
        return () => {
            alive = false;
        };
    }, []);

    const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name || '블로그';
    const rows = useMemo(
        () =>
            reports.filter(
                (r) =>
                    (typeFilter === 'all' || (r.report_type ?? 'save') === typeFilter) &&
                    (blogFilter === 'all' || r.blog_account_id === blogFilter),
            ),
        [reports, typeFilter, blogFilter],
    );
    const nSave = reports.filter((r) => (r.report_type ?? 'save') === 'save').length;
    const nPub = reports.filter((r) => (r.report_type ?? 'save') === 'publish').length;

    return (
        <div className="grid gap-3">
            <p className="m-0 text-sm text-[#64748b]">
                기자단이 <b>저장/발행</b>으로 보고한 글 이력입니다. 담당자가 승인하면 계약 1건이 카운트됩니다.
            </p>

            {/* 저장/발행 필터 */}
            <div className="flex gap-1.5">
                {(
                    [
                        ['all', `전체 ${reports.length}`],
                        ['save', `저장 ${nSave}`],
                        ['publish', `발행 ${nPub}`],
                    ] as ['all' | ReportType, string][]
                ).map(([k, label]) => (
                    <button
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                            typeFilter === k
                                ? 'border-[#1e40af] bg-[#1e40af] text-white'
                                : 'border-[#cbd5e1] bg-white text-[#475569]'
                        }`}
                        key={k}
                        onClick={() => setTypeFilter(k)}
                        type="button"
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* 업체(블로그)별 저장/발행 현황 — 블로그 여러 개면 카드로 요약. 클릭하면 그 블로그로 필터. */}
            {accounts.length > 1 ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {[{ id: 'all', name: '전체 블로그' }, ...accounts].map((a) => {
                        const br = a.id === 'all' ? reports : reports.filter((r) => r.blog_account_id === a.id);
                        const s = br.filter((r) => (r.report_type ?? 'save') === 'save').length;
                        const p = br.filter((r) => (r.report_type ?? 'save') === 'publish').length;
                        const on = blogFilter === a.id;
                        return (
                            <button
                                className={`rounded-xl border px-3 py-2 text-left transition ${
                                    on ? 'border-[#1e40af] bg-[#eff6ff]' : 'border-[#e2e8f0] bg-white hover:border-[#93c5fd]'
                                }`}
                                key={a.id}
                                onClick={() => setBlogFilter(a.id)}
                                type="button"
                            >
                                <div className="truncate text-[13px] font-bold text-[#0f172a]">{a.name}</div>
                                <div className="mt-0.5 flex gap-2 text-[11px] font-semibold">
                                    <span className="text-[#4338ca]">저장 {s}</span>
                                    <span className="text-[#047857]">발행 {p}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            ) : null}

            <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">블로그</th>
                            <th className="px-3 py-2 font-semibold">구분</th>
                            <th className="px-3 py-2 font-semibold">상태</th>
                            <th className="px-3 py-2 font-semibold">제목</th>
                            <th className="px-3 py-2 font-semibold">글 주소</th>
                            <th className="whitespace-nowrap px-3 py-2 font-semibold">보고일</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={6}>
                                    불러오는 중…
                                </td>
                            </tr>
                        ) : rows.length ? (
                            rows.map((r) => {
                                const tb = TYPE_BADGE[r.report_type ?? 'save'];
                                const sb = STATUS_BADGE[r.status];
                                return (
                                    <tr className="border-b border-[#f1f5f9] last:border-b-0" key={r.id}>
                                        <td className="whitespace-nowrap px-3 py-2 font-semibold text-[#334155]">
                                            {nameOf(r.blog_account_id)}
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${tb.c}`}>
                                                {tb.t}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${sb.c}`}>
                                                {sb.t}
                                            </span>
                                        </td>
                                        <td className="max-w-[240px] truncate px-3 py-2 text-[#475569]">
                                            {r.title || '제목 없음'}
                                        </td>
                                        <td className="px-3 py-2">
                                            <a
                                                className="block max-w-[220px] truncate text-[13px] text-[#7c3aed] hover:underline"
                                                href={r.post_url}
                                                rel="noopener noreferrer"
                                                target="_blank"
                                                title={r.post_url}
                                            >
                                                {r.post_url}
                                            </a>
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 text-[#64748b]">
                                            {(r.published_at || r.created_at || '').slice(0, 10) || '—'}
                                        </td>
                                    </tr>
                                );
                            })
                        ) : (
                            <tr>
                                <td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={6}>
                                    저장/발행으로 보고된 글이 없습니다.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
