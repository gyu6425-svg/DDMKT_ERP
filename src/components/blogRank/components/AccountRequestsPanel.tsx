import { Fragment, useEffect, useState } from 'react';
import {
    approveAccountRequest,
    getAccountRequests,
    rejectAccountRequest,
    type BlogAccountRequest,
} from '../../../api/blogAccountRequests';
import { getReporters, type ReporterProfile } from '../../../api/blogRank';
import { useAuth } from '../../../hooks/useAuth';

// 기자단 업체 등록 신청 — 승인 대기 목록(내부 전용).
//   승인하면 브랜드 블로그(blog_accounts)가 생성되고 담당 기자단으로 신청자가 붙는다.
//   계약 관리(client_id)에는 연결하지 않는다 — 블로그 대시보드에서만 관리.
export function AccountRequestsPanel({
    onDone,
    onToast,
}: {
    onDone: () => void; // 처리 후 시트/카운트 갱신
    onToast: (msg: string) => void;
}) {
    const { profile } = useAuth();
    const [rows, setRows] = useState<BlogAccountRequest[]>([]);
    const [reporters, setReporters] = useState<ReporterProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    // 반려 사유 입력 중인 신청 id
    const [rejectId, setRejectId] = useState<string | null>(null);
    const [rejectNote, setRejectNote] = useState('');

    const load = () => {
        setLoading(true);
        void getAccountRequests('pending').then(({ data }) => {
            setRows(data);
            setLoading(false);
        });
    };
    useEffect(load, []);
    useEffect(() => {
        void getReporters().then(({ data }) => setReporters(data));
    }, []);

    const reporterName = (id: string | null) => {
        if (!id) return '—';
        const r = reporters.find((x) => x.id === id);
        return r ? `${r.name || '이름없음'} (${(r.email || '').split('@')[0]})` : '기자단';
    };

    const doApprove = async (r: BlogAccountRequest) => {
        if (!profile?.id) return onToast('계정 정보를 확인할 수 없습니다');
        setBusy(r.id);
        const { error, linked, note } = await approveAccountRequest(r, profile.id);
        setBusy(null);
        if (error) return onToast('승인 실패: ' + error.message);
        // 같은 블로그 주소가 이미 있으면 새로 만들지 않고 그 블로그에 연결한다(무엇이 유지됐는지 함께 안내).
        onToast(
            linked
                ? `${r.name} 승인 완료 · 이미 등록된 블로그에 연결했습니다${note ? ` (${note})` : ''}`
                : `${r.name} 승인 완료 · 브랜드 블로그에 등록되었습니다`,
        );
        load();
        onDone();
    };

    const doReject = async (r: BlogAccountRequest) => {
        if (!profile?.id) return onToast('계정 정보를 확인할 수 없습니다');
        setBusy(r.id);
        const { error } = await rejectAccountRequest(r.id, profile.id, rejectNote);
        setBusy(null);
        if (error) return onToast('반려 실패: ' + error.message);
        setRejectId(null);
        setRejectNote('');
        onToast(`${r.name} 반려됨 · 기자단이 수정 후 재신청할 수 있습니다`);
        load();
        onDone();
    };

    return (
        <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
            <table className="w-full border-collapse text-left text-sm">
                <thead>
                    <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                        <th className="px-3 py-2 font-semibold">업체</th>
                        <th className="px-3 py-2 font-semibold">블로그 주소</th>
                        <th className="px-3 py-2 font-semibold">신청 기자단</th>
                        <th className="px-3 py-2 text-right font-semibold">계약 건</th>
                        <th className="px-3 py-2 text-right font-semibold">진행 건</th>
                        <th className="px-3 py-2 text-right font-semibold">잔여</th>
                        <th className="px-3 py-2 font-semibold">신청일</th>
                        <th className="px-3 py-2 text-center font-semibold">처리</th>
                    </tr>
                </thead>
                <tbody>
                    {loading ? (
                        <tr>
                            <td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={8}>
                                불러오는 중…
                            </td>
                        </tr>
                    ) : rows.length ? (
                        rows.map((r) => {
                            const remain =
                                r.contract_count == null
                                    ? null
                                    : Math.max(0, r.contract_count - (r.progress_count ?? 0));
                            return (
                                <Fragment key={r.id}>
                                    <tr className="border-b border-[#e2e8f0] hover:bg-[#f8fafc]">
                                        <td className="px-3 py-2 text-[13px] font-semibold text-[#0f172a]">{r.name}</td>
                                        <td className="px-3 py-2">
                                            <a
                                                className="block max-w-[280px] truncate text-[13px] text-[#1d4ed8] hover:underline"
                                                href={r.blog_url}
                                                rel="noopener noreferrer"
                                                target="_blank"
                                            >
                                                {r.blog_url}
                                            </a>
                                        </td>
                                        <td className="px-3 py-2 text-[13px] text-[#475569]">
                                            {reporterName(r.reporter_id)}
                                        </td>
                                        <td className="px-3 py-2 text-right text-[13px]">{r.contract_count ?? '—'}</td>
                                        <td className="px-3 py-2 text-right text-[13px]">{r.progress_count ?? '—'}</td>
                                        <td className="px-3 py-2 text-right text-[13px] font-semibold text-[#0f172a]">
                                            {remain ?? '—'}
                                        </td>
                                        <td className="px-3 py-2 text-[12px] text-[#94a3b8]">
                                            {r.created_at.slice(0, 10)}
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex justify-center gap-1.5">
                                                <button
                                                    className="rounded-md bg-[#1e40af] px-3 py-1 text-[12px] font-bold text-white hover:bg-[#1e3a8a] disabled:opacity-60"
                                                    disabled={busy === r.id}
                                                    onClick={() => void doApprove(r)}
                                                    type="button"
                                                >
                                                    {busy === r.id ? '처리 중…' : '승인'}
                                                </button>
                                                <button
                                                    className="rounded-md border border-[#e2e8f0] bg-white px-3 py-1 text-[12px] font-bold text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-60"
                                                    disabled={busy === r.id}
                                                    onClick={() => {
                                                        setRejectId(rejectId === r.id ? null : r.id);
                                                        setRejectNote('');
                                                    }}
                                                    type="button"
                                                >
                                                    반려
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                    {rejectId === r.id ? (
                                        <tr className="border-b border-[#e2e8f0] bg-[#fef2f2]">
                                            <td className="px-3 py-2.5" colSpan={8}>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        autoFocus
                                                        className="h-9 flex-1 rounded-md border border-[#cbd5e1] px-3 text-sm"
                                                        onChange={(e) => setRejectNote(e.target.value)}
                                                        placeholder="반려 사유 (기자단에게 보입니다)"
                                                        value={rejectNote}
                                                    />
                                                    <button
                                                        className="rounded-md bg-[#dc2626] px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-60"
                                                        disabled={busy === r.id}
                                                        onClick={() => void doReject(r)}
                                                        type="button"
                                                    >
                                                        반려 확정
                                                    </button>
                                                    <button
                                                        className="rounded-md border border-[#cbd5e1] bg-white px-3 py-1.5 text-[12px] font-bold text-[#475569]"
                                                        onClick={() => setRejectId(null)}
                                                        type="button"
                                                    >
                                                        취소
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : null}
                                </Fragment>
                            );
                        })
                    ) : (
                        <tr>
                            <td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={8}>
                                승인 대기 중인 업체 등록 신청이 없습니다.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}
