import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listTokens, grantTokens, balanceOf, listChargeRequests, setChargeRequestStatus, type TokenLedger, type TokenRequest } from '../api/cafeTokens';

type ClientLite = { id: string; company: string | null };

// 관리자 — 카페 발행 토큰 충전(입금 확인 후 건수 지급) + 전체 충전/사용 내역.
export default function TokenChargePanel() {
    const [clients, setClients] = useState<ClientLite[]>([]);
    const [rows, setRows] = useState<TokenLedger[]>([]);
    const [reqs, setReqs] = useState<TokenRequest[]>([]);
    const [fulfilling, setFulfilling] = useState<string | null>(null); // 이 요청을 충전으로 처리 중
    const [pick, setPick] = useState('');
    const [search, setSearch] = useState('');
    const [count, setCount] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');

    const load = () => {
        void Promise.all([
            supabase.from('clients').select('id,company').order('company'),
            listTokens(),
        ]).then(([cl, tk]) => {
            setClients(((cl.data as ClientLite[]) ?? []));
            setRows(tk.data);
            if (tk.error) setMsg(tk.error.message);
        });
        void listChargeRequests().then(({ data }) => setReqs(data.filter((r) => r.status === 'pending')));
    };
    useEffect(load, []);

    const fromRequest = (q: TokenRequest) => {
        setPick(q.client_id);
        setSearch(clients.find((c) => c.id === q.client_id)?.company || '');
        if (q.requested_count) setCount(String(q.requested_count));
        if (q.note) setNote(q.note);
        setFulfilling(q.id);
    };
    const rejectReq = async (id: string) => {
        await setChargeRequestStatus(id, 'rejected'); load();
    };

    const clientName = (id: string) => clients.find((c) => c.id === id)?.company || id.slice(0, 8);
    const matches = useMemo(() => {
        const q = search.replace(/\s+/g, '').toLowerCase();
        return (q ? clients.filter((c) => (c.company || '').replace(/\s+/g, '').toLowerCase().includes(q)) : clients).slice(0, 8);
    }, [clients, search]);
    const pickedBalance = pick ? balanceOf(rows, pick) : 0;

    const charge = async () => {
        if (!pick) return setMsg('충전할 업체를 선택하세요.');
        const n = Number(count);
        if (!n || n <= 0) return setMsg('건수를 1 이상 입력하세요.');
        setBusy(true); setMsg('');
        const { error } = await grantTokens(pick, n, note);
        if (error) { setBusy(false); return setMsg('충전 실패: ' + error.message); }
        if (fulfilling) { await setChargeRequestStatus(fulfilling, 'done'); setFulfilling(null); }
        setBusy(false);
        setMsg(`${clientName(pick)} +${n}건 충전 완료`);
        setCount(''); setNote('');
        load();
    };

    return (
        <div className="grid gap-5">
            {/* 충전 요청 대기 */}
            {reqs.length ? (
                <div className="rounded-xl border-2 border-[#f59e0b] bg-[#fffbeb] p-4">
                    <div className="mb-2 text-[14px] font-bold text-[#92400e]">충전 요청 대기 ({reqs.length})</div>
                    <div className="grid gap-2">
                        {reqs.map((q) => (
                            <div key={q.id} className="flex flex-wrap items-center gap-2 rounded border border-[#fde68a] bg-white px-3 py-2 text-[13px]">
                                <span className="font-bold text-[#334155]">{clientName(q.client_id)}</span>
                                <span className="text-[#4338ca] font-semibold">{q.requested_count ? `${q.requested_count}건 요청` : '건수 미지정'}</span>
                                {q.note ? <span className="text-[#64748b]">· {q.note}</span> : null}
                                <span className="text-[11px] text-[#cbd5e1]">{new Date(q.created_at).toLocaleString('ko-KR')}</span>
                                <div className="ml-auto flex gap-2">
                                    <button className="rounded bg-[#059669] px-3 py-1 text-[11px] font-bold text-white" onClick={() => fromRequest(q)} type="button">이 요청으로 충전</button>
                                    <button className="rounded border border-[#cbd5e1] px-2 py-1 text-[11px] font-semibold text-[#64748b]" onClick={() => void rejectReq(q.id)} type="button">반려</button>
                                </div>
                            </div>
                        ))}
                    </div>
                    <p className="m-0 mt-2 text-[11px] text-[#92400e]">"이 요청으로 충전" → 아래 폼에 업체·건수 채워짐 → 충전하면 요청이 자동으로 완료 처리됩니다.</p>
                </div>
            ) : null}

            {/* 충전 */}
            <div className="rounded-xl border border-[#e2e8f0] p-5">
                <div className="mb-3 text-[15px] font-bold text-[#0f172a]">토큰 충전 (입금 확인 후 건수 지급)</div>
                <div className="grid gap-3 md:grid-cols-2">
                    <div>
                        <div className="mb-1 text-[12px] font-semibold text-[#64748b]">업체 선택</div>
                        <input className="mb-1.5 h-9 w-full rounded border border-[#cbd5e1] px-2 text-sm" placeholder="업체명 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
                        <div className="flex flex-wrap gap-1.5">
                            {matches.map((c) => (
                                <button key={c.id} type="button" onClick={() => setPick(c.id)}
                                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${pick === c.id ? 'border-[#1e40af] bg-[#1e40af] text-white' : 'border-[#cbd5e1] bg-white text-[#475569]'}`}>
                                    {c.company || '(이름없음)'}
                                </button>
                            ))}
                            {matches.length === 0 ? <span className="text-xs text-[#94a3b8]">일치 업체 없음</span> : null}
                        </div>
                        {pick ? <div className="mt-1.5 text-[12px] text-[#1e40af]">선택: <b>{clientName(pick)}</b> · 현재 잔액 <b>{pickedBalance}건</b></div> : null}
                    </div>
                    <div className="grid content-start gap-2">
                        <div>
                            <div className="mb-1 text-[12px] font-semibold text-[#64748b]">충전 건수</div>
                            <input className="h-9 w-full rounded border border-[#cbd5e1] px-2 text-sm" type="number" min={1} placeholder="예: 30" value={count} onChange={(e) => setCount(e.target.value)} />
                        </div>
                        <div>
                            <div className="mb-1 text-[12px] font-semibold text-[#64748b]">메모 (선택)</div>
                            <input className="h-9 w-full rounded border border-[#cbd5e1] px-2 text-sm" placeholder="입금자명/일자 등" value={note} onChange={(e) => setNote(e.target.value)} />
                        </div>
                        <button className="mt-1 h-10 rounded-md bg-[#059669] px-5 text-sm font-bold text-white hover:bg-[#047857] disabled:opacity-50" disabled={busy || !pick} onClick={() => void charge()} type="button">
                            {busy ? '충전 중…' : '충전'}
                        </button>
                        {msg && <span className="text-[12px] text-[#475569]">{msg}</span>}
                    </div>
                </div>
            </div>

            {/* 전체 내역 */}
            <div className="rounded-xl border border-[#e2e8f0] p-5">
                <div className="mb-3 flex items-center justify-between">
                    <div className="text-[15px] font-bold text-[#0f172a]">토큰 충전·사용 내역 (전체)</div>
                    <button className="rounded-md border border-[#cbd5e1] px-3 py-1 text-xs font-semibold text-[#475569]" onClick={load} type="button">새로고침</button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse text-[13px]">
                        <thead>
                            <tr className="border-b border-[#e2e8f0] text-left text-[#64748b]">
                                {['일시', '업체', '구분', '건수', '메모'].map((h) => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 ? (
                                <tr><td className="px-2 py-8 text-center text-[#94a3b8]" colSpan={5}>내역이 없습니다.</td></tr>
                            ) : rows.map((r) => (
                                <tr key={r.id} className="border-b border-[#f1f5f9] text-[#334155]">
                                    <td className="whitespace-nowrap px-2 py-2">{new Date(r.created_at).toLocaleString('ko-KR')}</td>
                                    <td className="whitespace-nowrap px-2 py-2 font-semibold">{clientName(r.client_id)}</td>
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
            </div>
        </div>
    );
}
