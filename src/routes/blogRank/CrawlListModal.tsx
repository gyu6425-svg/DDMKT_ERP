import type { BlogAccount, BlogMeasurement, BlogPost } from '../../api/blogRank';

// 크롤링 현황 KPI(지금 측정한 글 / 누락 건 / 실패 글) 클릭 시 그 글 목록을 보여주는 모달.
export type CrawlRow = { post: BlogPost; account: BlogAccount | null; m: BlogMeasurement | null };

function Rank({ v, status, tab }: { v: number | undefined; status: string | undefined; tab: 'ti' | 'bl' }) {
    if (v == null && status == null) return <span className="text-[12px] font-semibold text-[#d97706]">측정 대기</span>;
    const st = status ?? 'ok';
    if (st === 'fail') return <span className="text-[13px] font-bold text-[#dc2626]">실패</span>;
    if (st === 'out' || v == null || v > 30) return <span className="text-[13px] font-semibold text-[#94a3b8]">권외</span>;
    const color = v <= 10 ? (tab === 'ti' ? '#059669' : '#1e40af') : '#475569';
    return (
        <span className="text-[14px] font-bold" style={{ color }}>
            {v}위
        </span>
    );
}

// published_at(KST ISO) → '6/26 19:30' 표시.
function fmtAt(iso: string | null): string {
    if (!iso) return '—';
    const d = iso.slice(5, 10).replace('-', '/');
    const t = iso.slice(11, 16);
    return t ? `${d} ${t}` : d;
}

export function CrawlListModal({
    title,
    accent,
    rows,
    dateMode = false,
    onClose,
}: {
    title: string;
    accent: string;
    rows: CrawlRow[];
    dateMode?: boolean; // true 면 통합/블로그탭 대신 '발행일·게시시각' 컬럼(누락 건 나중확인용)
    onClose: () => void;
}) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="flex max-h-[88vh] w-[min(720px,96vw)] flex-col rounded-2xl border-2 bg-white p-6 shadow-xl" style={{ borderColor: accent }}>
                <div className="flex items-center justify-between">
                    <h3 className="m-0 text-lg font-bold" style={{ color: accent }}>
                        {title}
                    </h3>
                    <span className="rounded-full px-3 py-1 text-xs font-bold text-white" style={{ background: accent }}>
                        총 {rows.length}건
                    </span>
                </div>

                <div className="mt-3 overflow-y-auto rounded-md border border-[#e2e8f0]">
                    <table className="w-full border-collapse text-left text-sm">
                        <thead className="sticky top-0">
                            <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                                <th className="px-3 py-2 font-semibold">업체명</th>
                                <th className="px-3 py-2 font-semibold">블로그(글 링크)</th>
                                {dateMode ? (
                                    <>
                                        <th className="px-3 py-2 text-center font-semibold">발행일</th>
                                        <th className="px-3 py-2 text-center font-semibold">게시 시각</th>
                                    </>
                                ) : (
                                    <>
                                        <th className="px-3 py-2 text-center font-bold text-[#059669]">통합탭</th>
                                        <th className="px-3 py-2 text-center font-bold text-[#1e40af]">블로그탭</th>
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length ? (
                                rows.map(({ post, account, m }) => {
                                    const link = post.post_url || account?.blog_url || '';
                                    return (
                                        <tr key={post.id} className="border-b border-[#e2e8f0] hover:bg-[#f8fafc]">
                                            <td className="px-3 py-2 text-[13px] font-semibold text-[#0f172a]">
                                                {account?.name || '—'}
                                            </td>
                                            <td className="px-3 py-2">
                                                {link ? (
                                                    <a
                                                        className="block max-w-[360px] truncate text-[13px] font-medium text-[#1d4ed8] hover:underline"
                                                        href={link}
                                                        rel="noopener noreferrer"
                                                        target="_blank"
                                                    >
                                                        {post.title || link}
                                                    </a>
                                                ) : (
                                                    <span className="text-[13px] text-[#94a3b8]">{post.title || '제목 없음'}</span>
                                                )}
                                            </td>
                                            {dateMode ? (
                                                <>
                                                    <td className="px-3 py-2 text-center text-[12px] font-semibold text-[#475569]">
                                                        {post.published_date || '—'}
                                                    </td>
                                                    <td className="px-3 py-2 text-center text-[12px] font-semibold text-[#dc2626]">
                                                        {fmtAt(post.published_at)}
                                                    </td>
                                                </>
                                            ) : (
                                                <>
                                                    <td className="px-3 py-2 text-center">
                                                        <Rank v={m?.ti} status={m?.ti_status} tab="ti" />
                                                    </td>
                                                    <td className="px-3 py-2 text-center">
                                                        <Rank v={m?.bl} status={m?.bl_status} tab="bl" />
                                                    </td>
                                                </>
                                            )}
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={4}>
                                        해당 글이 없습니다.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="mt-4 flex justify-end">
                    <button
                        className="rounded-md bg-[#1e40af] px-5 py-2 text-sm font-bold text-white hover:bg-[#1e3a8a]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
}
