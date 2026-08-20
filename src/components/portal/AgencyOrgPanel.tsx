import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
    getMyOrg, agencyPendingSignups, agencyChildren, agencyApproveSignup, agencyReleaseSignup,
    agencyTransferTokens, agencyTransfers,
    listSubRequests, agencyQuoteRequest, agencyFulfillRequest, agencyRejectRequest,
    type MyOrg, type AgencyPendingSignup, type AgencyChild, type AgencyTransfer, type SubTokenRequest,
} from '../../api/orgs';
import { listTokens, balanceOf, won, vatOf, totalOf, intOnly, MAX_COUNT, MAX_UNIT_PRICE } from '../../api/cafeTokens';

// 고객 포털 '조직 관리' — 대행사 콘솔.
//   대행사가 자기 조직만 다룬다: 하위 가입 승인 · 하위 업체 현황 · 토큰 배분 · 초대 코드.
//   ★ 승인·배분은 전부 SECURITY DEFINER 함수(docs/agency-console.sql)로만 나간다.
//     테이블 쓰기 정책은 열지 않았다 — 열면 남의 업체를 만들거나 자기 토큰을 늘릴 수 있다.
//   ※ 하위 업체가 대행사에 넣는 접수는 대행사가 자기 시스템에서 관리한다(우리는 관여하지 않음).

const fmtDate = (s: string | null) => (s ? s.slice(0, 10) : '-');
// 하위 → 대행사 충전 신청 상태. 우리↔대행사 화면과 같은 4단계다.
const REQ_STATUS: Record<string, { label: string; cls: string }> = {
    pending:  { label: '신청',      cls: 'bg-[#fef9c3] text-[#854d0e]' },
    quoted:   { label: '금액 통보', cls: 'bg-[#dbeafe] text-[#1d4ed8]' },
    paid:     { label: '입금 신고', cls: 'bg-[#ffedd5] text-[#c2410c]' },
    done:     { label: '발행 완료', cls: 'bg-[#dcfce7] text-[#166534]' },
    rejected: { label: '반려',      cls: 'bg-[#fee2e2] text-[#b91c1c]' },
};
const fmtDT = (s: string | null) => (s ? new Date(s).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '');
// 발행 직전 확인 — 내 잔액에서 빠진다는 사실을 반드시 보여준다(되돌릴 수 없다).
const CONFIRM_MSG = (child: string, n: number, amount: number, bal: number) =>
    [`${child} 에 ${n}건을 발행합니다.`,
     `입금(\u20A9${won(totalOf(amount))})을 확인하셨습니까?`,
     '',
     `내 잔여 토큰 ${bal}건에서 ${n}건이 빠집니다.`].join('\n');

