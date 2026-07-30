import { useEffect, useState } from 'react';
import { listTokens, balanceOf, requestCharge, listChargeRequests, TOKEN_PRICE_KRW, tokenWon, type TokenLedger, type TokenRequest } from '../../api/cafeTokens';

// 고객 '충전내역' — 발행 토큰 잔액 + 충전/사용 히스토리(본인, RLS 스코프).
export function CafeTokenHistory({ clientId }: { clientId: string | null }) {
    const [rows, setRows] = useState<TokenLedger[]>([]);
    const [reqs, setReqs] = useState<TokenRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [reqCount, setReqCount] = useState('');
    const [reqNote, setReqNote] = useState('');
    const [reqMsg, setReqMsg] = useState('');
    const [reqBusy, setReqBusy] = useState(false);
    const [txFilter, setTxFilter] = useState<'all' | 'charge' | 'use'>('all'); // 충전·사용 내역 토글

    const reloadReqs = () => { void listChargeRequests(clientId ?? undefined).then(({ data }) => setReqs(data)); };
    useEffect(() => {
        let alive = true;
        setLoading(true);
        void listTokens(clientId ?? undefined).then(({ data }) => {
            if (!alive) return;
            setRows(data);
            setLoading(false);
        });
        reloadReqs();
        return () => { alive = false; };
    }, [clientId]);

    const submitReq = async () => {
        if (!clientId) return setReqMsg('고객 계정이 연결되어 있지 않습니다.');
        setReqBusy(true); setReqMsg('');
        const { error } = await requestCharge(clientId, reqCount ? Number(reqCount) : null, reqNote);
        setReqBusy(false);
        if (error) return setReqMsg('요청 실패: ' + error.message);
        setReqMsg('충전 요청이 접수되었습니다. 입금 확인 후 충전해 드립니다.');
        setReqCount(''); setReqNote(''); reloadReqs();
    };

    const balance = balanceOf(rows);
    const charged = rows.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0);
    const used = rows.filter((r) => r.delta < 0).reduce((s, r) => s - r.delta, 0);

    return (
        <div className="grid gap-4">
            <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="text-[12px] text-[#64748b]">잔여 발행</div>
                    <div className="text-2xl font-bold text-[#1e40af]">{balance}건</div>
                    <div className="mt-0.5 text-[11px] text-[#94a3b8]">₩{tokenWon(balance)}</div>
                </div>
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="text-[12px] text-[#64748b]">총 충전</div>
                    <div className="text-2xl font-bold text-[#059669]">{charged}건</div>
                    <div className="mt-0.5 text-[11px] text-[#94a3b8]">₩{tokenWon(charged)}</div>
                </div>
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="text-[12px] text-[#64748b]">총 사용(발행)</div>
                    <div className="text-2xl font-bold text-[#475569]">{used}건</div>
                    <div className="mt-0.5 text-[11px] text-[#94a3b8]">₩{tokenWon(used)}</div>
                </div>
            </div>

            {/* 충전 요청 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-5">
                <div className="mb-1 text-[15px] font-bold text-[#0f172a]">충전 요청</div>
                <p className="mb-3 mt-0 text-[12px] text-[#64748b]">입금 후 충전을 요청하시면 담당자가 확인하고 충전해 드립니다. <b className="text-[#4338ca]">발행 1건 = 1토큰 = {TOKEN_PRICE_KRW.toLocaleString('ko-KR')}원</b></p>
                <div className="flex flex-wrap items-end gap-2">
                    <div>
                        <div className="mb-1 text-[12px] font-semibold text-[#64748b]">희망 건수</div>
                        <input className="h-9 w-28 rounded border border-[#cbd5e1] px-2 text-sm" type="number" min={1} placeholder="예: 30" value={reqCount} onChange={(e) => setReqCount(e.target.value)} />
                    </div>
                    {reqCount && Number(reqCount) > 0 ? (
                        <div className="pb-1.5 text-[13px] font-semibold text-[#1e40af]">= ₩{tokenWon(Number(reqCount))} <span className="text-[11px] font-normal text-[#94a3b8]">입금</span></div>
                    ) : null}
                    <div className="min-w-[160px] flex-1">
                        <div className="mb-1 text-[12px] font-semibold text-[#64748b]">메모 (입금자명/일자)</div>
                        <input className="h-9 w-full rounded border border-[#cbd5e1] px-2 text-sm" placeholder="예: 홍길동 7/30 입금" value={reqNote} onChange={(e) => setReqNote(e.target.value)} />
                    </div>
                    <button className="h-9 rounded-md bg-[#4338ca] px-5 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50" disabled={reqBusy || !clientId} onClick={() => void submitReq()} type="button">{reqBusy ? '요청 중…' : '충전 요청'}</button>
                    {reqMsg && <span className="text-[12px] text-[#475569]">{reqMsg}</span>}
                </div>
                {reqs.length ? (
                    <div className="mt-3 grid gap-1">
                        {reqs.slice(0, 5).map((q) => (
                            <div key={q.id} className="flex items-center gap-2 rounded border border-[#f1f5f9] px-2 py-1 text-[12px]">
                                <span className="text-[#64748b]">{new Date(q.created_at).toLocaleDateString('ko-KR')}</span>
                                <span className="font-semibold">{q.requested_count ? `${q.requested_count}건` : '건수 미지정'}</span>
                                {q.requested_count ? <span className="text-[11px] text-[#94a3b8]">₩{tokenWon(q.requested_count)}</span> : null}
                                <span className="text-[#94a3b8]">{q.note ?? ''}</span>
                                <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${q.status === 'done' ? 'bg-[#dcfce7] text-[#166534]' : q.status === 'rejected' ? 'bg-[#fee2e2] text-[#b91c1c]' : 'bg-[#fef9c3] text-[#854d0e]'}`}>{q.status === 'done' ? '충전완료' : q.status === 'rejected' ? '반려' : '대기'}</span>
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>

            <div className="rounded-xl border border-[#e2e8f0] bg-white p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                    <div className="text-[15px] font-bold text-[#0f172a]">충전·사용 내역</div>
                    <div className="ml-auto inline-flex rounded-lg border border-[#e2e8f0] p-0.5">
                        {([['all', '전체'], ['charge', '충전'], ['use', '사용(발행)']] as const).map(([k, label]) => (
                            <button key={k} type="button" onClick={() => setTxFilter(k)}
                                className={`rounded-md px-3 py-1 text-xs font-bold ${txFilter === k ? (k === 'use' ? 'bg-[#e0e7ff] text-[#4338ca]' : k === 'charge' ? 'bg-[#dcfce7] text-[#166534]' : 'bg-[#1e40af] text-white') : 'text-[#64748b] hover:text-[#334155]'}`}>
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
                {(() => {
                    const txRows = rows.filter((r) => (txFilter === 'all' ? true : txFilter === 'charge' ? r.delta > 0 : r.delta < 0));
                    return loading ? (
                    <div className="py-8 text-center text-sm text-[#94a3b8]">불러오는 중…</div>
                ) : txRows.length === 0 ? (
                    <div className="py-8 text-center text-sm text-[#94a3b8]">{txFilter === 'charge' ? '충전 내역이 없습니다.' : txFilter === 'use' ? '사용(발행) 내역이 없습니다.' : '아직 충전 내역이 없습니다. 입금 후 담당자가 충전해 드립니다.'}</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[420px] border-collapse text-[13px]">
                            <thead>
                                <tr className="border-b border-[#e2e8f0] text-left text-[#64748b]">
                                    {['일시', '구분', '건수', '메모'].map((h) => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {txRows.map((r) => (
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
                );
                })()}
            </div>
        </div>
    );
}
