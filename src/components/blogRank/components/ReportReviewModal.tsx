import { useEffect, useState } from 'react';
import {
    confirmReport,
    getReports,
    publishReport,
    rejectReport,
    type BlogPostReport,
} from '../../../api/blogPostReports';
import { getReporters } from '../../../api/blogRank';

// 기자단 발행 보고 승인 모달 — 기자단 이름 · 발행 주소 컬럼 + 우측 승인 버튼.
//   승인 시 추적글(blog_posts) 생성 → 크롤러가 순위 측정. 반려도 가능.
export function ReportReviewModal({
    reviewerProfileId,
    blogNameOf,
    onClose,
    onChanged,
}: {
    reviewerProfileId: string | null;
    blogNameOf: (id: string) => string;
    onClose: () => void;
    onChanged?: () => void;
}) {
    const [tab, setTab] = useState<'pending' | 'confirmed'>('pending'); // 승인 대기 / 발행 대기
    const [reports, setReports] = useState<BlogPostReport[]>([]);
    const [names, setNames] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [rejectId, setRejectId] = useState<string | null>(null); // 반려 사유 입력 중인 보고
    const [rejectReason, setRejectReason] = useState('');

    const load = () => {
        setLoading(true);
        void Promise.all([getReports(tab), getReporters()]).then(([rep, reps]) => {
            setReports(rep.data);
            const m: Record<string, string> = {};
            reps.data.forEach((r) => (m[r.id] = r.name || r.email));
            setNames(m);
            setLoading(false);
        });
    };
    useEffect(load, [tab]);

    const approve = async (r: BlogPostReport) => {
        setBusy(r.id);
        const { error } = await confirmReport(r, reviewerProfileId);
        setBusy(null);
        if (error) {
            alert('승인 실패: ' + error.message);
            return;
        }
        setReports((prev) => prev.filter((x) => x.id !== r.id));
        onChanged?.();
    };
    const doReject = async (r: BlogPostReport) => {
        setBusy(r.id);
        const { error } = await rejectReport(r.id, reviewerProfileId, rejectReason.trim() || undefined);
        setBusy(null);
        if (error) {
            alert('반려 실패: ' + error.message);
            return;
        }
        setRejectId(null);
        setRejectReason('');
        setReports((prev) => prev.filter((x) => x.id !== r.id));
        onChanged?.();
    };
    // 발행 완료 — 그 블로그의 브랜드 블로그 계약에 잔여 -1 + 진행처리 1건(외주비 8,000/대박종합주방 10,000).
    const publish = async (r: BlogPostReport) => {
        setBusy(r.id);
        const { error, processed, outUnit } = await publishReport(r, reviewerProfileId);
        setBusy(null);
        if (error) {
            alert('발행 완료 실패: ' + error.message);
            return;
        }
        setReports((prev) => prev.filter((x) => x.id !== r.id));
        onChanged?.();
        alert(processed ? `발행 완료 · 진행처리 1건(외주비 ${outUnit.toLocaleString('ko-KR')}원) 반영됨` : '발행 완료(연결된 브랜드 블로그 계약이 없어 진행처리는 미반영)');
    };

    const reporterName = (r: BlogPostReport) => (r.reporter_id ? names[r.reporter_id] || '기자단' : '기자단');

    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="max-h-[88vh] w-[min(680px,96vw)] overflow-y-auto rounded-2xl bg-white p-6">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="m-0 text-lg font-bold text-[#0f172a]">기자단 발행 보고</h3>
                    <button
                        className="rounded-md border border-[#cbd5e1] px-3 py-1 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                </div>

                {/* 탭: 승인 대기(pending) / 발행 대기(confirmed) */}
                <div className="mb-3 flex gap-1 border-b border-[#e2e8f0]">
                    {(
                        [
                            ['pending', '승인 대기'],
                            ['confirmed', '발행 대기'],
                        ] as ['pending' | 'confirmed', string][]
                    ).map(([k, label]) => (
                        <button
                            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
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

                {loading ? (
                    <div className="py-12 text-center text-sm text-[#94a3b8]">불러오는 중...</div>
                ) : reports.length === 0 ? (
                    <div className="py-12 text-center text-sm text-[#94a3b8]">
                        {tab === 'pending' ? '승인 대기 중인 보고가 없습니다.' : '발행 대기(승인됨) 보고가 없습니다.'}
                    </div>
                ) : (
                    <table className="w-full border-collapse text-left text-sm">
                        <thead>
                            <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                                <th className="px-3 py-2 font-semibold">기자단 이름</th>
                                <th className="px-3 py-2 font-semibold">발행 주소</th>
                                <th className="px-3 py-2 text-center font-semibold">
                                    {tab === 'pending' ? '승인' : '발행 완료'}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {reports.map((r) => (
                                <tr className="border-b border-[#e2e8f0]" key={r.id}>
                                    <td className="px-3 py-2">
                                        <div className="font-semibold text-[#334155]">{reporterName(r)}</div>
                                        <div className="text-[11px] text-[#94a3b8]">
                                            {blogNameOf(r.blog_account_id)}
                                            {r.title ? ` · ${r.title}` : ''}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2">
                                        <a
                                            className="block max-w-[280px] truncate text-[13px] text-[#7c3aed] hover:underline"
                                            href={r.post_url}
                                            rel="noopener noreferrer"
                                            target="_blank"
                                            title={r.post_url}
                                        >
                                            {r.post_url}
                                        </a>
                                    </td>
                                    <td className="px-3 py-2">
                                        {tab === 'confirmed' ? (
                                            <div className="flex items-center justify-center">
                                                <button
                                                    className="rounded bg-[#059669] px-3 py-1 text-[12px] font-bold text-white hover:bg-[#047857] disabled:opacity-50"
                                                    disabled={busy === r.id}
                                                    onClick={() => void publish(r)}
                                                    type="button"
                                                >
                                                    {busy === r.id ? '처리 중…' : '발행 완료'}
                                                </button>
                                            </div>
                                        ) : rejectId === r.id ? (
                                            <div className="flex items-center justify-end gap-1">
                                                <input
                                                    autoFocus
                                                    className="h-8 w-36 rounded border border-[#fca5a5] px-2 text-[12px]"
                                                    onChange={(e) => setRejectReason(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && void doReject(r)}
                                                    placeholder="반려 사유"
                                                    value={rejectReason}
                                                />
                                                <button
                                                    className="rounded bg-[#dc2626] px-2 py-1 text-[12px] font-bold text-white disabled:opacity-50"
                                                    disabled={busy === r.id}
                                                    onClick={() => void doReject(r)}
                                                    type="button"
                                                >
                                                    확정
                                                </button>
                                                <button
                                                    className="rounded border border-[#cbd5e1] px-2 py-1 text-[12px] font-semibold text-[#64748b]"
                                                    onClick={() => {
                                                        setRejectId(null);
                                                        setRejectReason('');
                                                    }}
                                                    type="button"
                                                >
                                                    취소
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    className="rounded bg-[#1e40af] px-3 py-1 text-[12px] font-bold text-white hover:bg-[#1e3a8a] disabled:opacity-50"
                                                    disabled={busy === r.id}
                                                    onClick={() => void approve(r)}
                                                    type="button"
                                                >
                                                    {busy === r.id ? '처리 중…' : '승인'}
                                                </button>
                                                <button
                                                    className="rounded border border-[#fca5a5] px-2 py-1 text-[12px] font-semibold text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-50"
                                                    disabled={busy === r.id}
                                                    onClick={() => {
                                                        setRejectId(r.id);
                                                        setRejectReason('');
                                                    }}
                                                    type="button"
                                                >
                                                    반려
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                <p className="mt-3 mb-0 text-[11px] text-[#94a3b8]">
                    {tab === 'pending'
                        ? '승인하면 추적 글로 등록되어 다음 크롤에서 순위가 측정됩니다.'
                        : '발행 완료하면 그 블로그의 브랜드 블로그 계약에 1건 카운트(잔여 -1) + 진행처리에 외주비 8,000원(대박종합주방 10,000원)이 기록됩니다.'}
                </p>
            </div>
        </div>
    );
}
