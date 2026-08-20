import { useCallback, useEffect, useState } from 'react';
import {
    listSubRequests, subRequestTokens, subDeclarePayment, type SubTokenRequest,
} from '../../api/orgs';
import { won, vatOf, totalOf, intOnly, MAX_COUNT, PAY_METHODS } from '../../api/cafeTokens';

// 하위 업체 화면 — 소속 대행사에게 토큰을 산다. 우리↔대행사와 같은 4단계.
//   신청 → 대행사가 금액 통보 → 계좌이체 후 '완료' 신고 → 대행사가 확인 후 발행.
//   ★ 하위 업체는 우리(든든한마케팅)가 아니라 **대행사**에게 신청한다. 그래서 이 화면이
//     기본 '충전 요청'을 대체한다 — 두 곳에 신청할 수 있으면 어디에 입금해야 할지 알 수 없다.

const STATUS: Record<string, { label: string; cls: string }> = {
    pending:  { label: '접수',         cls: 'bg-[#fef9c3] text-[#854d0e]' },
    quoted:   { label: '금액 통보',    cls: 'bg-[#dbeafe] text-[#1d4ed8]' },
    paid:     { label: '입금 확인 중', cls: 'bg-[#ffedd5] text-[#c2410c]' },
    done:     { label: '충전완료',     cls: 'bg-[#dcfce7] text-[#166534]' },
    rejected: { label: '반려',         cls: 'bg-[#fee2e2] text-[#b91c1c]' },
};

