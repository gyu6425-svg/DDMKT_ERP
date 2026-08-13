import { useEffect, useMemo, useState } from 'react';
import { listSignupHistory, type SignupHistoryRow } from '../api/signup';
import { supabase } from '../lib/supabase';
import { approveSignup, listPendingSignups, rejectSignup, type PendingSignup } from '../api/signup';
import { insertClient, upsertContractData, emptyContractData } from '../api/erp';
import { insertClientContracts } from '../api/clientContracts';

type ClientLite = { id: string; company: string | null; business_number: string | null; client_partner: string | null };

// ── 기존 업체 자동 매칭 ────────────────────────────────────────────────────
//   고객이 셀프가입하며 적은 업체명이 이미 계약관리에 있으면 새로 만들지 말고 그 업체에 붙인다.
//   (2026-08-12 실측 사고: '금융책사'가 이미 있는데 고객이 거래처명 '스마트비즈'로 가입 →
//    별도 업체가 생겨 계약 3건이 고객 화면에 안 보였다. 그래서 거래처명(client_partner)도 본다.)
const norm = (s: string | null | undefined) => (s || '').replace(/[\s()·.\-_]/g, '').toLowerCase();
const digits = (s: string | null | undefined) => (s || '').replace(/\D/g, '');

type Match = { client: ClientLite; reason: string; strong: boolean };

