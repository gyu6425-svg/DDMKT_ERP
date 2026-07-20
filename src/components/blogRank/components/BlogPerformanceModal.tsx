import { useEffect, useMemo, useState } from 'react';
import { getReporters, type BlogAccount, type BlogPost } from '../../../api/blogRank';
import {
    getReports,
    settleReports,
    type BlogPostReport,
    type ReportStatus,
    type ReportType,
} from '../../../api/blogPostReports';
import { getReporterRegisteredBlogIds } from '../../../api/blogAccountRequests';
import { fmtRank, lastM } from '../lib/helpers';

// 성과 모달 — 2탭.
//   ① 저장,발행 성과: 이 블로그의 기자단 글 보고 히스토리(저장/발행 · 대기/승인/반려). 회사·고객 ERP 공통.
//   ② 순위 성과: 추적 글의 통합탭/블로그탭 순위. 체크해서 '성과 보고서 열기'(인쇄/PDF·카톡). = 기존 성과 보고서.
export function BlogPerformanceModal({
    account,
    posts,
    internal = false,
    onClose,
    onReport,
}: {
    account: BlogAccount;
    posts: BlogPost[];
    internal?: boolean; // 내부(회사 ERP)면 기자단 이름·입금상태·외주비 정산 노출
    onClose: () => void;
    onReport: (selected: BlogPost[]) => void;
}) {
    // 고객 뷰(비내부)는 '저장,발행 성과'가 별도 탭으로 빠져서, 여기선 순위 성과만. 내부는 두 탭 유지.
    const [tab, setTab] = useState<'reports' | 'rank'>(internal ? 'reports' : 'rank');
    const tabList: ['reports' | 'rank', string][] = internal
        ? [
              ['reports', '저장,발행 성과'],
              ['rank', '순위 성과'],
          ]
        : [['rank', '순위 성과']];

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="flex max-h-[88vh] w-[min(1120px,97vw)] flex-col rounded-2xl bg-white p-6">
                <div className="mb-2 flex items-center justify-between">
                    <h3 className="m-0 text-lg font-bold text-[#0f172a]">{account.name} · 성과</h3>
                    <button
                        className="rounded-md border border-[#cbd5e1] px-3 py-1 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                </div>

                {/* 탭 — 내부: 저장,발행 성과 + 순위 성과 / 고객: 순위 성과만(저장,발행은 별도 탭). */}
                {tabList.length > 1 ? (
                    <div className="mb-3 flex gap-1 border-b border-[#e2e8f0]">
                        {tabList.map(([k, label]) => (
                            <button
                                className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold ${
                                    tab === k ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8]'
                                }`}
                                key={k}
                                onClick={() => setTab(k)}
                                type="button"
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                ) : null}

                {tab === 'reports' ? (
                    <ReportsTab blogAccountId={account.id} internal={internal} />
                ) : (
                    <RankTab posts={posts} onClose={onClose} onReport={onReport} />
                )}
            </div>
        </div>
    );
}

// ── 탭 ① 저장,발행 성과 — 기자단 글 보고 히스토리 ─────────────────────────
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

function ReportsTab({ blogAccountId, internal }: { blogAccountId: string; internal: boolean }) {
    const [reports, setReports] = useState<BlogPostReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | ReportType>('all');
    const [names, setNames] = useState<Record<string, string>>({}); // reporter_id → 이름(내부만)
    const [settling, setSettling] = useState(false);
    // 기자단 '업체 등록'으로 승인된 블로그는 계약 미연동이라 외주비가 계상되지 않는다.
    //   → 0원짜리를 정산한 것처럼 보이지 않도록 '외주비 정산' 버튼을 숨긴다.
    const [noOutsource, setNoOutsource] = useState(false);
    useEffect(() => {
        let alive = true;
        void getReporterRegisteredBlogIds().then((ids) => {
            if (alive) setNoOutsource(ids.has(blogAccountId));
        });
        return () => {
            alive = false;
        };
    }, [blogAccountId]);

    const load = () => {
        setLoading(true);
        void getReports({ blog_account_id: blogAccountId }).then(({ data }) => {
            setReports(data);
            setLoading(false);
        });
    };
    useEffect(() => {
        let alive = true;
        setLoading(true);
        void getReports({ blog_account_id: blogAccountId }).then(({ data }) => {
            if (!alive) return;
            setReports(data);
            setLoading(false);
        });
        return () => {
            alive = false;
        };
    }, [blogAccountId]);
    // 내부(회사 ERP)만 기자단 이름 조회.
    useEffect(() => {
        if (!internal) return;
        let alive = true;
        void getReporters().then(({ data }) => {
            if (!alive) return;
            const m: Record<string, string> = {};
            data.forEach((r) => (m[r.id] = r.name || r.email));
            setNames(m);
        });
        return () => {
            alive = false;
        };
    }, [internal]);

    const rows = useMemo(
        () => reports.filter((r) => filter === 'all' || (r.report_type ?? 'save') === filter),
        [reports, filter],
    );
    const nSave = reports.filter((r) => (r.report_type ?? 'save') === 'save').length;
    const nPub = reports.filter((r) => (r.report_type ?? 'save') === 'publish').length;
    const reporterName = (r: BlogPostReport) => (r.reporter_id ? names[r.reporter_id] : '') || '기자단';
    const isApproved = (r: BlogPostReport) => r.status === 'confirmed' || r.status === 'published';
    // 미입금(승인·미정산) 건 — '외주비 정산' 대상.
    const unpaid = reports.filter((r) => isApproved(r) && !r.paid);
    const cols = internal ? 7 : 5;

    const settle = async () => {
        if (!unpaid.length || settling) return;
        setSettling(true);
        const { error } = await settleReports(unpaid.map((r) => r.id));
        setSettling(false);
        if (error) {
            alert('정산 실패: ' + error.message);
            return;
        }
        load(); // 칩(미입금→입금) 갱신
    };

    return (
        <div className="flex min-h-0 flex-col">
            <p className="mt-0 mb-2 text-sm text-[#64748b]">
                이 블로그에 기자단이 <b>저장/발행</b>으로 보고한 글 이력입니다. 담당자가 승인하면 계약 1건이 카운트됩니다.
            </p>
            <div className="mb-2 flex gap-1.5">
                {(
                    [
                        ['all', `전체 ${reports.length}`],
                        ['save', `저장 ${nSave}`],
                        ['publish', `발행 ${nPub}`],
                    ] as ['all' | ReportType, string][]
                ).map(([k, label]) => (
                    <button
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                            filter === k
                                ? 'border-[#1e40af] bg-[#1e40af] text-white'
                                : 'border-[#cbd5e1] bg-white text-[#475569]'
                        }`}
                        key={k}
                        onClick={() => setFilter(k)}
                        type="button"
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div className="overflow-y-auto rounded-md border border-[#e2e8f0]">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="border-b border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            {internal ? <th className="whitespace-nowrap px-3 py-2 font-semibold">입금</th> : null}
                            {internal ? <th className="whitespace-nowrap px-3 py-2 font-semibold">기자단</th> : null}
                            <th className="whitespace-nowrap px-3 py-2 font-semibold">구분</th>
                            <th className="whitespace-nowrap px-3 py-2 font-semibold">상태</th>
                            <th className="px-3 py-2 font-semibold">제목</th>
                            <th className="px-3 py-2 font-semibold">글 주소</th>
                            <th className="whitespace-nowrap px-3 py-2 font-semibold">보고일</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td className="px-3 py-8 text-center text-sm text-[#94a3b8]" colSpan={cols}>
                                    불러오는 중…
                                </td>
                            </tr>
                        ) : rows.length ? (
                            rows.map((r) => {
                                const tb = TYPE_BADGE[r.report_type ?? 'save'];
                                const sb = STATUS_BADGE[r.status];
                                return (
                                    <tr className="border-b border-[#e2e8f0] hover:bg-[#f8fafc]" key={r.id}>
                                        {internal ? (
                                            <td className="px-3 py-2">
                                                {isApproved(r) ? (
                                                    r.paid ? (
                                                        <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[11px] font-bold text-[#15803d]">
                                                            입금
                                                        </span>
                                                    ) : (
                                                        <span className="rounded-full bg-[#fef3c7] px-2 py-0.5 text-[11px] font-bold text-[#b45309]">
                                                            미입금
                                                        </span>
                                                    )
                                                ) : (
                                                    <span className="text-[11px] text-[#cbd5e1]">—</span>
                                                )}
                                            </td>
                                        ) : null}
                                        {internal ? (
                                            <td className="whitespace-nowrap px-3 py-2 font-semibold text-[#334155]">
                                                {reporterName(r)}
                                            </td>
                                        ) : null}
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
                                        <td className="max-w-[340px] truncate px-3 py-2 text-[#334155]">
                                            {r.title || '제목 없음'}
                                        </td>
                                        <td className="px-3 py-2">
                                            <a
                                                className="block max-w-[300px] truncate text-[13px] text-[#7c3aed] hover:underline"
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
                                <td className="px-3 py-8 text-center text-sm text-[#94a3b8]" colSpan={cols}>
                                    저장/발행으로 보고된 글이 없습니다.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* 외주비 정산 — 내부만. 미입금(승인·미정산) 건을 이 기자단 이름으로 일괄 입금 처리. */}
            {internal && noOutsource ? (
                <p className="mt-3 mb-0 text-xs text-[#94a3b8]">
                    기자단이 등록한 업체라 외주비가 계상되지 않습니다 · 계약 관리 연동 후 별도 등록
                </p>
            ) : null}
            {internal && !noOutsource ? (
                <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-[#94a3b8]">
                        미입금 {unpaid.length}건 — 주 단위로 정산하면 미입금이 입금으로 바뀝니다.
                    </span>
                    <button
                        className="rounded-md bg-[#059669] px-4 py-2 text-sm font-bold text-white hover:bg-[#047857] disabled:opacity-50"
                        disabled={!unpaid.length || settling}
                        onClick={() => void settle()}
                        type="button"
                    >
                        {settling ? '정산 중…' : `외주비 정산 (${unpaid.length}건)`}
                    </button>
                </div>
            ) : null}
        </div>
    );
}

// ── 탭 ② 순위 성과 — 추적 글 순위 + 성과 보고서 선택(기존 ReportSelectModal 내용) ──
function RankTab({
    posts,
    onClose,
    onReport,
}: {
    posts: BlogPost[];
    onClose: () => void;
    onReport: (selected: BlogPost[]) => void;
}) {
    // 통합탭 순위 좋은 순(측정대기/권외는 뒤).
    const rows = useMemo(
        () =>
            [...posts].sort((a, b) => {
                const ma = lastM(a);
                const mb = lastM(b);
                const ka = ma && ma.ti_status === 'ok' ? ma.ti : 9999;
                const kb = mb && mb.ti_status === 'ok' ? mb.ti : 9999;
                return ka - kb;
            }),
        [posts],
    );
    const [checked, setChecked] = useState<Set<string>>(
        () => new Set(rows.filter((p) => lastM(p)).map((p) => p.id)),
    );
    const toggle = (id: string) =>
        setChecked((s) => {
            const n = new Set(s);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
        });
    const allChecked = rows.length > 0 && rows.every((p) => checked.has(p.id));
    const toggleAll = () => setChecked(allChecked ? new Set() : new Set(rows.map((p) => p.id)));
    const selected = rows.filter((p) => checked.has(p.id));

    return (
        <div className="flex min-h-0 flex-col">
            <div className="mb-2 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-sm font-semibold text-[#475569]">
                    <input checked={allChecked} onChange={toggleAll} type="checkbox" /> 전체 선택
                </label>
                <span className="text-xs text-[#94a3b8]">
                    {selected.length}/{rows.length}개 선택 · 체크한 글만 보고서에 들어갑니다
                </span>
            </div>
            <div className="overflow-y-auto rounded-md border border-[#e2e8f0]">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="border-b border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="w-8 px-2 py-2"></th>
                            <th className="px-2 py-2">키워드</th>
                            <th className="px-2 py-2">발행일</th>
                            <th className="px-2 py-2 text-center">통합탭</th>
                            <th className="px-2 py-2 text-center">블로그탭</th>
                            <th className="px-2 py-2">제목</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length ? (
                            rows.map((p) => {
                                const m = lastM(p);
                                return (
                                    <tr
                                        className="cursor-pointer border-b border-[#e2e8f0] hover:bg-[#f8fafc]"
                                        key={p.id}
                                        onClick={() => toggle(p.id)}
                                    >
                                        <td className="px-2 py-2 text-center">
                                            <input
                                                checked={checked.has(p.id)}
                                                onChange={() => toggle(p.id)}
                                                onClick={(e) => e.stopPropagation()}
                                                type="checkbox"
                                            />
                                        </td>
                                        <td className="px-2 py-2 font-semibold text-[#7c3aed]">
                                            {p.keyword_manual || p.keyword || '—'}
                                        </td>
                                        <td className="whitespace-nowrap px-2 py-2 text-[#64748b]">
                                            {p.published_date || '—'}
                                        </td>
                                        <td className="px-2 py-2 text-center font-semibold text-[#059669]">
                                            {m ? fmtRank(m.ti, m.ti_status ?? 'ok') : '측정대기'}
                                        </td>
                                        <td className="px-2 py-2 text-center font-semibold text-[#1e40af]">
                                            {m ? fmtRank(m.bl, m.bl_status ?? 'ok') : '측정대기'}
                                        </td>
                                        <td className="max-w-[260px] truncate px-2 py-2 text-[#475569]">
                                            {p.title || '제목 없음'}
                                        </td>
                                    </tr>
                                );
                            })
                        ) : (
                            <tr>
                                <td className="px-2 py-8 text-center text-sm text-[#94a3b8]" colSpan={6}>
                                    추적 중인 글이 없습니다.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
            <div className="mt-4 flex justify-end gap-2">
                <button
                    className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                    onClick={onClose}
                    type="button"
                >
                    닫기
                </button>
                <button
                    className="rounded-md bg-[#1e40af] px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
                    disabled={!selected.length}
                    onClick={() => onReport(selected)}
                    type="button"
                >
                    성과 보고서 열기 ({selected.length})
                </button>
            </div>
        </div>
    );
}