export function SubTokenPurchase({ clientId, agencyName }: { clientId: string; agencyName: string }) {
    const [reqs, setReqs] = useState<SubTokenRequest[]>([]);
    const [count, setCount] = useState('');
    const [pay, setPay] = useState<string>(PAY_METHODS[0]);
    const [payer, setPayer] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [msg, setMsg] = useState('');
    const [err, setErr] = useState('');

    const load = useCallback(() => {
        void listSubRequests({ childId: clientId }).then(({ data }) => setReqs(data));
    }, [clientId]);
    useEffect(load, [load]);

    const submit = async () => {
        const n = Number(count);
        if (!n || n <= 0) return setErr('신청 건수를 입력하세요.');
        setBusy('new'); setErr(''); setMsg('');
        const { error } = await subRequestTokens(n, undefined, pay);
        setBusy(null);
        if (error) return setErr(error.message);
        setMsg(`${agencyName} 에 ${n}건 신청했습니다. 금액을 통보받으면 여기에 표시됩니다.`);
        setCount(''); load();
    };

    const declare = async (q: SubTokenRequest) => {
        setBusy(q.id); setErr(''); setMsg('');
        const { error } = await subDeclarePayment(q.id, payer[q.id]);
        setBusy(null);
        if (error) return setErr(error.message);
        setMsg('입금 신고가 접수되었습니다. 확인 후 충전됩니다.');
        load();
    };

    const openOne = reqs.find((r) => ['pending', 'quoted', 'paid'].includes(r.status));
    // 금액을 통보받아 내가 입금할 차례인 건.
    const payDue = reqs.filter((r) => r.status === 'quoted').length;

    return (
        <div className={payDue
            ? 'rounded-xl border-2 border-[#3b82f6] bg-[#f5f9ff] p-5 shadow-[0_2px_12px_rgba(59,130,246,0.18)]'
            : 'rounded-xl border border-[#e2e8f0] bg-white p-5'}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
                {payDue ? <span className="text-[16px] leading-none">💰</span> : null}
                <span className="text-[15px] font-bold text-[#0f172a]">충전 신청</span>
                <span className="text-[12px] font-normal text-[#94a3b8]">→ {agencyName}</span>
                {payDue ? (
                    <span className="rounded-full bg-[#1d4ed8] px-2 py-0.5 text-[12px] font-bold text-white">
                        입금 대기 {payDue}건
                    </span>
                ) : null}
            </div>

            {openOne ? (
                <div className="mb-3 rounded-lg border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-[12px] text-[#64748b]">
                    처리 중인 신청이 있어 새 신청은 완료 후에 가능합니다.
                </div>
            ) : (
                <div className="mb-3 grid max-w-[560px] gap-2.5">
                    <label className="flex items-center gap-3">
                        <span className="w-[88px] shrink-0 text-[13px] font-semibold text-[#475569]">결제 방식</span>
                        <select className="h-9 flex-1 rounded border border-[#cbd5e1] bg-white px-2 text-sm"
                            onChange={(e) => setPay(e.target.value)} value={pay}>
                            {PAY_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </label>
                    <label className="flex items-center gap-3">
                        <span className="w-[88px] shrink-0 text-[13px] font-semibold text-[#475569]">건수</span>
                        <div className="flex flex-1 items-center gap-2">
                            <input className="h-9 w-32 rounded border border-[#cbd5e1] px-2 text-sm" min={1}
                                onChange={(e) => setCount(intOnly(e.target.value, MAX_COUNT))} placeholder="예: 10" type="number" value={count} />
                            <span className="text-[13px] text-[#64748b]">건</span>
                        </div>
                    </label>
                    <div className="pl-[100px]">
                        <button className="h-9 rounded-md bg-[#4338ca] px-5 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50"
                            disabled={busy !== null} onClick={() => void submit()} type="button">
                            {busy === 'new' ? '신청 중…' : '충전 신청'}
                        </button>
                    </div>
                </div>
            )}

            {msg ? <p className="m-0 mb-2 text-[12px] font-semibold text-[#15803d]">{msg}</p> : null}
            {err ? <p className="m-0 mb-2 text-[12px] font-semibold text-[#b91c1c]">{err}</p> : null}

            {reqs.length ? (
                <div className="grid gap-1.5">
                    {reqs.slice(0, 6).map((q) => {
                        const st = STATUS[q.status] ?? { label: q.status, cls: 'bg-[#f1f5f9] text-[#64748b]' };
                        const n = q.quoted_count ?? q.requested_count;
                        return (
                            <div className="rounded border border-[#f1f5f9] px-2 py-1.5 text-[12px]" key={q.id}>
                                {/* 한 줄로 — 날짜·완료문구는 아래 '충전·사용 내역'에 이미 있다. */}
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                    <span className="font-semibold">{n ? `${n}건` : '건수 미지정'}</span>
                                    {q.pay_method ? <span className="text-[11px] text-[#64748b]">{q.pay_method}</span> : null}
                                    {q.amount != null ? (
                                        <span className="text-[#334155]">
                                            공급가 <b>₩{won(q.amount)}</b>
                                            <span className="text-[#94a3b8]"> + 부가세 ₩{won(vatOf(q.amount))}</span>
                                            {' '}= <b className="text-[#c2410c]">₩{won(totalOf(q.amount))}</b>
                                        </span>
                                    ) : null}
                                    {q.note ? <span className="text-[11px] text-[#94a3b8]">{q.note}</span> : null}
                                    <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                                </div>

                                {q.status === 'quoted' && q.pay_account ? (
                                    <div className="mt-1.5 rounded-lg border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[12px] leading-6 text-[#7c2d12]">
                                        <b>입금 계좌</b> · {q.pay_bank} <b className="font-mono">{q.pay_account}</b> ({q.pay_holder})
                                    </div>
                                ) : null}
                                {q.status === 'quoted' ? (
                                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                        <input className="h-8 w-36 rounded border border-[#cbd5e1] px-2 text-[12px]"
                                            onChange={(e) => setPayer((m) => ({ ...m, [q.id]: e.target.value }))}
                                            placeholder="입금자명" value={payer[q.id] ?? ''} />
                                        <button className="h-8 rounded bg-[#c2410c] px-3 text-[12px] font-bold text-white hover:bg-[#9a3412] disabled:opacity-50"
                                            disabled={busy === q.id} onClick={() => void declare(q)} type="button">
                                            {busy === q.id ? '신고 중…' : '계좌이체 완료'}
                                        </button>
                                    </div>
                                ) : null}
                                {q.status === 'paid' ? (
                                    <div className="mt-1 text-[11px] text-[#c2410c]">
                                        입금 확인 중입니다{q.depositor ? ` (입금자 ${q.depositor})` : ''}.
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