export default function AgencyOrgPanel() {
    const { profile } = useAuth();
    // 내부 미리보기(?as=업체)는 조회만 된다 — 승인·배분 함수는 로그인한 본인 기준으로 동작한다.
    const asParam = new URLSearchParams(window.location.search).get('as') || '';
    const clientId = asParam || profile?.client_id || '';

    const [org, setOrg] = useState<MyOrg>({ me: null, children: [], invites: [] });
    const [pending, setPending] = useState<AgencyPendingSignup[]>([]);
    const [kids, setKids] = useState<AgencyChild[]>([]);
    const [transfers, setTransfers] = useState<AgencyTransfer[]>([]);
    const [subReqs, setSubReqs] = useState<SubTokenRequest[]>([]);
    const [quote, setQuote] = useState<Record<string, { count: string; price: string }>>({});
    // 입금 계좌 — 하위 업체에게 금액과 함께 전달된다. 마지막에 쓴 값을 다음 건에 채워 준다.
    const [acct, setAcct] = useState({ bank: '', account: '', holder: '' });
    const [balance, setBalance] = useState(0);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [copied, setCopied] = useState('');
    // 행별 입력값
    const [nameEdit, setNameEdit] = useState<Record<string, string>>({});
    const [give, setGive] = useState<Record<string, { count: string; price: string }>>({});

    const load = useCallback(() => {
        if (!clientId) { setLoading(false); return; }
        setLoading(true);
        void Promise.all([
            getMyOrg(clientId), agencyPendingSignups(), agencyChildren(),
            listTokens(clientId), agencyTransfers(clientId), listSubRequests({ agencyId: clientId }),
        ]).then(([o, p, c, t, tr, sr]) => {
            setOrg(o.data);
            setPending(p.data);
            setKids(c.data);
            setBalance(balanceOf(t.data, clientId));
            setTransfers(tr.data);
            setSubReqs(sr.data);
            // 이전 통보에 쓴 계좌를 그대로 채워 둔다 — 매번 다시 적지 않게.
            const last = sr.data.find((r) => r.pay_account);
            if (last) setAcct({ bank: last.pay_bank || '', account: last.pay_account || '', holder: last.pay_holder || '' });
            setErr(o.error || p.error?.message || c.error?.message || '');
            setLoading(false);
        });
    }, [clientId]);
    useEffect(load, [load]);

    const run = async (key: string, fn: () => Promise<{ error: { message: string } | null }>, ok: string) => {
        setBusy(key); setMsg(''); setErr('');
        const { error } = await fn();
        setBusy(null);
        if (error) return setErr(error.message);
        setMsg(ok);
        load();
    };

    const copy = (code: string) => {
        void navigator.clipboard?.writeText(code);
        setCopied(code);
        window.setTimeout(() => setCopied(''), 1500);
    };

    if (loading) return <div className="py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>;

    if (!org.me?.is_agency) {
        return (
            <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-14 text-center text-sm text-[#64748b]">
                대행사 계정에서만 볼 수 있는 화면입니다.
                {err ? <div className="mt-2 text-[#dc2626]">{err}</div> : null}
            </div>
        );
    }

    const live = org.invites.filter((i) => i.active);
    // 하위도 없고 대기 신청도 없는데 코드가 쓰인 적은 있다 = 권한 미설정이거나 그 업체가 이미 정리된 것.
    const usedAny = org.invites.some((i) => i.used_count > 0);
    const openReqs = subReqs.filter((r) => r.status !== 'done' && r.status !== 'rejected');
    const childName = (id: string) => kids.find((k) => k.client_id === id)?.company || '-';

    return (
        <section className="grid gap-5">
            <header className="flex flex-wrap items-center gap-2">
                <h2 className="m-0 text-[20px] font-bold text-[#0f172a]">조직 관리</h2>
                <span className="rounded-full bg-[#ede9fe] px-2 py-0.5 text-[11px] font-bold text-[#6d28d9]">대행사</span>
                <span className="text-[13px] text-[#94a3b8]">{org.me.company}</span>
                <button className="ml-auto rounded-md border border-[#cbd5e1] px-3 py-1 text-xs font-semibold text-[#475569]" onClick={load} type="button">
                    새로고침
                </button>
            </header>

            {/* 요약 */}
            <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">
                <div className="rounded-xl border border-[#e2e8f0] p-4">
                    <div className="text-[12px] font-semibold text-[#64748b]">하위 업체</div>
                    <div className="mt-1 text-[26px] font-bold text-[#0f172a]">{kids.length}<span className="ml-1 text-[15px] font-semibold text-[#94a3b8]">곳</span></div>
                </div>
                <div className="rounded-xl border border-[#e2e8f0] p-4">
                    <div className="text-[12px] font-semibold text-[#64748b]">배분 가능 토큰</div>
                    <div className="mt-1 text-[26px] font-bold text-[#1e40af]">{balance}<span className="ml-1 text-[15px] font-semibold text-[#94a3b8]">건</span></div>
                </div>
                <div className={`rounded-xl border p-4 ${pending.length ? 'border-[#fdba74] bg-[#fff7ed]' : 'border-[#e2e8f0]'}`}>
                    <div className="text-[12px] font-semibold text-[#64748b]">가입 승인 대기</div>
                    <div className={`mt-1 text-[26px] font-bold ${pending.length ? 'text-[#c2410c]' : 'text-[#0f172a]'}`}>
                        {pending.length}<span className="ml-1 text-[15px] font-semibold text-[#94a3b8]">건</span>
                    </div>
                </div>
                <div className={`rounded-xl border p-4 ${openReqs.length ? 'border-[#fdba74] bg-[#fff7ed]' : 'border-[#e2e8f0]'}`}>
                    <div className="text-[12px] font-semibold text-[#64748b]">충전 신청 대기</div>
                    <div className={`mt-1 text-[26px] font-bold ${openReqs.length ? 'text-[#c2410c]' : 'text-[#0f172a]'}`}>
                        {openReqs.length}<span className="ml-1 text-[15px] font-semibold text-[#94a3b8]">건</span>
                    </div>
                </div>
            </div>

            {msg ? <p className="m-0 rounded-lg bg-[#f0fdf4] px-4 py-2 text-[13px] font-semibold text-[#15803d]">{msg}</p> : null}
            {err ? <p className="m-0 rounded-lg bg-[#fef2f2] px-4 py-2 text-[13px] font-semibold text-[#b91c1c]">{err}</p> : null}

            {/* ── 가입 승인 대기 ─────────────────────────────────── */}
            <div className="rounded-xl border border-[#e2e8f0]">
                <div className="border-b border-[#e2e8f0] px-4 py-3">
                    <div className="text-[14px] font-bold text-[#0f172a]">
                        가입 승인 대기 <span className="text-[#c2410c]">{pending.length}</span>
                    </div>
                    <p className="m-0 mt-1 text-[12px] leading-5 text-[#64748b]">
                        내 초대 코드로 가입한 업체입니다. 승인하면 <b>바로 이용할 수 있게 되고 아래 하위 업체 목록에 들어갑니다.</b>
                        {' '}내 업체가 아니면 반려해 주세요(계정은 삭제되지 않고 든든한마케팅 확인 대기로 넘어갑니다).
                    </p>
                </div>
                {pending.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[13px] text-[#94a3b8]">대기 중인 가입 신청이 없습니다.</div>
                ) : (
                    <div className="grid gap-2 p-3">
                        {pending.map((s) => (
                            <div className="rounded-lg border border-[#fed7aa] bg-[#fffbf7] px-3 py-2.5" key={s.profile_id}>
                                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                                    <b className="text-[#0f172a]">{s.company || s.name || '(업체명 없음)'}</b>
                                    <span className="text-[#64748b]">{s.email}</span>
                                    {s.phone ? <span className="text-[#94a3b8]">· {s.phone}</span> : null}
                                    {s.biz_no ? <span className="text-[#94a3b8]">· 사업자 {s.biz_no}</span> : null}
                                    <span className="ml-auto text-[11px] text-[#cbd5e1]">{fmtDT(s.created_at)} · {s.invite_code}</span>
                                </div>
                                <div className="mt-2 flex flex-wrap items-end gap-2">
                                    <div>
                                        <div className="mb-0.5 text-[11px] font-semibold text-[#64748b]">등록할 업체명</div>
                                        <input
                                            className="h-8 w-56 rounded border border-[#cbd5e1] px-2 text-[13px]"
                                            onChange={(e) => setNameEdit((m) => ({ ...m, [s.profile_id]: e.target.value }))}
                                            value={nameEdit[s.profile_id] ?? s.company ?? s.name ?? ''}
                                        />
                                    </div>
                                    <button
                                        className="h-8 rounded bg-[#059669] px-4 text-[12px] font-bold text-white hover:bg-[#047857] disabled:opacity-50"
                                        disabled={busy !== null}
                                        onClick={() => void run(s.profile_id,
                                            () => agencyApproveSignup(s.profile_id, nameEdit[s.profile_id] ?? s.company ?? undefined),
                                            `${nameEdit[s.profile_id] ?? s.company ?? '업체'} 승인 완료 — 하위 업체로 등록되었습니다`)}
                                        type="button"
                                    >
                                        {busy === s.profile_id ? '처리 중…' : '승인'}
                                    </button>
                                    <button
                                        className="h-8 rounded border border-[#cbd5e1] px-3 text-[12px] font-semibold text-[#64748b] disabled:opacity-50"
                                        disabled={busy !== null}
                                        onClick={() => {
                                            if (!window.confirm('내 하위 업체가 아니라고 반려할까요?\n계정은 삭제되지 않고 든든한마케팅 확인 대기로 넘어갑니다.')) return;
                                            void run(s.profile_id, () => agencyReleaseSignup(s.profile_id), '반려했습니다');
                                        }}
                                        type="button"
                                    >
                                        내 업체 아님
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── 하위 충전 신청 처리 ────────────────────────────── */}
            <div className="rounded-xl border border-[#e2e8f0]">
                <div className="border-b border-[#e2e8f0] px-4 py-3">
                    <div className="text-[14px] font-bold text-[#0f172a]">
                        하위 충전 신청 <span className="text-[#c2410c]">{openReqs.length}</span>
                        <span className="ml-1 text-[12px] font-normal text-[#94a3b8]">/ 전체 {subReqs.length}</span>
                    </div>
                    {/* 입금 계좌 — 금액 통보 시 하위 업체에게 함께 전달된다. */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-[12px] font-semibold text-[#475569]">입금 계좌</span>
                        <input className="h-8 w-28 rounded border border-[#cbd5e1] px-2 text-[12px]"
                            onChange={(e) => setAcct((a) => ({ ...a, bank: e.target.value }))}
                            placeholder="은행" value={acct.bank} />
                        <input className="h-8 w-48 rounded border border-[#cbd5e1] px-2 text-[12px]"
                            onChange={(e) => setAcct((a) => ({ ...a, account: e.target.value }))}
                            placeholder="계좌번호" value={acct.account} />
                        <input className="h-8 w-28 rounded border border-[#cbd5e1] px-2 text-[12px]"
                            onChange={(e) => setAcct((a) => ({ ...a, holder: e.target.value }))}
                            placeholder="예금주" value={acct.holder} />
                        <span className="text-[11px] text-[#94a3b8]">금액 통보 시 함께 전달됩니다</span>
                    </div>
                </div>
                {subReqs.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[13px] text-[#94a3b8]">받은 충전 신청이 없습니다.</div>
                ) : (
                    <div className="grid gap-2 p-3">
                        {subReqs.slice(0, 20).map((r) => {
                            const st = REQ_STATUS[r.status] ?? { label: r.status, cls: 'bg-[#f1f5f9] text-[#64748b]' };
                            const n = r.quoted_count ?? r.requested_count ?? 0;
                            const q = quote[r.id] ?? { count: String(n || ''), price: String(r.unit_price ?? '') };
                            const supply = (Number(q.count) || 0) * (Number(q.price) || 0);
                            const closed = r.status === 'done' || r.status === 'rejected';
                            return (
                                <div className="rounded-lg border border-[#e2e8f0] px-3 py-2 text-[13px]" key={r.id}>
                                    {/* 한 줄로 눕힌다 — 항목마다 줄을 나누면 건수가 늘수록 세로로 길어져 한눈에 안 들어온다.
                                        좁은 화면에서는 flex-wrap 이 알아서 접는다. */}
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                                        <b className="text-[#0f172a]">{childName(r.child_client_id)}</b>
                                        <span className="text-[#4338ca]">{n ? `${n}건` : '건수 미지정'}</span>
                                        {r.pay_method ? <span className="text-[11px] text-[#64748b]">{r.pay_method}</span> : null}
                                        {r.amount != null ? (
                                            <span className="text-[#334155]">
                                                공급가 <b>₩{won(r.amount)}</b>
                                                <span className="text-[#94a3b8]"> + 부가세 ₩{won(vatOf(r.amount))}</span>
                                                {' '}= <b className="text-[#c2410c]">₩{won(totalOf(r.amount))}</b>
                                            </span>
                                        ) : null}
                                        {r.pay_account ? (
                                            <span className="text-[11px] text-[#94a3b8]">{r.pay_bank} {r.pay_account} ({r.pay_holder})</span>
                                        ) : null}
                                        {r.depositor ? <span className="text-[11px] text-[#94a3b8]">입금자 {r.depositor}</span> : null}
                                        {r.note ? <span className="text-[11px] text-[#94a3b8]">{r.note}</span> : null}
                                        <span className="ml-auto text-[11px] text-[#cbd5e1]">{fmtDT(r.created_at)}</span>
                                    </div>

                                    {closed ? null : (
                                        <div className="mt-2 flex flex-wrap items-end gap-2">
                                            <div>
                                                <div className="mb-0.5 text-[11px] font-semibold text-[#64748b]">건수</div>
                                                <input className="h-8 w-20 rounded border border-[#cbd5e1] px-2 text-[13px]" min={1} type="number"
                                                    onChange={(e) => setQuote((m) => ({ ...m, [r.id]: { ...q, count: intOnly(e.target.value, MAX_COUNT) } }))} value={q.count} />
                                            </div>
                                            <div>
                                                <div className="mb-0.5 text-[11px] font-semibold text-[#64748b]">판매 단가</div>
                                                <input className="h-8 w-24 rounded border border-[#cbd5e1] px-2 text-[13px]" min={0} step={1000} type="number"
                                                    onChange={(e) => setQuote((m) => ({ ...m, [r.id]: { ...q, price: intOnly(e.target.value, MAX_UNIT_PRICE) } }))} value={q.price} />
                                            </div>
                                            {supply > 0 ? (
                                                <div className="pb-1 text-[12px] text-[#475569]">
                                                    공급가 <b>₩{won(supply)}</b> · 입금 <b className="text-[#c2410c]">₩{won(totalOf(supply))}</b>
                                                </div>
                                            ) : null}
                                            <button className="h-8 rounded bg-[#1e40af] px-3 text-[12px] font-bold text-white hover:bg-[#1e3a8a] disabled:opacity-50"
                                                disabled={busy !== null || !Number(q.count) || !Number(q.price)
                                                    || !acct.bank.trim() || !acct.account.trim() || !acct.holder.trim()}
                                                onClick={() => void run(r.id, () => agencyQuoteRequest(r.id, Number(q.count), Number(q.price), acct),
                                                    `${childName(r.child_client_id)} 에 ${q.count}건 · 공급가 \u20A9${won(supply)} 통보 (계좌 전달)`)}
                                                title={acct.account.trim() ? '금액과 입금 계좌를 함께 보냅니다' : '아래 입금 계좌를 먼저 입력하세요'}
                                                type="button">
                                                {r.status === 'pending' ? '금액 통보' : '금액 재통보'}
                                            </button>
                                            <button className="h-8 rounded bg-[#059669] px-3 text-[12px] font-bold text-white hover:bg-[#047857] disabled:opacity-50"
                                                disabled={busy !== null || r.status !== 'paid'}
                                                title={r.status === 'paid' ? '입금을 확인하셨다면 발행합니다' : '하위 업체의 입금 신고 후에 활성화됩니다'}
                                                onClick={() => {
                                                    if (!window.confirm(CONFIRM_MSG(childName(r.child_client_id), n, r.amount ?? 0, balance))) return;
                                                    void run(r.id, () => agencyFulfillRequest(r.id), `${childName(r.child_client_id)} 에 ${n}건 발행 완료`);
                                                }}
                                                type="button">
                                                입금 확인 · 토큰 발행
                                            </button>
                                            <button className="h-8 rounded border border-[#cbd5e1] px-2 text-[12px] font-semibold text-[#64748b] disabled:opacity-50"
                                                disabled={busy !== null}
                                                onClick={() => void run(r.id, () => agencyRejectRequest(r.id), '반려했습니다')}
                                                type="button">
                                                반려
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── 하위 업체 + 토큰 배분 ──────────────────────────── */}
            <div className="rounded-xl border border-[#e2e8f0]">
                <div className="border-b border-[#e2e8f0] px-4 py-3">
                    <div className="text-[14px] font-bold text-[#0f172a]">하위 업체 <span className="text-[#94a3b8]">{kids.length}</span></div>
                    <p className="m-0 mt-1 text-[12px] leading-5 text-[#64748b]">
                        보유 토큰에서 하위 업체로 배분합니다. <b>판매 단가는 필수</b>이고, 금액은 부가세 별도로 기록됩니다.
                    </p>
                </div>
                {kids.length === 0 ? (
                    <div className="px-4 py-10 text-center text-[13px] leading-6 text-[#94a3b8]">
                        {pending.length
                            ? '위 가입 신청을 승인하면 여기에 들어옵니다.'
                            : usedAny
                              ? '아직 하위 업체가 없습니다. 이전에 등록된 업체가 정리되었을 수 있습니다.'
                              : '아직 하위 업체가 없습니다. 아래 초대 코드를 전달해 가입시켜 주세요.'}
                    </div>
                ) : (
                    <div className="grid gap-2 p-3">
                        {kids.map((k) => {
                            const g = give[k.client_id] ?? { count: '', price: '' };
                            const supply = (Number(g.count) || 0) * (Number(g.price) || 0);
                            return (
                                <div className="rounded-lg border border-[#e2e8f0] px-3 py-2.5" key={k.client_id}>
                                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                                        <b className="text-[#0f172a]">{k.company}</b>
                                        <span className="text-[#64748b]">{k.status || '-'}</span>
                                        <span className="text-[11px] text-[#cbd5e1]">등록 {fmtDate(k.created_at)}</span>
                                        <span className="ml-auto rounded bg-[#eff6ff] px-2 py-0.5 text-[12px] font-bold text-[#1e40af]">
                                            잔여 {k.balance}건
                                        </span>
                                        <span className="text-[11px] text-[#94a3b8]">받음 {k.granted} · 사용 {k.used}</span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap items-end gap-2">
                                        <div>
                                            <div className="mb-0.5 text-[11px] font-semibold text-[#64748b]">배분 건수</div>
                                            <input
                                                className="h-8 w-20 rounded border border-[#cbd5e1] px-2 text-[13px]"
                                                min={1}
                                                onChange={(e) => setGive((m) => ({ ...m, [k.client_id]: { ...g, count: intOnly(e.target.value, MAX_COUNT) } }))}
                                                type="number"
                                                value={g.count}
                                            />
                                        </div>
                                        <div>
                                            <div className="mb-0.5 text-[11px] font-semibold text-[#64748b]">판매 단가</div>
                                            <input
                                                className="h-8 w-24 rounded border border-[#cbd5e1] px-2 text-[13px]"
                                                min={0}
                                                onChange={(e) => setGive((m) => ({ ...m, [k.client_id]: { ...g, price: intOnly(e.target.value, MAX_UNIT_PRICE) } }))}
                                                step={1000}
                                                type="number"
                                                value={g.price}
                                            />
                                        </div>
                                        {supply > 0 ? (
                                            <div className="pb-1 text-[12px] text-[#475569]">
                                                공급가 <b>₩{won(supply)}</b>
                                                <span className="text-[#94a3b8]"> + VAT ₩{won(vatOf(supply))}</span>
                                                {' '}= <b className="text-[#c2410c]">₩{won(totalOf(supply))}</b>
                                            </div>
                                        ) : null}
                                        <button
                                            className="h-8 rounded bg-[#4338ca] px-4 text-[12px] font-bold text-white hover:bg-[#3730a3] disabled:opacity-50"
                                            disabled={busy !== null || !Number(g.count) || !Number(g.price)}
                                            onClick={() => void run(k.client_id,
                                                () => agencyTransferTokens(k.client_id, Number(g.count), Number(g.price)),
                                                `${k.company} 에 ${g.count}건 배분 완료`)}
                                            type="button"
                                        >
                                            {busy === k.client_id ? '배분 중…' : '토큰 배분'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── 배분 내역 ──────────────────────────────────────── */}
            {transfers.length ? (
                <div className="rounded-xl border border-[#e2e8f0] p-4">
                    <div className="mb-2 text-[14px] font-bold text-[#0f172a]">배분 내역</div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[520px] border-collapse text-[13px]">
                            <thead>
                                <tr className="text-left text-[12px] text-[#64748b]">
                                    {['일시', '업체', '건수', '단가', '공급가'].map((h) => <th className="px-2 py-2 font-semibold" key={h}>{h}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {transfers.map((t) => (
                                    <tr className="border-t border-[#f1f5f9]" key={t.id}>
                                        <td className="whitespace-nowrap px-2 py-2 text-[#64748b]">{fmtDT(t.created_at)}</td>
                                        <td className="px-2 py-2 font-semibold text-[#0f172a]">
                                            {kids.find((k) => k.client_id === t.child_client_id)?.company || '-'}
                                        </td>
                                        <td className="px-2 py-2 font-bold text-[#4338ca]">{t.count}건</td>
                                        <td className="px-2 py-2 text-[#475569]">₩{won(t.unit_price)}</td>
                                        <td className="px-2 py-2 font-semibold text-[#0f172a]">₩{won(t.amount)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : null}

            {/* ── 초대 코드 ──────────────────────────────────────── */}
            <div className="rounded-xl border border-[#e2e8f0] p-4">
                <div className="mb-1 text-[14px] font-bold text-[#0f172a]">초대 코드</div>
                <p className="m-0 mb-3 text-[13px] leading-6 text-[#64748b]">
                    하위 업체가 회원가입 화면의 <b>초대 코드</b> 칸에 이 코드를 넣으면, 위 <b>가입 승인 대기</b>에 나타납니다.
                    {' '}코드 발급·폐기가 필요하시면 담당자에게 요청해 주세요.
                </p>
                {live.length ? (
                    <div className="flex flex-wrap gap-2">
                        {live.map((i) => (
                            <button
                                className="inline-flex items-center gap-2 rounded-lg border border-[#a7f3d0] bg-[#ecfdf5] px-3 py-1.5 text-[13px] font-bold text-[#065f46] hover:bg-[#d1fae5]"
                                key={i.code}
                                onClick={() => copy(i.code)}
                                title="클릭하면 복사됩니다"
                                type="button"
                            >
                                {i.code}
                                <span className="font-normal opacity-70">{i.used_count}{i.max_uses ? `/${i.max_uses}` : ''}회 사용</span>
                                <span className="text-[11px] font-semibold text-[#059669]">{copied === i.code ? '복사됨' : '복사'}</span>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="rounded-lg border border-dashed border-[#cbd5e1] px-4 py-6 text-center text-[13px] text-[#94a3b8]">
                        발급된 코드가 없습니다. 담당자에게 요청해 주세요.
                    </div>
                )}
            </div>
        </section>
    );
}
