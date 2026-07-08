import { useState } from 'react';
import { deleteReporter, type BlogAccount, type ReporterProfile } from '../../../api/blogRank';

// 기자단 계정 관리(내부/관리자) — 발급된 기자단 목록 + 삭제.
//   삭제 시 Edge Function이 auth 유저+profiles 삭제 → 로그인 불가 + 담당 블로그 자동 미지정.
export function ReporterManageModal({
    reporters,
    accounts,
    onChanged,
    onToast,
    onClose,
}: {
    reporters: ReporterProfile[];
    accounts: BlogAccount[];
    onChanged?: () => void;
    onToast?: (m: string) => void;
    onClose: () => void;
}) {
    const [list, setList] = useState<ReporterProfile[]>(reporters);
    const [busy, setBusy] = useState<string | null>(null);
    const blogCount = (id: string) => accounts.filter((a) => a.reporter_id === id).length;

    const del = async (r: ReporterProfile) => {
        const n = blogCount(r.id);
        if (
            !window.confirm(
                `'${r.name || r.email}' 기자단 계정을 삭제할까요?\n` +
                    `· 이 계정으로 더는 로그인할 수 없습니다.\n` +
                    `· 담당 블로그 ${n}개는 '미지정'으로 바뀝니다.\n되돌릴 수 없습니다.`,
            )
        )
            return;
        setBusy(r.id);
        const { error } = await deleteReporter(r.id);
        setBusy(null);
        if (error) {
            onToast?.('삭제 실패: ' + error.message);
            return;
        }
        setList((prev) => prev.filter((x) => x.id !== r.id));
        onChanged?.();
        onToast?.('기자단 계정 삭제됨 · 접속 차단');
    };

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
                                <th className="px-3 py-2 text-center font-semibold">삭제</th>
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
                                            className="rounded border border-[#dc2626] px-2.5 py-1 text-[12px] font-bold text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-50"
                                            disabled={busy === r.id}
                                            onClick={() => void del(r)}
                                            type="button"
                                        >
                                            {busy === r.id ? '삭제 중…' : '삭제'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                <p className="mt-3 mb-0 text-[11px] text-[#94a3b8]">
                    삭제하면 그 계정은 즉시 로그인·데이터 열람이 차단됩니다(관리자만 삭제 가능).
                </p>
            </div>
        </div>
    );
}
