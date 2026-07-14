import { useState } from 'react';
import { type BlogAccount, type ReporterProfile } from '../../../api/blogRank';
import { ReporterInfoModal } from './ReporterInfoModal';

// 기자단 계정 관리(내부/관리자) — 발급된 기자단 목록 + 계정 정보(정산 정보) 열람.
export function ReporterManageModal({
    reporters,
    accounts,
    onClose,
}: {
    reporters: ReporterProfile[];
    accounts: BlogAccount[];
    onChanged?: () => void;
    onToast?: (m: string) => void;
    onClose: () => void;
}) {
    const [list] = useState<ReporterProfile[]>(reporters);
    const [infoFor, setInfoFor] = useState<ReporterProfile | null>(null); // 계정 정보 모달 대상
    const blogCount = (id: string) => accounts.filter((a) => a.reporter_id === id).length;

    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="max-h-[88vh] w-[min(560px,96vw)] overflow-y-auto rounded-2xl bg-white p-6">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="m-0 text-lg font-bold text-[#0f172a]">기자단 계정 관리</h3>
                    <button
                        className="rounded-md border border-[#cbd5e1] px-3 py-1 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                </div>
                {list.length === 0 ? (
                    <div className="py-12 text-center text-sm text-[#94a3b8]">발급된 기자단 계정이 없습니다.</div>
                ) : (
                    <table className="w-full border-collapse text-left text-sm">
                        <thead>
                            <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                                <th className="px-3 py-2 font-semibold">기자단 (아이디)</th>
                                <th className="px-3 py-2 text-center font-semibold">담당 블로그</th>
                                <th className="px-3 py-2 text-center font-semibold">계정 정보</th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.map((r) => (
                                <tr className="border-b border-[#e2e8f0]" key={r.id}>
                                    <td className="px-3 py-2">
                                        <div className="font-semibold text-[#334155]">{r.name || '이름없음'}</div>
                                        <div className="text-[11px] text-[#94a3b8]">{r.email}</div>
                                    </td>
                                    <td className="px-3 py-2 text-center font-bold text-[#475569]">
                                        {blogCount(r.id)}개
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <button
                                            className="rounded border border-[#1e40af] px-2.5 py-1 text-[12px] font-bold text-[#1e40af] hover:bg-[#eef2ff]"
                                            onClick={() => setInfoFor(r)}
                                            type="button"
                                        >
                                            계정 정보
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                <p className="mt-3 mb-0 text-[11px] text-[#94a3b8]">
                    계정 정보(은행·계좌번호·주민번호)는 내부 전용으로만 조회되며, 마스킹 상태로 표시됩니다.
                </p>
            </div>
            {infoFor ? (
                <ReporterInfoModal
                    onClose={() => setInfoFor(null)}
                    reporterEmail={infoFor.email}
                    reporterId={infoFor.id}
                    reporterName={infoFor.name || ''}
                />
            ) : null}
        </div>
    );
}
