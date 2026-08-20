import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { myParentAgency } from '../../api/orgs';
import { SubTokenPurchase } from '../portal/SubTokenPurchase';
// ★ 일반 고객 화면에는 금액을 노출하지 않는다(건수만) — 사장님 지시 2026-08-10.
//   예외는 대행사다. 대행사는 우리에게 '사서 되파는' 거래처라 통보 금액을 보고 입금해야 한다
//   (2026-08-19 확정). 그래서 금액 표시는 is_agency 일 때만 켠다.
import {
    listTokens, balanceOf, requestCharge, listChargeRequests, declareTokenPayment,
    won, vatOf, totalOf, AGENCY_MIN_COUNT, PAY_METHODS, intOnly, MAX_COUNT,
    type TokenLedger, type TokenRequest,
} from '../../api/cafeTokens';

// 신청 상태 — 신청 → 금액 통보 → 입금 신고 → 발행 완료.
const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
    pending: { label: '접수', cls: 'bg-[#fef9c3] text-[#854d0e]' },
    quoted: { label: '금액 통보', cls: 'bg-[#dbeafe] text-[#1d4ed8]' },
    paid: { label: '입금 확인 중', cls: 'bg-[#ffedd5] text-[#c2410c]' },
    done: { label: '충전완료', cls: 'bg-[#dcfce7] text-[#166534]' },
    rejected: { label: '반려', cls: 'bg-[#fee2e2] text-[#b91c1c]' },
};

