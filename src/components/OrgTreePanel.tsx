import { useEffect, useMemo, useState } from 'react';
import {
    createInvite,
    listInvites,
    listOrgClients,
    setClientAgency,
    setClientParent,
    setInviteActive,
    type AgencyInvite,
    type OrgNode,
} from '../api/orgs';

// 조직 관리 — 든든한마케팅(우리) → 대행사 → 하위 업체 2단 트리.
//   대행사는 발행하지 않는다(순수 중개). 하위 업체가 각자 자기 카페로 발행하고,
//   그 접수를 우리와 그 대행사만 본다. 계층의 근거는 clients.parent_client_id 뿐이다.
//   ※ 선불/후불 배지 — 지금은 선불제만 운영한다(후불은 나중). 자리는 만들어 두되 전부 '선불'.

const PILL = 'rounded-full px-2 py-0.5 text-[11px] font-bold';
const BTN = 'rounded-md border border-[#cbd5e1] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]';
const alpha = (i: number) => String.fromCharCode(97 + (i % 26));   // a, b, c …

export default function OrgTreePanel() {
    const [rows, setRows] = useState<OrgNode[]>([]);
    const [ready, setReady] = useState(true);      // parent_client_id 컬럼 적용 여부
    const [err, setErr] = useState('');
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState('');
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [busy, setBusy] = useState('');
    const [msg, setMsg] = useState('');
    const [invites, setInvites] = useState<AgencyInvite[]>([]);
    const [pickFor, setPickFor] = useState<string | null>(null);   // 소속 지정 중인 업체 id

    const reload = async () => {
        setLoading(true);
        const [{ data, ready: ok, error }, inv] = await Promise.all([listOrgClients(), listInvites()]);
        setRows(data);
        setReady(ok);
        setErr(error || '');
        setInvites(inv.error ? [] : inv.data);
        setLoading(false);
    };
    useEffect(() => { void reload(); }, []);

    const agencies = useMemo(() => rows.filter((r) => r.is_agency), [rows]);
    const childrenOf = useMemo(() => {
        const m = new Map<string, OrgNode[]>();
        for (const r of rows) {
            if (!r.parent_client_id) continue;
            (m.get(r.parent_client_id) ?? m.set(r.parent_client_id, []).get(r.parent_client_id)!).push(r);
        }
        for (const list of m.values()) list.sort((a, b) => a.company.localeCompare(b.company));
        return m;
    }, [rows]);
    // 직거래 = 대행사도 아니고 소속도 없는 업체. 트리 루트에 쏟아지면 못 쓰므로 접어 둔다.
    const direct = useMemo(
        () => rows.filter((r) => !r.is_agency && !r.parent_client_id),
        [rows],
    );
    const invitesOf = (id: string) => invites.filter((i) => i.agency_client_id === id);

    const s = q.trim().toLowerCase();
    const hit = (r: OrgNode) => !s || (r.company || '').toLowerCase().includes(s);
    // 검색 — 대행사명이 맞으면 하위 전체를, 하위가 맞으면 그 대행사를 남긴다(트리가 끊기지 않게).
    const shownAgencies = useMemo(
        () => agencies.filter((a) => hit(a) || (childrenOf.get(a.id) ?? []).some(hit)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [agencies, childrenOf, s],
    );
    const shownDirect = useMemo(() => direct.filter(hit), [direct, s]); // eslint-disable-line react-hooks/exhaustive-deps

    const act = async (key: string, fn: () => Promise<{ error: unknown }>, done: string) => {
        if (busy) return;
        setBusy(key); setMsg('');
        const { error } = await fn();
        setBusy('');
        if (error) { setMsg('실패: ' + ((error as { message?: string }).message || '알 수 없는 오류')); return; }
        setMsg(done);
        await reload();
    };

    const badge = () => <span className={`${PILL} bg-[#fef3c7] text-[#92400e]`}>선불</span>;

    const row = (r: OrgNode, depth: number, order?: number) => {
        const kids = childrenOf.get(r.id) ?? [];
        const isOpen = open[r.id] ?? true;
        return (
            <div key={r.id}>
                <div
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[#f8fafc]"
                    style={{ paddingLeft: 8 + depth * 20 }}
                >
                    {r.is_agency ? (
                        <button
                            className={`w-4 text-[10px] text-[#94a3b8] transition-transform ${isOpen ? 'rotate-90' : ''} ${kids.length ? '' : 'opacity-30'}`}
                            disabled={!kids.length}
                            onClick={() => setOpen((o) => ({ ...o, [r.id]: !isOpen }))}
                            type="button"
                        >
                            ▶
                        </button>
                    ) : (
                        <span className="w-4" />
                    )}
                    {order != null ? <span className="text-[12px] text-[#94a3b8]">{alpha(order)}.</span> : null}
                    <span className={`text-[13px] ${r.is_agency ? 'font-bold text-[#0f172a]' : 'font-semibold text-[#334155]'}`}>
                        {r.company || '(이름 없음)'}
                    </span>
                    {r.is_agency ? <span className={`${PILL} bg-[#ede9fe] text-[#6d28d9]`}>대행사</span> : null}
                    {badge()}
                    {r.is_agency && kids.length ? (
                        <span className="text-[11px] text-[#94a3b8]">하위 {kids.length}</span>
                    ) : null}

                    <div className="ml-auto flex items-center gap-1">
                        {r.is_agency ? (
                            <>
                                <button
                                    className={BTN}
                                    disabled={!!busy}
                                    onClick={() => void act(`inv:${r.id}`, () => createInvite(r.id), '초대 코드를 발급했습니다')}
                                    title="이 대행사의 초대 코드 발급 — 가입 화면에 넣으면 이 대행사 하위로 붙습니다"
                                    type="button"
                                >
                                    + 초대 코드
                                </button>
                                {kids.length === 0 ? (
                                    <button
                                        className={BTN}
                                        disabled={!!busy}
                                        onClick={() => void act(`ag:${r.id}`, () => setClientAgency(r.id, false), '대행사 해제됨')}
                                        type="button"
                                    >
                                        대행사 해제
                                    </button>
                                ) : null}
                            </>
                        ) : r.parent_client_id ? (
                            <button
                                className={BTN}
                                disabled={!!busy || !ready}
                                onClick={() => void act(`p:${r.id}`, () => setClientParent(r.id, null), '직거래로 전환했습니다')}
                                title="소속 해제 — 삭제가 아니라 직거래 전환입니다(계약·토큰 그대로)"
                                type="button"
                            >
                                소속 해제
                            </button>
                        ) : (
                            <>
                                <button
                                    className={BTN}
                                    disabled={!!busy || !ready}
                                    onClick={() => setPickFor(pickFor === r.id ? null : r.id)}
                                    type="button"
                                >
                                    소속 지정
                                </button>
                                <button
                                    className={BTN}
                                    disabled={!!busy}
                                    onClick={() => void act(`ag:${r.id}`, () => setClientAgency(r.id, true), '대행사로 전환했습니다')}
                                    type="button"
                                >
                                    대행사로
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* 소속 지정 — 대행사 고르기 */}
                {pickFor === r.id ? (
                    <div className="ml-8 mb-1 flex flex-wrap items-center gap-1.5 rounded-md border border-[#c7d2fe] bg-[#eef2ff] px-2 py-1.5">
                        <span className="text-[11px] font-semibold text-[#3730a3]">어느 대행사 밑으로?</span>
                        {agencies.length === 0 ? (
                            <span className="text-[11px] text-[#64748b]">대행사가 없습니다 — 먼저 '대행사로' 전환하세요</span>
                        ) : agencies.map((a) => (
                            <button
                                className="rounded border border-[#c7d2fe] bg-white px-2 py-0.5 text-[11px] font-bold text-[#4338ca] hover:bg-[#f5f3ff]"
                                key={a.id}
                                onClick={() => { setPickFor(null); void act(`p:${r.id}`, () => setClientParent(r.id, a.id), `${a.company} 하위로 넣었습니다`); }}
                                type="button"
                            >
                                {a.company}
                            </button>
                        ))}
                    </div>
                ) : null}

                {/* 초대 코드 목록 */}
                {r.is_agency && invitesOf(r.id).length ? (
                    <div className="ml-8 mb-1 flex flex-wrap items-center gap-1.5">
                        {invitesOf(r.id).map((i) => (
                            <span
                                className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] ${
                                    i.active ? 'border-[#a7f3d0] bg-[#ecfdf5] text-[#065f46]' : 'border-[#e2e8f0] bg-[#f8fafc] text-[#94a3b8] line-through'
                                }`}
                                key={i.code}
                            >
                                {i.code}
                                <span className="opacity-60">{i.used_count}회</span>
                                {i.active ? (
                                    <button
                                        className="font-sans text-[10px] font-bold text-[#94a3b8] hover:text-[#dc2626]"
                                        onClick={() => void act(`iv:${i.code}`, () => setInviteActive(i.code, false), '코드를 폐기했습니다')}
                                        title="폐기 — 이미 이 코드로 들어온 업체는 그대로 유지됩니다"
                                        type="button"
                                    >
                                        폐기
                                    </button>
                                ) : null}
                            </span>
                        ))}
                    </div>
                ) : null}

                {r.is_agency && isOpen
                    ? kids.filter(hit).map((k, i) => row(k, depth + 1, i))
                    : null}
            </div>
        );
    };

    if (loading) return <div className="px-6 py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>;

    return (
        <div className="grid gap-3">
            {!ready ? (
                <div className="rounded-md border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-[12px] text-[#92400e]">
                    <b>조직 계층이 아직 DB에 없습니다.</b> Supabase SQL Editor에서{' '}
                    <code className="rounded bg-white px-1">docs/agency-org-phase1.sql</code> 을 실행하세요.
                    지금은 업체 목록만 평평하게 보이고 소속 지정은 막혀 있습니다.
                </div>
            ) : null}
            {err ? <div className="rounded-md bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]">{err}</div> : null}
            {msg ? <div className="rounded-md bg-[#f0fdf4] px-3 py-2 text-[13px] font-semibold text-[#166534]">{msg}</div> : null}

            <div className="flex flex-wrap items-center gap-2">
                <input
                    className="h-9 w-[260px] rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="조직명 검색"
                    value={q}
                />
                <span className="text-xs text-[#64748b]">
                    대행사 {agencies.length} · 소속 업체 {rows.filter((r) => r.parent_client_id).length} · 직거래 {direct.length}
                </span>
                <button className={`${BTN} ml-auto`} onClick={() => void reload()} type="button">새로고침</button>
            </div>

            <div className="rounded-md border border-[#e2e8f0] bg-white p-2">
                {/* 최상위 = 우리. clients 행이 아니라 고정 표시다. */}
                <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
                    <span className="w-4 text-[10px] text-[#94a3b8]">▼</span>
                    <span className="text-[14px] font-extrabold text-[#0f172a]">든든한마케팅</span>
                    <span className={`${PILL} bg-[#e0f2fe] text-[#075985]`}>본사</span>
                </div>

                {shownAgencies.length === 0 && shownDirect.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-[#94a3b8]">
                        {rows.length ? '검색 결과가 없습니다' : '업체가 없습니다'}
                    </div>
                ) : null}

                {shownAgencies.map((a) => row(a, 1))}

                {shownDirect.length ? (
                    <div className="mt-2 border-t border-dashed border-[#e2e8f0] pt-2">
                        <button
                            className="flex items-center gap-2 px-2 py-1 text-[12px] font-semibold text-[#64748b]"
                            onClick={() => setOpen((o) => ({ ...o, __direct: !(o.__direct ?? false) }))}
                            type="button"
                        >
                            <span className={`text-[10px] transition-transform ${open.__direct ? 'rotate-90' : ''}`}>▶</span>
                            직거래 업체 {shownDirect.length}
                            <span className="font-normal text-[#94a3b8]">— 대행사 소속이 아닌 기존 업체</span>
                        </button>
                        {open.__direct ? shownDirect.map((d) => row(d, 1)) : null}
                    </div>
                ) : null}
            </div>

            <p className="m-0 text-[11px] text-[#94a3b8]">
                든든한마케팅 → 대행사 → 하위 업체 <b className="text-[#64748b]">2단</b> 구조입니다.
                대행사는 발행하지 않고, 하위 업체가 각자 자기 카페로 발행합니다.
                소속 해제는 삭제가 아니라 <b className="text-[#64748b]">직거래 전환</b>이라 계약·토큰이 그대로 남습니다.
            </p>
        </div>
    );
}
