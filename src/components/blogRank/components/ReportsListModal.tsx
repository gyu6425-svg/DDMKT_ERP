import { useEffect, useState } from 'react';
import { getReports, resubmitReport, type BlogPostReport } from '../../../api/blogPostReports';

// 기자단 보고 목록 모달(기자단 뷰) — status 없으면 전체(보고한 글), 'rejected'면 반려만.
//   반려 건은 '재보고' 버튼으로 블로그/주소/키워드 수정 후 다시 검토중으로 전송.
export function ReportsListModal({
    title,
    status,
    blogNameOf,
    accounts,
    onChanged,
    onToast,
    onClose,
}: {
    title: string;
    status?: 'pending' | 'confirmed' | 'rejected';
    blogNameOf: (id: string) => string;
    accounts: { id: string; name: string }[];
    onChanged?: () => void;
    onToast?: (m: string) => void;
    onClose: () => void;
}) {
    const [reports, setReports] = useState<BlogPostReport[]>([]);
    const [loading, setLoading] = useState(true);
    // 재보고
    const [reId, setReId] = useState<string | null>(null);
    const [reBlogId, setReBlogId] = useState('');
    const [reUrl, setReUrl] = useState('');
    const [reKeyword, setReKeyword] = useState('');
    const [reSaving, setReSaving] = useState(false);

    const load = () => {
        setLoading(true);
        void getReports(status).then(({ data }) => {
            setReports(data);
            setLoading(false);
        });
    };
    useEffect(load, [status]);

    const startRe = (r: BlogPostReport) => {
        setReId(r.id);
        setReBlogId(r.blog_account_id);
        setReUrl(r.post_url);
        setReKeyword(r.keyword || '');
    };
    const doRe = async (r: BlogPostReport) => {
        if (!reBlogId) return onToast?.('블로그를 선택하세요');
        if (!reUrl.trim()) return onToast?.('글 주소(URL)를 입력하세요');
        setReSaving(true);
        const { error } = await resubmitReport(r.id, {
            blog_account_id: reBlogId,
            post_url: reUrl.trim(),
            keyword: reKeyword.trim() || null,
            title: r.title,
        });
        setReSaving(false);
        if (error) return onToast?.('재보고 실패: ' + error.message);
        setReId(null);
        onToast?.('재보고 완료 · 다시 검토중으로 전환됩니다');
        load();
        onChanged?.();
    };

    const chip = (s: BlogPostReport['status']) =>
        s === 'published'
            ? { t: '발행완료', c: 'bg-[#dbeafe] text-[#1e40af]' }
            : s === 'confirmed'
              ? { t: '승인됨', c: 'bg-[#dcfce7] text-[#16a34a]' }
              : s === 'rejected'
                ? { t: '반려', c: 'bg-[#fee2e2] text-[#dc2626]' }
                : { t: '검토중', c: 'bg-[#fef3c7] text-[#b45309]' };

    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="max-h-[88vh] w-[min(640px,96vw)] overflow-y-auto rounded-2xl bg-white p-6">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="m-0 text-lg font-bold text-[#0f172a]">{title}</h3>
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
                    <div className="py-12 text-center text-sm text-[#94a3b8]">해당하는 글이 없습니다.</div>
                ) : (
                    <div className="grid gap-2">
                        {reports.map((r) => {
                            const c = chip(r.status);
                            const editing = reId === r.id;
                            return (
                                <div className="rounded-md border border-[#e2e8f0] p-3" key={r.id}>
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
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
                                            {r.status === 'rejected' && r.note ? (
                                                <div className="mt-0.5 text-[12px] font-semibold text-[#dc2626]">
                                                    반려 사유: {r.note}
                                                </div>
                                            ) : null}
                                        </div>
                                        <div className="flex shrink-0 items-center gap-1">
                                            <span
                                                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c.c}`}
                                            >
                                                {c.t}
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
