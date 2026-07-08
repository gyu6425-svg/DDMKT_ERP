import { useEffect, useState } from 'react';
import { getReports, type BlogPostReport } from '../../../api/blogPostReports';

// 반려 처리된 글 목록(기자단 뷰) — 블로그·제목 · 발행 주소 · 반려 사유. 읽기 전용.
export function RejectedReportsModal({
    blogNameOf,
    onClose,
}: {
    blogNameOf: (id: string) => string;
    onClose: () => void;
}) {
    const [reports, setReports] = useState<BlogPostReport[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        void getReports('rejected').then(({ data }) => {
            setReports(data);
            setLoading(false);
        });
    }, []);

    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="max-h-[88vh] w-[min(640px,96vw)] overflow-y-auto rounded-2xl bg-white p-6">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="m-0 text-lg font-bold text-[#0f172a]">반려 처리된 글</h3>
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
                    <div className="py-12 text-center text-sm text-[#94a3b8]">반려 처리된 글이 없습니다.</div>
                ) : (
                    <div className="grid gap-2">
                        {reports.map((r) => (
                            <div className="rounded-md border border-[#fecaca] bg-[#fef2f2] p-3" key={r.id}>
                                <div className="text-sm font-semibold text-[#334155]">
                                    {blogNameOf(r.blog_account_id)}
                                    {r.title ? ` · ${r.title}` : ''}
                                </div>
                                <a
                                    className="block truncate text-xs text-[#7c3aed] hover:underline"
                                    href={r.post_url}
                                    rel="noopener noreferrer"
                                    target="_blank"
                                >
                                    {r.post_url}
                                </a>
                                <div className="mt-1 text-[13px] text-[#dc2626]">
                                    <b>반려 사유:</b> {r.note || '(사유 없음)'}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
