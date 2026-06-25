import { useState } from 'react';
import type { BlogAccount, BlogPost } from '../../api/blogRank';
import { fmtRank, lastM } from './helpers';

// 성과 보고서 만들기 — 보고서 페이지로 가기 전 '글 선택' 모달. 블로그/키워드/순위를 보고 체크해서
//   원하는 글만 보고서에 넣는다. '성과 보고서 열기'를 눌러야 실제 보고서 페이지로 이동.
export function ReportSelectModal({
    account,
    posts,
    onClose,
    onReport,
}: {
    account: BlogAccount;
    posts: BlogPost[];
    onClose: () => void;
    onReport: (selected: BlogPost[]) => void;
}) {
    // 통합탭 순위 좋은 순(측정대기/권외는 뒤). 기본 체크 = 측정된 글만.
    const rows = [...posts].sort((a, b) => {
        const ma = lastM(a);
        const mb = lastM(b);
        const ka = ma && ma.ti_status === 'ok' ? ma.ti : 9999;
        const kb = mb && mb.ti_status === 'ok' ? mb.ti : 9999;
        return ka - kb;
    });
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
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="flex max-h-[88vh] w-[min(760px,96vw)] flex-col rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold text-[#0f172a]">{account.name} · 성과 보고서 만들기</h3>
                <p className="mt-1 mb-3 text-sm text-[#64748b]">
                    보고서에 넣을 글을 선택하세요. 체크한 글만 보고서에 들어갑니다.
                </p>
                <div className="mb-2 flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-sm font-semibold text-[#475569]">
                        <input checked={allChecked} onChange={toggleAll} type="checkbox" /> 전체 선택
                    </label>
                    <span className="text-xs text-[#94a3b8]">
                        {selected.length}/{rows.length}개 선택
                    </span>
                </div>
                <div className="overflow-y-auto rounded-md border border-[#e2e8f0]">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                                <th className="w-8 px-2 py-2"></th>
                                <th className="px-2 py-2">키워드</th>
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
                                            <td className="px-2 py-2 text-center font-semibold text-[#059669]">
                                                {m ? fmtRank(m.ti, m.ti_status ?? 'ok') : '측정대기'}
                                            </td>
                                            <td className="px-2 py-2 text-center font-semibold text-[#1e40af]">
                                                {m ? fmtRank(m.bl, m.bl_status ?? 'ok') : '측정대기'}
                                            </td>
                                            <td className="max-w-[280px] truncate px-2 py-2 text-[#475569]">
                                                {p.title || '제목 없음'}
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td className="px-2 py-8 text-center text-sm text-[#94a3b8]" colSpan={5}>
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
        </div>
    );
}
