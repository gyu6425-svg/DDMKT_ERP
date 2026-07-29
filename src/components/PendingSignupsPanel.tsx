import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { approveSignup, listPendingSignups, rejectSignup, type PendingSignup } from '../api/signup';
import { insertClient, upsertContractData, emptyContractData } from '../api/erp';

type ClientLite = { id: string; company: string | null; business_number: string | null };

// 어드민 — 회원가입 승인 대기 목록. 고객(viewer)은 기존 업체와 연결해 승인, 기자단(reporter)은 바로 승인.
export default function PendingSignupsPanel() {
    const [rows, setRows] = useState<PendingSignup[]>([]);
    const [clients, setClients] = useState<ClientLite[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [msg, setMsg] = useState('');
    // 고객 승인 시 선택한 업체(client_id) + 검색어(행별).
    const [pick, setPick] = useState<Record<string, string>>({});
    const [search, setSearch] = useState<Record<string, string>>({});

    const load = () => {
        setLoading(true);
        void Promise.all([
            listPendingSignups(),
            supabase.from('clients').select('id,company,business_number').order('company'),
        ]).then(([pend, cl]) => {
            setRows(pend.data);
            if (pend.error) setMsg(pend.error);
            setClients(((cl.data as ClientLite[]) ?? []));
            // 검색어 기본값 = 가입 시 입력한 업체명.
            const s: Record<string, string> = {};
            pend.data.forEach((r) => (s[r.id] = r.signup_company || ''));
            setSearch(s);
            setLoading(false);
        });
    };
    useEffect(load, []);

    const roleLabel = (r: PendingSignup) => (r.role === 'reporter' ? '기자단' : '고객');

    const approve = async (r: PendingSignup) => {
        setMsg('');
        setBusy(r.id);
        let clientId = r.role === 'viewer' ? pick[r.id] : undefined;
        // 고객인데 연결 업체 미선택 = 신규 업체 → 계약관리에 자동 등록(카페 배포, 건수·금액 비움) 후 그 업체로 승인.
        if (r.role === 'viewer' && !clientId) {
            const { data, error } = await insertClient({
                company: r.signup_company || r.name || '(미입력)',
                business_number: r.signup_biz_no || null,
                email: r.email || null,
                phone: r.phone || null,
                product: '카페 배포',
                status: '계약완료',   // 계약관리 '상품/매출' 탭에 보이려면 계약완료
                source: '셀프가입',
            });
            const newClient = data?.[0];
            if (error || !newClient) { setBusy(null); return setMsg('업체 생성 실패: ' + (error?.message || '')); }
            clientId = newClient.id;
            // 카페 배포 상품 태그 — 건수·금액은 비움(나중에 담당자가 계약관리에서 입력).
            const cd = emptyContractData(clientId);
            cd.contract_products = [{ type: '카페 배포', unit_price: 0, quantity: 0, unit_outsource: 0, done: 0 }];
            const { error: cdErr } = await upsertContractData(cd);
            if (cdErr) { setBusy(null); return setMsg('상품 태그 실패: ' + cdErr.message); }
        }
        const { ok, error } = await approveSignup(r.id, clientId);
        setBusy(null);
        if (!ok) return setMsg('승인 실패: ' + (error || ''));
        setRows((prev) => prev.filter((x) => x.id !== r.id));
    };
    const reject = async (r: PendingSignup) => {
        if (!confirm(`${r.name || r.email} 가입을 거절(삭제)할까요?`)) return;
        setBusy(r.id);
        const { ok, error } = await rejectSignup(r.id);
        setBusy(null);
        if (!ok) return setMsg('거절 실패: ' + (error || ''));
        setRows((prev) => prev.filter((x) => x.id !== r.id));
    };

    return (
        <div>
            <div className="mb-3 flex items-center justify-between">
                <h3 className="m-0 text-[18px] font-bold text-[#111111]">가입 승인 대기 ({rows.length})</h3>
                <button
                    className="rounded-md border border-[#cbd5e1] px-3 py-1 text-sm font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                    onClick={load}
                    type="button"
                >
                    새로고침
                </button>
            </div>
            {msg ? <p className="mb-3 text-sm text-[#dc2626]">{msg}</p> : null}

            {loading ? (
                <div className="py-12 text-center text-sm text-[#94a3b8]">불러오는 중…</div>
            ) : rows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-5 py-10 text-center text-sm text-[#94a3b8]">
                    승인 대기 중인 가입 신청이 없습니다.
                </div>
            ) : (
                <div className="grid gap-3">
                    {rows.map((r) => (
                        <div className="rounded-xl border border-[#e2e8f0] p-4" key={r.id}>
                            <div className="flex flex-wrap items-center gap-2">
                                <span
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                                        r.role === 'reporter'
                                            ? 'bg-[#ede9fe] text-[#6d28d9]'
                                            : 'bg-[#dbeafe] text-[#1d4ed8]'
                                    }`}
                                >
                                    {roleLabel(r)}
                                </span>
                                <span className="text-sm font-bold text-[#0f172a]">{r.name || '이름 없음'}</span>
                                <span className="text-xs text-[#64748b]">{r.email}</span>
                                {r.phone ? <span className="text-xs text-[#94a3b8]">· {r.phone}</span> : null}
                            </div>
                            {r.role === 'viewer' ? (
                                <div className="mt-1 text-xs text-[#475569]">
                                    신청 업체: <b>{r.signup_company || '-'}</b>
                                    {r.signup_biz_no ? ` · 사업자 ${r.signup_biz_no}` : ''}
                                </div>
                            ) : (
                                <div className="mt-1 text-xs text-[#94a3b8]">
                                    승인 후 블로그 관리 시트에서 담당 블로그를 배정하세요.
                                </div>
                            )}

                            {/* 고객: 연결할 업체 선택 */}
                            {r.role === 'viewer' ? (
                                <ClientPicker
                                    clients={clients}
                                    search={search[r.id] ?? ''}
                                    selected={pick[r.id] ?? ''}
                                    onSearch={(v) => setSearch((s) => ({ ...s, [r.id]: v }))}
                                    onSelect={(id) => setPick((p) => ({ ...p, [r.id]: id }))}
                                />
                            ) : null}

                            <div className="mt-3 flex gap-2">
                                <button
                                    className="rounded-md bg-[#1e40af] px-4 py-1.5 text-sm font-bold text-white hover:bg-[#1e3a8a] disabled:opacity-50"
                                    disabled={busy !== null}
                                    onClick={() => void approve(r)}
                                    type="button"
                                >
                                    {busy === r.id ? '처리 중…' : (r.role === 'viewer' ? (pick[r.id] ? '기존 업체로 승인' : '신규 업체 등록 & 승인') : '승인')}
                                </button>
                                <button
                                    className="rounded-md border border-[#fca5a5] px-3 py-1.5 text-sm font-semibold text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-50"
                                    disabled={busy !== null}
                                    onClick={() => void reject(r)}
                                    type="button"
                                >
                                    거절
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <p className="mt-4 mb-0 text-[12px] leading-6 text-[#94a3b8]">
                고객 계정: <b>업체를 선택하지 않고 승인</b>하면 신규 업체로 <b>계약관리에 자동 등록</b>됩니다(상품 <b>카페 배포</b>, 건수·금액은 비움 → 나중에 계약관리에서 입력). 이미 있는 업체면 검색해서 선택 후 승인하세요. 기자단은 승인 후 블로그 관리 시트에서 담당 블로그를 배정하면 됩니다.
            </p>
        </div>
    );
}

// 업체 검색·선택 — 가입 업체명으로 필터, 목록에서 선택.
function ClientPicker({
    clients,
    search,
    selected,
    onSearch,
    onSelect,
}: {
    clients: ClientLite[];
    search: string;
    selected: string;
    onSearch: (v: string) => void;
    onSelect: (id: string) => void;
}) {
    const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
    const matches = useMemo(() => {
        const q = norm(search);
        const list = q ? clients.filter((c) => norm(c.company || '').includes(q)) : clients;
        return list.slice(0, 8);
    }, [clients, search]);
    const selectedClient = clients.find((c) => c.id === selected);

    return (
        <div className="mt-2 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-2">
            <div className="mb-1 text-[11px] font-semibold text-[#64748b]">연결할 업체 <span className="font-normal text-[#94a3b8]">(선택 안 하면 신규 업체로 등록)</span></div>
            <input
                className="mb-1.5 h-8 w-full rounded border border-[#cbd5e1] bg-white px-2 text-sm"
                onChange={(e) => onSearch(e.target.value)}
                placeholder="업체명 검색"
                value={search}
            />
            <div className="flex flex-wrap gap-1.5">
                {matches.map((c) => (
                    <button
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            selected === c.id
                                ? 'border-[#1e40af] bg-[#1e40af] text-white'
                                : 'border-[#cbd5e1] bg-white text-[#475569]'
                        }`}
                        key={c.id}
                        onClick={() => onSelect(c.id)}
                        type="button"
                    >
                        {c.company || '(이름 없음)'}
                    </button>
                ))}
                {matches.length === 0 ? (
                    <span className="text-xs text-[#94a3b8]">일치하는 업체가 없습니다.</span>
                ) : null}
            </div>
            {selectedClient ? (
                <div className="mt-1.5 text-[11px] text-[#1e40af]">
                    선택됨: <b>{selectedClient.company}</b>
                </div>
            ) : null}
        </div>
    );
}
