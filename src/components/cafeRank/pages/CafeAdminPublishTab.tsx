import { useEffect, useState } from 'react';
import { getCafeAccounts, type CafeAccount } from '../../../api/cafeAccounts';
import { listTokens, balanceOf } from '../../../api/cafeTokens';
import { getPendingGenRequests } from '../../../api/cafeGenRequests';
import { getClients } from '../../../api/erp';
import { CafeCustomerStudio } from '../../cafe/CafeCustomerStudio';

// 카페 자동화 발행(관리자) — 접수 승인 후 토큰이 발행된 고객사를 골라 '우리가' 대신 발행한다.
//   고객사 목록 = publish_enabled 된 카페 계정. 각 업체의 잔여 토큰 표시. 선택 시 그 업체 발행 스튜디오 노출.
export function CafeAdminPublishTab() {
    const [accts, setAccts] = useState<CafeAccount[]>([]);
    // client_id → { company, parent } — 그룹(부모: 더업스) + 업체명 표시용.
    const [clientInfo, setClientInfo] = useState<Record<string, { company: string; parent: string | null }>>({});
    const [balById, setBalById] = useState<Record<string, number>>({}); // client_id → 잔여 토큰(원장)
    const [reservedById, setReservedById] = useState<Record<string, number>>({}); // client_id → 예약(발행요청 미완료) 건수 = 즉시 차감분
    // 선택 고객 client_id — 세팅해두면 유지(새로고침·재방문에도). localStorage 지속.
    const [sel, setSelState] = useState<string | null>(() => localStorage.getItem('cafeAdminPubSel'));
    const setSel = (id: string | null) => {
        setSelState(id);
        if (id) localStorage.setItem('cafeAdminPubSel', id); else localStorage.removeItem('cafeAdminPubSel');
    };
    const [loading, setLoading] = useState(true);

    const reload = () => {
        void getCafeAccounts().then(async ({ data }) => {
            // 발행 승인(토큰 발행)된 업체만. client_id 기준 중복 제거.
            const enabled = data.filter((a) => a.client_id && a.publish_enabled);
            const seen = new Set<string>();
            const uniq = enabled.filter((a) => (seen.has(a.client_id!) ? false : (seen.add(a.client_id!), true)));
            // client_id → 그 client 의 모든 company_key(고정업체 발행요청은 company 로 매칭).
            const keysByClient = new Map<string, Set<string>>();
            for (const a of data) if (a.client_id && a.company_key) {
                (keysByClient.get(a.client_id) ?? keysByClient.set(a.client_id, new Set()).get(a.client_id)!).add(a.company_key);
            }
            const bals: Record<string, number> = {};
            for (const a of uniq) {
                const { data: t } = await listTokens(a.client_id!);
                bals[a.client_id!] = balanceOf(t);
            }
            // 예약(발행요청 미완료) 건수 = 즉시 차감 — client_id 매칭(신규) 또는 company 매칭(고정).
            const pending = await getPendingGenRequests();
            const reserved: Record<string, number> = {};
            for (const a of uniq) {
                const cid = a.client_id!;
                const keys = keysByClient.get(cid) ?? new Set<string>();
                reserved[cid] = pending.filter((p) => p.client_id === cid || keys.has(p.company)).length;
            }
            setAccts(uniq);
            setBalById(bals);
            setReservedById(reserved);
            setLoading(false);
        });
        // 클라이언트 회사명·상위그룹(parent_company) — 발행 선택에 "더업스 › 방문요양" 표시용.
        void getClients().then(({ data }) => {
            const m: Record<string, { company: string; parent: string | null }> = {};
            for (const c of data) m[c.id] = { company: c.company || '', parent: (c as { parent_company?: string | null }).parent_company ?? null };
            setClientInfo(m);
        });
    };
    useEffect(() => {
        reload();
        const iv = setInterval(reload, 8000); // 발행요청하면 8초 내 잔여 토큰 즉시 반영
        return () => clearInterval(iv);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // '발행하러 가기'로 넘어온 경우 URL의 client 를 선택(마지막 선택 localStorage 보다 우선).
    useEffect(() => {
        const q = new URLSearchParams(window.location.search).get('client');
        if (q) setSel(q);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (loading) {
        return <div className="rounded-xl border border-[#e2e8f0] bg-white px-6 py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>;
    }
    if (!accts.length) {
        return (
            <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-16 text-center">
                <div className="text-base font-semibold text-[#475569]">발행할 고객사가 없습니다</div>
                <p className="mx-auto mt-2 max-w-md text-sm text-[#94a3b8]">
                    카페 접수 관리에서 <b>승인 → 토큰 발행</b> 하면 그 고객사가 여기에 나타납니다.
                </p>
            </div>
        );
    }

    return (
        <div className="grid gap-4">
            {/* 고객사 선택 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-2 flex items-center gap-2">
                    <div className="text-[14px] font-bold text-[#0f172a]">발행할 고객사 선택</div>
                    <button type="button" onClick={reload} className="ml-auto rounded-md border border-[#cbd5e1] px-2.5 py-1 text-xs font-semibold text-[#475569] hover:bg-[#f1f5f9]">새로고침</button>
                </div>
                {(() => {
                    // 상위 그룹(parent_company: 더업스)으로 묶어 표시 — "더업스 › 방문요양 / 순댓국 …"으로 카페 구별.
                    const byParent = new Map<string, CafeAccount[]>();
                    for (const a of accts) {
                        const parent = clientInfo[a.client_id!]?.parent || '';
                        (byParent.get(parent) ?? byParent.set(parent, []).get(parent)!).push(a);
                    }
                    // 그룹 있는 것 먼저(이름순), 단독(그룹 없음)은 마지막.
                    const groups = [...byParent.entries()].sort((x, y) => (x[0] ? 0 : 1) - (y[0] ? 0 : 1) || x[0].localeCompare(y[0]));
                    const btn = (a: CafeAccount, showBiz: boolean) => {
                        const reserved = reservedById[a.client_id!] ?? 0;   // 발행요청 미완료 = 즉시 차감
                        const bal = Math.max(0, (balById[a.client_id!] ?? 0) - reserved);
                        const active = sel === a.client_id;
                        const bizName = clientInfo[a.client_id!]?.company || a.display_name || a.company_key;
                        return (
                            <button key={a.id} type="button" onClick={() => setSel(a.client_id!)}
                                className={`min-w-[160px] rounded-lg border px-3 py-2 text-left text-sm ${active ? 'border-[#7c3aed] bg-[#f5f3ff]' : 'border-[#e2e8f0] bg-white hover:bg-[#f8fafc]'}`}>
                                <div className={`font-bold ${active ? 'text-[#6d28d9]' : 'text-[#334155]'}`}>{showBiz ? bizName : (a.display_name || bizName)}</div>
                                {a.display_name && a.display_name !== bizName ? <div className="truncate text-[11px] text-[#94a3b8]" title={a.display_name}>{a.display_name}</div> : null}
                                <div className={`text-[12px] ${bal > 0 ? 'text-[#059669]' : 'text-[#dc2626]'}`}>잔여 토큰 {bal}건{reserved ? <span className="text-[#b45309]"> · 발행중 {reserved}</span> : null}</div>
                            </button>
                        );
                    };
                    return (
                        <div className="grid gap-3">
                            {groups.map(([parent, list]) => (
                                <div key={parent || '_none'}>
                                    {parent ? (
                                        <div className="mb-1.5 text-[12px] font-bold text-[#6d28d9]">🏢 {parent} <span className="font-normal text-[#94a3b8]">— 카페 {list.length}개</span></div>
                                    ) : null}
                                    <div className="flex flex-wrap gap-2">
                                        {list.map((a) => btn(a, !!parent))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    );
                })()}
            </div>

            {/* 선택 고객사 발행 스튜디오 — key=client 로 업체 전환 시 전체 remount(이전 업체 값·키워드·계정 누출 방지) */}
            {sel ? (
                <CafeCustomerStudio key={sel} clientId={sel} />
            ) : (
                <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-12 text-center text-sm text-[#94a3b8]">
                    위에서 발행할 고객사를 선택하세요.
                </div>
            )}
        </div>
    );
}