function findMatches(company: string | null, bizNo: string | null, clients: ClientLite[]): Match[] {
    const q = norm(company);
    const b = digits(bizNo);
    const out: Match[] = [];
    const seen = new Set<string>();
    const push = (client: ClientLite, reason: string, strong: boolean) => {
        if (seen.has(client.id)) return;
        seen.add(client.id);
        out.push({ client, reason, strong });
    };
    // 1) 사업자번호 완전 일치 — 가장 확실
    if (b.length >= 10) clients.forEach((c) => digits(c.business_number) === b && push(c, '사업자번호 일치', true));
    if (q) {
        // 2) 업체명 완전 일치
        clients.forEach((c) => norm(c.company) === q && push(c, '업체명 일치', true));
        // 3) 거래처명(대행사·상호) 완전 일치 — 고객이 거래처명으로 가입하는 경우
        clients.forEach((c) => norm(c.client_partner) === q && push(c, `거래처명 '${c.client_partner}' 일치`, true));
        // 4) 부분 포함 — 후보로만(자동 선택 안 함)
        clients.forEach((c) => {
            const cc = norm(c.company);
            const cp = norm(c.client_partner);
            if (cc && (cc.includes(q) || q.includes(cc))) push(c, '업체명 비슷함', false);
            else if (cp && (cp.includes(q) || q.includes(cp))) push(c, '거래처명 비슷함', false);
        });
    }
    return out;
}

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
            supabase.from('clients').select('id,company,business_number,client_partner').order('company'),
        ]).then(([pend, cl]) => {
            setRows(pend.data);
            if (pend.error) setMsg(pend.error);
            const list = ((cl.data as ClientLite[]) ?? []);
            setClients(list);
            // 검색어 기본값 = 가입 시 입력한 업체명.
            const s: Record<string, string> = {};
            pend.data.forEach((r) => (s[r.id] = r.signup_company || ''));
            setSearch(s);
            // 기존 업체 자동 연결 — 확실한 매칭(사업자번호·업체명·거래처명 완전일치)이 딱 하나면 미리 선택해 둔다.
            const p: Record<string, string> = {};
            pend.data.forEach((r) => {
                if (r.role !== 'viewer') return;
                const strong = findMatches(r.signup_company, r.signup_biz_no, list).filter((m) => m.strong);
                if (strong.length === 1) p[r.id] = strong[0].client.id;
            });
            setPick(p);
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
            // 중복 업체 방지 — 후보가 있는데도 신규로 만들려 하면 한 번 더 묻는다.
            //   여기서 새로 만들면 계약은 옛 업체에, 고객 화면은 새 업체에 붙어 '계약이 안 보이는' 사고가 난다.
            const cands = findMatches(r.signup_company, r.signup_biz_no, clients);
            if (cands.length) {
                const list = cands.slice(0, 5).map((m) => `· ${m.client.company} (${m.reason})`).join('\n');
                const go = window.confirm(
                    `계약관리에 비슷한 업체가 이미 있습니다:\n\n${list}\n\n`
                    + '그래도 새 업체로 만들까요?\n'
                    + '[취소]를 누르고 위 업체를 선택해 승인하면 기존 계약이 고객 화면에 그대로 보입니다.',
                );
                if (!go) { setBusy(null); return; }
            }
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
            // 고객 사이드바(client_contracts, sheet_approved)에도 카페 배포 등록 → '카페' 메뉴 노출.
            const { error: ccErr } = await insertClientContracts([{
                client_id: clientId, category: '카페', subtype: '카페 배포',
                goal_count: null, amount: null, sheet_approved: true,
                contract_date: new Date().toISOString().slice(0, 10),
            }]);
            if (ccErr) { setBusy(null); return setMsg('사이드바 등록 실패: ' + ccErr.message); }
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

    // 가입 내역 — 승인 대기(is_active=false)만 보면 카카오 온보딩 가입이 안 보인다.
    //   그쪽은 곧바로 활성이라 대기 목록에 안 잡히는데, 실제로는 계속 들어오고 있었다.
    const [hist, setHist] = useState<SignupHistoryRow[]>([]);
    const [histOpen, setHistOpen] = useState(true);
    // 구분 토글 — 대행사만 따로 보고 싶다는 요청(2026-08-13). 계약·단가가 달라 섞여 보면 고르기 어렵다.
    const [histKind, setHistKind] = useState<'all' | 'agency' | 'viewer' | 'reporter'>('all');
    useEffect(() => { void listSignupHistory().then(setHist); }, []);
    const histKindOf = (h: SignupHistoryRow) => (h.role === 'reporter' ? 'reporter' : h.is_agency ? 'agency' : 'viewer');
    const histView = histKind === 'all' ? hist : hist.filter((h) => histKindOf(h) === histKind);

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

                            {/* 자동 매칭 안내 — 기존 업체를 찾았으면 그 이유까지 보여 준다(중복 생성 방지) */}
                            {r.role === 'viewer' ? (() => {
                                const cands = findMatches(r.signup_company, r.signup_biz_no, clients);
                                if (!cands.length) return null;
                                const auto = cands.find((m) => m.client.id === pick[r.id]);
                                return (
                                    <div className={`mt-2 rounded-lg border px-3 py-2 text-[12px] ${auto ? 'border-[#86efac] bg-[#f0fdf4] text-[#15803d]' : 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]'}`}>
                                        {auto
                                            ? <>✅ 기존 업체 <b>{auto.client.company}</b> 로 자동 연결됩니다 <span className="font-normal opacity-70">({auto.reason})</span></>
                                            : <>⚠️ 비슷한 기존 업체가 있습니다 — 아래에서 선택하세요: {cands.slice(0, 3).map((m) => `${m.client.company}(${m.reason})`).join(' · ')}</>}
                                    </div>
                                );
                            })() : null}

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
                고객 계정: 가입 시 적은 <b>업체명·사업자번호</b>가 계약관리에 이미 있으면 <b>그 업체로 자동 연결</b>됩니다(업체명·사업자번호·<b>거래처명</b> 완전일치 1건일 때). 그대로 승인하면 기존 계약이 고객 화면에 바로 보입니다.
                <br />자동 연결이 안 됐고 비슷한 업체도 없으면 <b>신규 업체로 계약관리에 자동 등록</b>됩니다(상품 <b>카페 배포</b>, 건수·금액 비움). 후보가 있는데 신규로 만들려 하면 한 번 더 확인합니다 — 여기서 새로 만들면 계약은 옛 업체에, 고객 화면은 새 업체에 붙어 <b>계약이 안 보이는 사고</b>가 납니다. 기자단은 승인 후 블로그 관리 시트에서 담당 블로그를 배정하세요.
            </p>

            {/* 가입 내역 — 승인 대기가 늘 0건인 이유를 여기서 알 수 있다.
                카카오 온보딩 가입은 곧바로 활성(is_active=true)이라 대기 목록에 안 잡힌다. */}
            <div className="mt-6 rounded-xl border border-[#e2e8f0]">
                <button type="button" onClick={() => setHistOpen((v) => !v)}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-[#f8fafc]">
                    <span className={`text-[10px] text-[#94a3b8] transition-transform ${histOpen ? 'rotate-90' : ''}`}>▶</span>
                    <b className="text-[15px] text-[#111111]">가입 내역 {histView.length}건{histKind !== 'all' ? ` / 전체 ${hist.length}` : ''}</b>
                    <span className="text-[12px] text-[#94a3b8]">최근 가입한 고객·기자단 (승인 여부 포함)</span>
                    <span className="ml-auto rounded-full bg-[#fef3c7] px-2 py-0.5 text-[11px] font-bold text-[#92400e]">
                        대행사 {hist.filter((h) => h.is_agency).length}
                    </span>
                </button>
                {histOpen ? (
                    <>
                    {/* 구분 토글 — 대행사/고객/기자단을 나눠 본다. 개수는 실제 데이터에서 센다. */}
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-[#eef0f2] px-4 py-2">
                        {([['all', '전체'], ['agency', '대행사'], ['viewer', '고객'], ['reporter', '기자단']] as const).map(([k, label]) => {
                            const n = k === 'all' ? hist.length : hist.filter((h) => histKindOf(h) === k).length;
                            const on = histKind === k;
                            return (
                                <button key={k} type="button" onClick={() => setHistKind(k)}
                                    className={`rounded-full border px-3 py-1 text-[12px] font-bold ${on
                                        ? 'border-[#1e40af] bg-[#1e40af] text-white' : 'border-[#cbd5e1] bg-white text-[#475569] hover:bg-[#f1f5f9]'}`}>
                                    {label} <span className={on ? 'opacity-80' : 'text-[#94a3b8]'}>{n}</span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="overflow-x-auto border-t border-[#eef0f2]">
                        <table className="w-full min-w-[820px] border-collapse text-left text-[13px]">
                            <thead>
                                <tr className="border-b border-[#f1f5f9] bg-[#f8fafc] text-[11px] text-[#64748b]">
                                    {['가입일', '이름', '신청 업체', '구분', '연락처', '이메일', '상태'].map((h) => (
                                        <th className="px-3 py-2 font-semibold" key={h}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {histView.map((h) => (
                                    <tr className="border-b border-[#f8fafc] text-[#334155]" key={h.id}>
                                        <td className="whitespace-nowrap px-3 py-2 text-[12px] text-[#64748b]">{h.created_at.slice(0, 16).replace('T', ' ')}</td>
                                        <td className="whitespace-nowrap px-3 py-2 font-semibold">{h.name || '-'}</td>
                                        <td className="whitespace-nowrap px-3 py-2">{h.signup_company || '-'}</td>
                                        <td className="whitespace-nowrap px-3 py-2">
                                            {h.role === 'reporter'
                                                ? <span className="rounded-full bg-[#ede9fe] px-2 py-0.5 text-[11px] font-bold text-[#6d28d9]">기자단</span>
                                                : h.is_agency
                                                    ? <span className="rounded-full bg-[#fef3c7] px-2 py-0.5 text-[11px] font-bold text-[#92400e]">대행사</span>
                                                    : <span className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-[11px] font-bold text-[#1d4ed8]">고객</span>}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 text-[12px]">{h.phone || '-'}</td>
                                        <td className="whitespace-nowrap px-3 py-2 text-[12px] text-[#64748b]">{h.email || '-'}</td>
                                        <td className="whitespace-nowrap px-3 py-2">
                                            {h.is_active
                                                ? <span className="text-[11px] font-bold text-[#15803d]">활성{h.client_id ? ' · 업체 연결됨' : ' · 업체 미연결'}</span>
                                                : <span className="text-[11px] font-bold text-[#b45309]">승인 대기</span>}
                                        </td>
                                    </tr>
                                ))}
                                {histView.length === 0 ? (
                                    <tr><td className="px-3 py-8 text-center text-[#94a3b8]" colSpan={7}>가입 내역이 없습니다.</td></tr>
                                ) : null}
                            </tbody>
                        </table>
                    </div>
                    </>
                ) : null}
            </div>

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
    // 업체명뿐 아니라 거래처명(client_partner)으로도 찾는다 — 고객이 거래처명으로 가입하는 경우가 있다.
    const matches = useMemo(() => {
        const q = norm(search);
        const list = q ? clients.filter((c) => norm(c.company).includes(q) || norm(c.client_partner).includes(q)) : clients;
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
                        {c.client_partner && norm(c.client_partner) !== norm(c.company)
                            ? <span className="ml-1 font-normal opacity-60">/ {c.client_partner}</span> : null}
                    </button>
                ))}
                {matches.length === 0 ? (
                    <span className="text-xs text-[#94a3b8]">일치하는 업체가 없습니다.</span>
                ) : null}
            </div>
            {selectedClient ? (
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[#1e40af]">
                    선택됨: <b>{selectedClient.company}</b>
                    <button type="button" onClick={() => onSelect('')}
                        className="rounded border border-[#cbd5e1] bg-white px-1.5 py-0.5 font-semibold text-[#64748b] hover:bg-[#f1f5f9]">
                        선택 해제(신규로 등록)
                    </button>
                </div>
            ) : null}
        </div>
    );
}
