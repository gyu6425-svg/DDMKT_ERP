import { useEffect, useState } from 'react';
import { listTokens, balanceOf, type TokenLedger } from '../../api/cafeTokens';

// 고객 '충전내역' — 발행 토큰 잔액 + 충전/사용 히스토리(본인, RLS 스코프).
export function CafeTokenHistory({ clientId }: { clientId: string | null }) {
    const [rows, setRows] = useState<TokenLedger[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        void listTokens(clientId ?? undefined).then(({ data }) => {
            if (!alive) return;
            setRows(data);
            setLoading(false);
        });
        return () => { alive = false; };
    }, [clientId]);

    const balance = balanceOf(rows);
    const charged = rows.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0);
    const used = rows.filter((r) => r.delta < 0).reduce((s, r) => s - r.delta, 0);

    return (
        <div className="grid gap-4">
            <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="text-[12px] text-[#64748b]">잔여 발행</div>
                    <div className="text-2xl font-bold text-[#1e40af]">{balance}건</div>
                </div>
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="text-[12px] text-[#64748b]">총 충전</div>
                    <div className="text-2xl font-bold text-[#059669]">{charged}건</div>
                </div>
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="text-[12px] text-[#64748b]">총 사용(발행)</div>
                    <div className="text-2xl font-bold text-[#475569]">{used}건</div>
                </div>
            </div>

            <div className="rounded-xl border border-[#e2e8f0] bg-white p-5">
                <div className="mb-3 text-[15px] font-bold text-[#0f172a]">충전·사용 내역</div>
                {loading ? (
                    <div className="py-8 text-center text-sm text-[#94a3b8]">불러오는 중…</div>
                ) : rows.length === 0 ? (
                    <div className="py-8 text-center text-sm text-[#94a3b8]">아직 충전 내역이 없습니다. 입금 후 담당자가 충전해 드립니다.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[420px] border-collapse text-[13px]">
                            <thead>
                                <tr className="border-b border-[#e2e8f0] text-left text-[#64748b]">
                                    {['일시', '구분', '건수', '메모'].map((h) => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.id} className="border-b border-[#f1f5f9] text-[#334155]">
                                        <td className="whitespace-nowrap px-2 py-2">{new Date(r.created_at).toLocaleString('ko-KR')}</td>
                                        <td className="whitespace-nowrap px-2 py-2">
                                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.kind === '충전' ? 'bg-[#dcfce7] text-[#166534]' : r.kind === '발행' ? 'bg-[#e0e7ff] text-[#4338ca]' : 'bg-[#f1f5f9] text-[#64748b]'}`}>{r.kind}</span>
                                        </td>
                                        <td className={`px-2 py-2 font-bold ${r.delta >= 0 ? 'text-[#059669]' : 'text-[#dc2626]'}`}>{r.delta > 0 ? `+${r.delta}` : r.delta}</td>
                                        <td className="px-2 py-2 text-[#64748b]">{r.note ?? '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
