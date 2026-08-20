import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
    listTokens, grantTokens, balanceOf, listChargeRequests,
    quoteChargeRequest, fulfillChargeRequest,
    won, vatOf, totalOf, intOnly, MAX_COUNT, MAX_UNIT_PRICE, TOKEN_PRICE_KRW,
    getDefaultUnitPrice, setDefaultUnitPrice,
    type TokenLedger, type TokenRequest,
} from '../api/cafeTokens';
import { listSubRequests, type SubTokenRequest } from '../api/orgs';
import { PAYMENT_INFO } from '../api/cafeDeployRequests';

type ClientLite = { id: string; company: string | null; is_agency?: boolean | null };

// 관리자 — 토큰 구매 처리. 신청 → 금액 통보 → 입금 신고 → 발행 4단계를 한 화면에서 본다.
//   ★ 흐름을 상태 하나로 두는 이유: "돈은 들어왔는데 토큰을 안 줬다" / "토큰은 줬는데 입금이 없다" 를
//     사람 기억이 아니라 화면에서 잡아야 한다. 각 단계의 시각이 행에 남는다.
//   ★ 금액은 공급가(부가세 미포함)로 다룬다. 실제 입금액은 공급가 + VAT 10%.

const STATUS: Record<string, { label: string; cls: string }> = {
    pending:  { label: '신청',      cls: 'bg-[#fef9c3] text-[#854d0e]' },
    quoted:   { label: '금액 통보', cls: 'bg-[#dbeafe] text-[#1d4ed8]' },
    paid:     { label: '입금 신고', cls: 'bg-[#ffedd5] text-[#c2410c]' },
    done:     { label: '발행 완료', cls: 'bg-[#dcfce7] text-[#166534]' },
    rejected: { label: '반려',      cls: 'bg-[#fee2e2] text-[#b91c1c]' },
};
const chip = (s: string) => STATUS[s] ?? { label: s, cls: 'bg-[#f1f5f9] text-[#64748b]' };
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '');