// 고객 '충전내역' — 발행 토큰 잔액 + 충전/사용 히스토리(본인, RLS 스코프).
export function CafeTokenHistory({ clientId }: { clientId: string | null }) {
    const [rows, setRows] = useState<TokenLedger[]>([]);
    const [reqs, setReqs] = useState<TokenRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [reqCount, setReqCount] = useState('');
    const [reqPay, setReqPay] = useState<string>(PAY_METHODS[0]);
    const [reqMsg, setReqMsg] = useState('');
    const [reqBusy, setReqBusy] = useState(false);
    const [txFilter, setTxFilter] = useState<'all' | 'charge' | 'use' | 'give'>('all'); // 충전·사용 내역 토글
    const [isAgency, setIsAgency] = useState(false);   // 대행사만 금액·입금 신고 UI 를 본다
    // 소속 대행사 — 있으면 우리가 아니라 그 대행사에게 신청한다(두 곳에 신청하면 어디 입금할지 알 수 없다).
    const [parentAgency, setParentAgency] = useState<{ id: string | null; company: string | null }>({ id: null, company: null });
    const [payer, setPayer] = useState<Record<string, string>>({}); // 신청별 입금자명
    const [payBusy, setPayBusy] = useState<string | null>(null);

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
        if (clientId) {
            void supabase.from('clients').select('is_agency').eq('id', clientId).maybeSingle()
                .then(({ data }) => alive && setIsAgency(!!data?.is_agency));
            void myParentAgency().then((a) => alive && setParentAgency(a));
        }
        return () => { alive = false; };
    }, [clientId]);

    // 계좌이체 완료 신고 — 토큰은 여기서 지급되지 않는다. 우리가 통장을 확인하고 발행한다.
    const declarePaid = async (q: TokenRequest) => {
        setPayBusy(q.id); setReqMsg('');
        const { error } = await declareTokenPayment(q.id, payer[q.id]);
        setPayBusy(null);
        if (error) return setReqMsg('신고 실패: ' + error.message);
        setReqMsg('입금 신고가 접수되었습니다. 확인 후 발행해 드립니다.');
        reloadReqs();
    };

    const submitReq = async () => {
        if (!clientId) return setReqMsg('고객 계정이 연결되어 있지 않습니다.');
        // 대행사는 최소 수량이 있다. 서버에서 막는 값이 아니라 안내이므로 문구로 분명히 알린다.
        if (isAgency && Number(reqCount) < AGENCY_MIN_COUNT)
            return setReqMsg(`대행사 최소 신청 수량은 ${AGENCY_MIN_COUNT}건입니다.`);
        setReqBusy(true); setReqMsg('');
        const { error } = await requestCharge(clientId, reqCount ? Number(reqCount) : null, undefined, reqPay);
        setReqBusy(false);
        if (error) return setReqMsg('요청 실패: ' + error.message);
        setReqMsg(isAgency
            ? '신청이 접수되었습니다. 담당자가 금액을 통보해 드립니다.'
            : '충전 요청이 접수되었습니다. 입금 확인 후 충전해 드립니다.');
        setReqCount(''); reloadReqs();
    };

    // 금액을 통보받아 내가 입금할 차례인 건 — 이게 있으면 카드를 띄운다.
    const payDue = reqs.filter((r) => r.status === 'quoted').length;
    const balance = balanceOf(rows);
    // 유상 충전(금액에 잡힘) vs 서비스(무상, 노출 안 될 때 지급 — 금액 미포함). 잔액엔 둘 다 포함(사용 가능).
    const paidCharged = rows.filter((r) => r.delta > 0 && r.kind !== '서비스').reduce((s, r) => s + r.delta, 0);
    const serviceGranted = rows.filter((r) => r.delta > 0 && r.kind === '서비스').reduce((s, r) => s + r.delta, 0);
    // ★ 부호(delta<0)만 보면 '배분'(하위에 내보낸 것)까지 "발행에 쓴 것"으로 잡힌다.
    //   대행사 화면에서 실제 발행 3건이 10건으로 보였다(2026-08-20 검증). kind 로 가른다.
    const used = rows.filter((r) => r.delta < 0 && r.kind !== '배분').reduce((s, r) => s - r.delta, 0);
    const distributed = rows.filter((r) => r.kind === '배분').reduce((s, r) => s - r.delta, 0);

    return (
        <div className="grid gap-4">
            <div className="grid grid-cols-3 gap-3" data-tour="charge-balance">
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="text-[12px] text-[#64748b]">잔여 발행</div>
                    <div className="text-2xl font-bold text-[#1e40af]">{balance}건</div>
                </div>
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="text-[12px] text-[#64748b]">총 충전 <span className="font-normal text-[#cbd5e1]">(유상)</span></div>
                    <div className="text-2xl font-bold text-[#059669]">{paidCharged}건</div>
                    {serviceGranted ? <div className="mt-0.5 text-[11px] text-[#b45309]">서비스 {serviceGranted}건(무상)</div> : null}
                </div>
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="text-[12px] text-[#64748b]">총 사용(발행)</div>
                    <div className="text-2xl font-bold text-[#475569]">{used}건</div>
                    {distributed ? <div className="mt-0.5 text-[11px] text-[#6d28d9]">하위 배분 {distributed}건(별도)</div> : null}
                </div>
            </div>

            {/* 충전 요청 — 대행사 소속 업체는 그 대행사에게, 직거래 업체는 우리에게.
                내가 입금할 차례(금액 통보받음)면 파랑으로 띄운다 — 알림 배너와 같은 색. */}
            {parentAgency.id && clientId ? (
                <SubTokenPurchase agencyName={parentAgency.company || '소속 대행사'} clientId={clientId} />
            ) : (
            <div className={payDue
                ? 'rounded-xl border-2 border-[#3b82f6] bg-[#f5f9ff] p-5 shadow-[0_2px_12px_rgba(59,130,246,0.18)]'
                : 'rounded-xl border border-[#e2e8f0] bg-white p-5'}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                    {payDue ? <span className="text-[16px] leading-none">💰</span> : null}
                    <span className="text-[15px] font-bold text-[#0f172a]">충전 요청</span>
                    <button type="button" onClick={() => window.dispatchEvent(new Event('charge-guide:open'))}
                        className="ml-auto inline-flex items-center gap-1 rounded-md border border-[#c7d2fe] bg-[#eef2ff] px-2.5 py-1 text-[12px] font-bold text-[#4338ca] hover:bg-[#e0e7ff]"
                        title="충전 요청 방법을 처음부터 안내합니다">📖 가이드 보기</button>
                    {payDue ? (
                        <span className="rounded-full bg-[#1d4ed8] px-2 py-0.5 text-[12px] font-bold text-white">
                            입금 대기 {payDue}건
                        </span>
                    ) : null}
                </div>
                {/* 항목을 한 줄에 늘어놓으면 무엇을 적어야 하는지 눈에 안 들어온다 — 라벨을 왼쪽에 세운다. */}
                <div className="grid max-w-[560px] gap-2.5" data-tour="charge-form">
                    <label className="flex items-center gap-3">
                        <span className="w-[88px] shrink-0 text-[13px] font-semibold text-[#475569]">결제 방식</span>
                        <select className="h-9 flex-1 rounded border border-[#cbd5e1] bg-white px-2 text-sm"
                            data-tour="charge-method"
                            onChange={(e) => setReqPay(e.target.value)} value={reqPay}>
                            {PAY_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </label>
                    <label className="flex items-center gap-3">
                        <span className="w-[88px] shrink-0 text-[13px] font-semibold text-[#475569]">건수</span>
                        <div className="flex flex-1 items-center gap-2">
                            <input className="h-9 w-32 rounded border border-[#cbd5e1] px-2 text-sm" min={1}
                                data-tour="charge-count"
                                onChange={(e) => setReqCount(intOnly(e.target.value, MAX_COUNT))}
                                placeholder={isAgency ? `최소 ${AGENCY_MIN_COUNT}` : '예: 30'} type="number" value={reqCount} />
                            <span className="text-[13px] text-[#64748b]">건</span>
                        </div>
                    </label>
                    <div className="flex items-center gap-3 pl-[100px]">
                        <button className="h-9 rounded-md bg-[#4338ca] px-5 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50"
                            data-tour="charge-submit"
                            disabled={reqBusy || !clientId} onClick={() => void submitReq()} type="button">
                            {reqBusy ? '요청 중…' : '충전 요청'}
                        </button>
                        {reqMsg && <span className="text-[12px] text-[#475569]">{reqMsg}</span>}
                    </div>
                </div>
                {reqs.length ? (
                    <div className="mt-3 grid gap-1.5" data-tour="charge-list">
                        {reqs.slice(0, 5).map((q) => {
                            const st = STATUS_LABEL[q.status] ?? { label: q.status, cls: 'bg-[#f1f5f9] text-[#64748b]' };
                            const n = q.quoted_count ?? q.requested_count;
                            return (
                                <div className="rounded border border-[#f1f5f9] px-2 py-1.5 text-[12px]" key={q.id}>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-[#64748b]">{new Date(q.created_at).toLocaleDateString('ko-KR')}</span>
                                        <span className="font-semibold">{n ? `${n}건` : '건수 미지정'}</span>
                                        {q.pay_method ? <span className="rounded bg-[#f1f5f9] px-1.5 py-0.5 text-[11px] font-semibold text-[#475569]">{q.pay_method}</span> : null}
                                        <span className="text-[#94a3b8]">{q.note ?? ''}</span>
                                        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                                    </div>

                                    {/* 통보 금액 — 대행사만. 일반 고객 화면에는 금액을 띄우지 않는다. */}
                                    {isAgency && q.amount != null ? (
                                        <div className="mt-1 text-[12px] text-[#334155]">
                                            공급가 <b>₩{won(q.amount)}</b>
                                            <span className="text-[#94a3b8]"> + 부가세 ₩{won(vatOf(q.amount))}</span>
                                            {' '}= <b className="text-[#c2410c]">₩{won(totalOf(q.amount))}</b>
                                        </div>
                                    ) : null}

{q.status === 'quoted' && q.pay_account ? (
                                        <div className="mt-1.5 rounded-lg border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[12px] leading-6 text-[#7c2d12]" data-tour="charge-account">
                                            <b>입금 계좌</b> · {q.pay_bank} <b className="font-mono">{q.pay_account}</b> ({q.pay_holder})
                                        </div>
                                    ) : null}
                                                                        {/* 입금 신고 — 금액을 통보받은 뒤에만. */}
                                    {isAgency && q.status === 'quoted' ? (
                                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                            <input
                                                className="h-8 w-36 rounded border border-[#cbd5e1] px-2 text-[12px]"
                                                onChange={(e) => setPayer((m) => ({ ...m, [q.id]: e.target.value }))}
                                                placeholder="입금자명"
                                                value={payer[q.id] ?? ''}
                                            />
                                            <button
                                                className="h-8 rounded bg-[#c2410c] px-3 text-[12px] font-bold text-white hover:bg-[#9a3412] disabled:opacity-50"
                                                disabled={payBusy === q.id}
                                                onClick={() => void declarePaid(q)}
                                                type="button"
                                            >
                                                {payBusy === q.id ? '신고 중…' : '계좌이체 완료'}
                                            </button>
                                            <span className="text-[11px] text-[#94a3b8]">입금 확인 후 토큰이 발행됩니다.</span>
                                        </div>
                                    ) : null}
                                    {q.status === 'paid' ? (
                                        <div className="mt-1 text-[11px] text-[#c2410c]">입금 확인 중입니다{q.depositor ? ` (입금자 ${q.depositor})` : ''}.</div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                ) : null}
            </div>

            )}

            <div className="rounded-xl border border-[#e2e8f0] bg-white p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                    <div className="text-[15px] font-bold text-[#0f172a]">충전·사용 내역</div>
                    <div className="ml-auto inline-flex rounded-lg border border-[#e2e8f0] p-0.5">
                        {/* 배분 탭은 하위에 내보낸 이력이 있을 때만 — 직거래 고객에게는 뜻 없는 칸이다. */}
                        {([['all', '전체'], ['charge', '충전'], ['use', '사용(발행)'],
                           ...(distributed ? [['give', '배분'] as const] : [])] as const).map(([k, label]) => (
                            <button key={k} type="button" onClick={() => setTxFilter(k)}
                                className={`rounded-md px-3 py-1 text-xs font-bold ${
                                    txFilter === k
                                        ? k === 'use' ? 'bg-[#e0e7ff] text-[#4338ca]'
                                        : k === 'charge' ? 'bg-[#dcfce7] text-[#166534]'
                                        : k === 'give' ? 'bg-[#ede9fe] text-[#6d28d9]'
                                        : 'bg-[#1e40af] text-white'
                                        : 'text-[#64748b] hover:text-[#334155]'}`}>
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
                {(() => {
                    const txRows = rows.filter((r) =>
                        txFilter === 'all' ? true
                        : txFilter === 'charge' ? r.delta > 0
                        : txFilter === 'give' ? r.kind === '배분'
                        : r.delta < 0 && r.kind !== '배분');
                    return loading ? (
                    <div className="py-8 text-center text-sm text-[#94a3b8]">불러오는 중…</div>
                ) : txRows.length === 0 ? (
                    <div className="py-8 text-center text-sm text-[#94a3b8]">{txFilter === 'charge' ? '충전 내역이 없습니다.'
                        : txFilter === 'use' ? '사용(발행) 내역이 없습니다.'
                        : txFilter === 'give' ? '하위 업체에 배분한 내역이 없습니다.'
                        : '아직 충전 내역이 없습니다. 입금 후 담당자가 충전해 드립니다.'}</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[520px] border-collapse text-[13px]">
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
                                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.kind === '충전' ? 'bg-[#dcfce7] text-[#166534]' : r.kind === '발행' ? 'bg-[#e0e7ff] text-[#4338ca]' : r.kind === '서비스' ? 'bg-[#fef3c7] text-[#b45309]' : r.kind === '배분' ? 'bg-[#ede9fe] text-[#6d28d9]' : r.kind === '대행사충전' ? 'bg-[#dcfce7] text-[#166534]' : 'bg-[#f1f5f9] text-[#64748b]'}`}>{r.kind}</span>
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
