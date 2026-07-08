import { useEffect, useState } from 'react';
import {
    confirmReport,
    getReports,
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
    const [reports, setReports] = useState<BlogPostReport[]>([]);
    const [names, setNames] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const load = () => {
        setLoading(true);
        void Promise.all([getReports('pending'), getReporters()]).then(([rep, reps]) => {
            setReports(rep.data);
            const m: Record<string, string> = {};
            reps.data.forEach((r) => (m[r.id] = r.name || r.email));
            setNames(m);
            setLoading(false);
        });
    };
    useEffect(load, []);

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
    const reject = async (r: BlogPostReport) => {
        if (!window.confirm('이 보고를 반려할까요?')) return;
        setBusy(r.id);
        const { error } = await rejectReport(r.id, reviewerProfileId);
        setBusy(null);
        if (error) {
            alert('반려 실패: ' + error.message);
            return;
        }
        setReports((prev) => prev.filter((x) => x.id !== r.id));
        onChanged?.();
    };

    const reporterName = (r: BlogPostReport) => (r.reporter_id ? names[r.reporter_id] || '기자단' : '기자단');

    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="max-h-[88vh] w-[min(680px,96vw)] overflow-y-auto rounded-2xl bg-white p-6">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="m-0 text-lg font-bold text-[#0f172a]">기자단 발행 보고 · 승인 대기</h3>
                    <button
                        className="rounded-md border border-[#cbd5e1] px-3 py-1 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                </div>

                {loading ? (
                    <div className="py-12 text-center text-sm text-[#94a3b8]">불러오는 중...</div>
                ) : reports.length === 0 ? (
                    <div className="py-12 text-center text-sm text-[#94a3b8]">승인 대기 중인 보고가 없습니다.</div>
                ) : (
                    <table className="w-full border-collapse text-left text-sm">
                        <thead>
                            <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                                <th className="px-3 py-2 font-semibold">기자단 이름</th>
                                <th className="px-3 py-2 font-semibold">발행 주소</th>
                                <th className="px-3 py-2 text-center font-semibold">승인</th>
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
                                                onClick={() => void reject(r)}
                                                type="button"
                                            >
                                                반려
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                <p className="mt-3 mb-0 text-[11px] text-[#94a3b8]">
                    승인하면 추적 글로 등록되어 다음 크롤에서 순위가 측정됩니다.
                </p>
            </div>
        </div>
    );
}