export default function TokenChargePanel() {
    const [clients, setClients] = useState<ClientLite[]>([]);
    const [rows, setRows] = useState<TokenLedger[]>([]);
    const [reqs, setReqs] = useState<TokenRequest[]>([]);
    // 대행사 ↔ 하위 거래 — 우리는 관여하지 않고 보기만 한다(정산·분쟁 대비).
    const [subReqs, setSubReqs] = useState<SubTokenRequest[]>([]);
    const [scope, setScope] = useState<'open' | 'all'>('open'); // 처리 대기 / 전체(히스토리)
    const [pick, setPick] = useState('');
    const [search, setSearch] = useState('');
    const [count, setCount] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    // 행별 입력값 — 금액 통보(건수·단가).
    const [qCount, setQCount] = useState<Record<string, string>>({});
    const [qPrice, setQPrice] = useState<Record<string, string>>({});
    // 기본 단가 — 통보 화면에 처음 채워지는 값. 매번 달라질 수 있어 설정으로 뺐다.
    const [unitPrice, setUnitPrice] = useState<number>(TOKEN_PRICE_KRW);
    const [priceEdit, setPriceEdit] = useState('');
    const [priceOk, setPriceOk] = useState(true);   // 기본 단가를 실제로 읽었는가

    const load = () => {
        void Promise.all([
            supabase.from('clients').select('id,company,is_agency').order('company'),
            listTokens(),
            listChargeRequests(),
            listSubRequests(),
        ]).then(([cl, tk, rq, sr]) => {
            setClients((cl.data as ClientLite[]) ?? []);
            setRows(tk.data);
            setReqs(rq.data);
            setSubReqs(sr.data);
            if (tk.error) setMsg(tk.error.message);
        });
        void getDefaultUnitPrice().then((r) => {
            setUnitPrice(r.price); setPriceEdit(String(r.price)); setPriceOk(r.ok);
            if (!r.ok) setMsg(`기본 단가를 읽지 못했습니다(${r.error}). 통보 전에 단가를 직접 확인하세요.`);
        });
    };
    useEffect(load, []);

    const clientOf = (id: string) => clients.find((c) => c.id === id);
    const clientName = (id: string) => clientOf(id)?.company || id.slice(0, 8);
    // 통보 화면 기본값. 건별로 다르면 그 자리에서 고친다 — 저장은 행 단위라 과거 거래는 안 변한다.
    //   (clientOf 는 대행사 표시 뱃지에 계속 쓰인다)
    const defaultPrice = (_id: string) => unitPrice;

    const matches = useMemo(() => {
        const q = search.replace(/\s+/g, '').toLowerCase();
        return (q ? clients.filter((c) => (c.company || '').replace(/\s+/g, '').toLowerCase().includes(q)) : clients).slice(0, 8);
    }, [clients, search]);
    const pickedBalance = pick ? balanceOf(rows, pick) : 0;

    const open = reqs.filter((r) => r.status !== 'done' && r.status !== 'rejected');
    const openCount = open.length;
    const view = scope === 'open' ? open : reqs;

    const act = async (fn: () => Promise<{ error: { message: string } | null }>, ok: string) => {
        setBusy(true); setMsg('');
        const { error } = await fn();
        setBusy(false);
        setMsg(error ? `실패: ${error.message}` : ok);
        if (!error) load();
    };

    const quote = (q: TokenRequest) => {
        const n = Number(qCount[q.id] ?? q.quoted_count ?? q.requested_count ?? 0);
        const p = Number(qPrice[q.id] ?? q.unit_price ?? defaultPrice(q.client_id));
        if (!n || n <= 0) return setMsg('통보할 건수를 입력하세요.');
        if (!p || p <= 0) return setMsg('단가를 입력하세요.');
        // 우리 계좌를 통보 시점 값 그대로 실어 보낸다(나중에 계좌가 바뀌어도 이 건은 그대로).
        void act(() => quoteChargeRequest(q.id, n, p, {
            bank: PAYMENT_INFO.bank, account: PAYMENT_INFO.account, holder: PAYMENT_INFO.holder,
        }), `${clientName(q.client_id)} ${n}건 · 공급가 ₩${won(n * p)} 통보 (계좌 전달)`);
    };

    const fulfill = (q: TokenRequest) => {
        const n = q.quoted_count ?? q.requested_count ?? 0;
        if (!n) return setMsg('발행할 건수가 없습니다. 먼저 금액을 통보하세요.');
        if (!window.confirm(`${clientName(q.client_id)} 에 ${n}건을 발행합니다.\n통장에서 입금(₩${won(totalOf(q.amount ?? 0))})을 확인하셨습니까?`)) return;
        void act(() => fulfillChargeRequest(q, n, `충전신청 ${n}건`), `${clientName(q.client_id)} +${n}건 발행 완료`);
    };

    // 신청과 무관한 수동 충전(서비스 지급·보정 등). 흐름을 안 타므로 별도로 남겨둔다.
    const charge = async () => {
        if (!pick) return setMsg('충전할 업체를 선택하세요.');
        const n = Number(count);
        if (!n || n <= 0) return setMsg('건수를 1 이상 입력하세요.');
        setBusy(true); setMsg('');
        const { error } = await grantTokens(pick, n, note);
        setBusy(false);
        if (error) return setMsg('충전 실패: ' + error.message);
        setMsg(`${clientName(pick)} +${n}건 (₩${won(n * unitPrice)}) 충전 완료`);
        setCount(''); setNote('');
        load();
    };

    return (
        <div className="grid gap-5">
            {/* ── 구매 처리 ───────────────────────────────────────────
                처리할 건이 있으면 테두리·배경으로 띄운다(알림 배너와 같은 주황).
                돈이 걸린 대기 건이 평범한 카드에 묻히면 며칠씩 방치된다. */}
            <div className={openCount
                ? 'rounded-xl border-2 border-[#fb923c] bg-[#fffbf7] p-5 shadow-[0_2px_12px_rgba(251,146,60,0.18)]'
                : 'rounded-xl border border-[#e2e8f0] p-5'}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                    {openCount ? <span className="text-[16px] leading-none">🔔</span> : null}
                    <div className="text-[15px] font-bold text-[#0f172a]">토큰 구매 처리</div>
                    {openCount ? (
                        <span className="rounded-full bg-[#c2410c] px-2 py-0.5 text-[12px] font-bold text-white">
                            {openCount}건 대기
                        </span>
                    ) : null}
                    <div className="inline-flex rounded-lg border border-[#e2e8f0] p-0.5">
                        {([['open', `처리 대기 ${open.length}`], ['all', `전체 ${reqs.length}`]] as const).map(([k, label]) => (
                            <button
                                className={`rounded-md px-3 py-1 text-xs font-bold ${scope === k ? 'bg-[#1e40af] text-white' : 'text-[#64748b] hover:text-[#334155]'}`}
                                key={k}
                                onClick={() => setScope(k)}
                                type="button"
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                        {/* 기본 단가 — 1건 = 1토큰. 여기서 바꾸면 이후 통보 화면의 초기값이 바뀐다.
                            이미 통보·발행된 건의 금액은 그대로다(행마다 저장돼 있다). */}
                        <span className={`text-[12px] font-semibold ${priceOk ? 'text-[#64748b]' : 'text-[#b91c1c]'}`}>
                            기본 단가{priceOk ? '' : ' ⚠'}
                        </span>
                        <input className="h-7 w-24 rounded border border-[#cbd5e1] px-2 text-[12px]" min={1} step={1000} type="number"
                            onChange={(e) => setPriceEdit(intOnly(e.target.value, MAX_UNIT_PRICE))} value={priceEdit} />
                        <span className="text-[12px] text-[#94a3b8]">원/건</span>
                        <button className="rounded-md border border-[#cbd5e1] px-2.5 py-1 text-xs font-semibold text-[#475569] hover:bg-[#f1f5f9] disabled:opacity-40"
                            disabled={busy || !Number(priceEdit) || Number(priceEdit) === unitPrice}
                            onClick={() => void act(() => setDefaultUnitPrice(Number(priceEdit)),
                                `기본 단가를 ₩${won(Number(priceEdit))} 으로 바꿨습니다 (이미 통보된 건은 그대로)`)}
                            type="button">
                            저장
                        </button>
                        <button className="rounded-md border border-[#cbd5e1] px-3 py-1 text-xs font-semibold text-[#475569]" onClick={load} type="button">
                            새로고침
                        </button>
                    </div>
                </div>
                {view.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-4 py-10 text-center text-sm text-[#94a3b8]">
                        {scope === 'open' ? '처리할 신청이 없습니다.' : '신청 내역이 없습니다.'}
                    </div>
                ) : (
                    <div className="grid gap-2">
                        {view.map((q) => {
                            const c = chip(q.status);
                            const n = q.quoted_count ?? q.requested_count ?? 0;
                            const price = qPrice[q.id] ?? String(q.unit_price ?? defaultPrice(q.client_id));
                            const cnt = qCount[q.id] ?? String(n || '');
                            const preview = Number(cnt) * Number(price) || 0;
                            return (
                                <div className={`rounded-lg px-3 py-2.5 text-[13px] ${
                                    q.status === 'done' || q.status === 'rejected'
                                        ? 'border border-[#e2e8f0] bg-white'
                                        : 'border border-[#fdba74] bg-white shadow-sm'
                                }`} key={q.id}>
                                    {/* 한 줄로 눕힌다 — 상태 뱃지가 이미 '입금 신고'·'발행 완료'를 말하고 있어
                                        같은 내용을 시각까지 붙여 또 적으면 줄만 길어진다. */}
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c.cls}`}>{c.label}</span>
                                        <span className="font-bold text-[#0f172a]">{clientName(q.client_id)}</span>
                                        {clientOf(q.client_id)?.is_agency ? (
                                            <span className="rounded bg-[#ede9fe] px-1.5 py-0.5 text-[10px] font-bold text-[#6d28d9]">대행사</span>
                                        ) : null}
                                        <span className="text-[#4338ca]">{q.quoted_count ?? q.requested_count ?? '-'}건</span>
                                        {q.pay_method ? <span className="text-[11px] text-[#64748b]">{q.pay_method}</span> : null}
                                        {q.amount != null ? (
                                            <span className="text-[#334155]">
                                                공급가 <b>₩{won(q.amount)}</b>
                                                <span className="text-[#94a3b8]"> + 부가세 ₩{won(vatOf(q.amount))}</span>
                                                {' '}= <b className="text-[#c2410c]">₩{won(totalOf(q.amount))}</b>
                                            </span>
                                        ) : null}
                                        {q.depositor ? <span className="text-[11px] text-[#94a3b8]">입금자 {q.depositor}</span> : null}
                                        <span className="ml-auto text-[11px] text-[#cbd5e1]">{dt(q.created_at)}</span>
                                    </div>

                                    {/* 조작 — 단계마다 누를 것이 하나만 보이게 한다.
                                        신청(pending) 이면 금액 통보, 입금 신고(paid) 면 토큰 발행.
                                        통보를 마친 건에는 '재통보'를 두지 않는다(사장님 지시 2026-08-20) —
                                        대행사가 그 금액을 보고 입금하는 중이라 금액이 바뀌면 입금액과 기록이 어긋난다. */}
                                    {q.status === 'pending' ? (
                                        <div className="mt-2 flex flex-wrap items-end gap-2">
                                            <div>
                                                <div className="mb-0.5 text-[11px] font-semibold text-[#64748b]">건수</div>
                                                <input
                                                    className="h-8 w-20 rounded border border-[#cbd5e1] px-2 text-[13px]"
                                                    min={1}
                                                    onChange={(e) => setQCount((m) => ({ ...m, [q.id]: intOnly(e.target.value, MAX_COUNT) }))}
                                                    type="number"
                                                    value={cnt}
                                                />
                                            </div>
                                            <div>
                                                <div className="mb-0.5 text-[11px] font-semibold text-[#64748b]">단가</div>
                                                <input
                                                    className="h-8 w-24 rounded border border-[#cbd5e1] px-2 text-[13px]"
                                                    min={0}
                                                    onChange={(e) => setQPrice((m) => ({ ...m, [q.id]: intOnly(e.target.value, MAX_UNIT_PRICE) }))}
                                                    step={1000}
                                                    type="number"
                                                    value={price}
                                                />
                                            </div>
                                            <div className="pb-1 text-[12px] text-[#475569]">
                                                공급가 <b>₩{won(preview)}</b> · 입금 <b className="text-[#c2410c]">₩{won(totalOf(preview))}</b>
                                                <span className="ml-2 text-[11px] text-[#94a3b8]">
                                                    {PAYMENT_INFO.bank} {PAYMENT_INFO.account} 전달
                                                </span>
                                            </div>
                                            <button
                                                className="h-8 rounded bg-[#1e40af] px-4 text-[12px] font-bold text-white hover:bg-[#1e3a8a] disabled:opacity-50"
                                                disabled={busy || !Number(cnt) || !Number(price)}
                                                onClick={() => quote(q)}
                                                type="button"
                                            >
                                                금액 통보
                                            </button>
                                        </div>
                                    ) : q.status === 'quoted' ? (
                                        <div className="mt-2 text-[12px] text-[#64748b]">
                                            금액을 통보했습니다 — 대행사의 입금 신고를 기다리는 중입니다.
                                        </div>
                                    ) : q.status === 'paid' ? (
                                        <div className="mt-2">
                                            <button
                                                className="h-8 rounded bg-[#059669] px-4 text-[12px] font-bold text-white hover:bg-[#047857] disabled:opacity-50"
                                                disabled={busy}
                                                onClick={() => fulfill(q)}
                                                title="통장에서 입금을 확인하셨다면 누르세요"
                                                type="button"
                                            >
                                                입금 확인 · 토큰 발행
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                )}
                {msg ? <p className="m-0 mt-3 text-[12px] text-[#475569]">{msg}</p> : null}
            </div>

            {/* ── 대행사 ↔ 하위 (읽기 전용) ─────────────────────────── */}
            <div className="rounded-xl border border-[#e2e8f0] p-5">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                    <div className="text-[15px] font-bold text-[#0f172a]">대행사 ↔ 하위 업체 거래</div>
                    <span className="rounded bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-bold text-[#64748b]">읽기 전용</span>
                </div>
                {subReqs.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-4 py-8 text-center text-sm text-[#94a3b8]">
                        아직 거래가 없습니다.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[720px] border-collapse text-[13px]">
                            <thead>
                                <tr className="border-b border-[#e2e8f0] text-left text-[#64748b]">
                                    {['일시', '대행사', '하위 업체', '상태', '건수', '단가', '공급가'].map((h) => (
                                        <th className="px-2 py-2 font-semibold" key={h}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {subReqs.slice(0, 30).map((r) => {
                                    const c = chip(r.status);
                                    return (
                                        <tr className="border-b border-[#f1f5f9] text-[#334155]" key={r.id}>
                                            <td className="whitespace-nowrap px-2 py-2">{dt(r.created_at)}</td>
                                            <td className="whitespace-nowrap px-2 py-2 font-semibold">{clientName(r.agency_client_id)}</td>
                                            <td className="whitespace-nowrap px-2 py-2">{clientName(r.child_client_id)}</td>
                                            <td className="whitespace-nowrap px-2 py-2">
                                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c.cls}`}>{c.label}</span>
                                            </td>
                                            <td className="px-2 py-2 font-bold">{r.quoted_count ?? r.requested_count ?? '-'}</td>
                                            <td className="px-2 py-2">{r.unit_price != null ? `\u20A9${won(r.unit_price)}` : '-'}</td>
                                            <td className="px-2 py-2 font-semibold">{r.amount != null ? `\u20A9${won(r.amount)}` : '-'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ── 수동 충전(신청과 무관 — 서비스 지급·보정) ─────────── */}
            <div className="rounded-xl border border-[#e2e8f0] p-5">
                <div className="mb-3 text-[15px] font-bold text-[#0f172a]">직접 충전 <span className="text-[12px] font-normal text-[#94a3b8]">(서비스 지급·보정)</span></div>
                <div className="grid gap-3 md:grid-cols-2">
                    <div>
                        <div className="mb-1 text-[12px] font-semibold text-[#64748b]">업체 선택</div>
                        <input className="mb-1.5 h-9 w-full rounded border border-[#cbd5e1] px-2 text-sm" onChange={(e) => setSearch(e.target.value)} placeholder="업체명 검색" value={search} />
                        <div className="flex flex-wrap gap-1.5">
                            {matches.map((c) => (
                                <button
                                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${pick === c.id ? 'border-[#1e40af] bg-[#1e40af] text-white' : 'border-[#cbd5e1] bg-white text-[#475569]'}`}
                                    key={c.id}
                                    onClick={() => setPick(c.id)}
                                    type="button"
                                >
                                    {c.company || '(이름없음)'}
                                </button>
                            ))}
                            {matches.length === 0 ? <span className="text-xs text-[#94a3b8]">일치 업체 없음</span> : null}
                        </div>
                        {pick ? (
                            <div className="mt-1.5 text-[12px] text-[#1e40af]">
                                선택: <b>{clientName(pick)}</b> · 현재 잔액 <b>{pickedBalance}건</b>
                            </div>
                        ) : null}
                    </div>
                    <div className="grid content-start gap-2">
                        <div>
                            <div className="mb-1 text-[12px] font-semibold text-[#64748b]">충전 건수</div>
                            <input className="h-9 w-full rounded border border-[#cbd5e1] px-2 text-sm" min={1} onChange={(e) => setCount(intOnly(e.target.value, MAX_COUNT))} placeholder="예: 30" type="number" value={count} />
                        </div>
                        <div>
                            <div className="mb-1 text-[12px] font-semibold text-[#64748b]">메모 (선택)</div>
                            <input className="h-9 w-full rounded border border-[#cbd5e1] px-2 text-sm" onChange={(e) => setNote(e.target.value)} placeholder="입금자명/일자 등" value={note} />
                        </div>
                        <button className="mt-1 h-10 rounded-md bg-[#059669] px-5 text-sm font-bold text-white hover:bg-[#047857] disabled:opacity-50" disabled={busy || !pick} onClick={() => void charge()} type="button">
                            {busy ? '충전 중…' : '충전'}
                        </button>
                    </div>
                </div>
            </div>

            {/* ── 원장 ──────────────────────────────────────────────── */}
            <div className="rounded-xl border border-[#e2e8f0] p-5">
                <div className="mb-3 text-[15px] font-bold text-[#0f172a]">토큰 충전·사용 내역 (전체)</div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse text-[13px]">
                        <thead>
                            <tr className="border-b border-[#e2e8f0] text-left text-[#64748b]">
                                {['일시', '업체', '구분', '건수', '메모'].map((h) => <th className="px-2 py-2 font-semibold" key={h}>{h}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 ? (
                                <tr><td className="px-2 py-8 text-center text-[#94a3b8]" colSpan={5}>내역이 없습니다.</td></tr>
                            ) : rows.map((r) => (
                                <tr className="border-b border-[#f1f5f9] text-[#334155]" key={r.id}>
                                    <td className="whitespace-nowrap px-2 py-2">{dt(r.created_at)}</td>
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
