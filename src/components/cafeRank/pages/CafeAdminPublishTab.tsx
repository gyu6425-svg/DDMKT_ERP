import { useEffect, useState } from 'react';
import { getCafeAccounts, type CafeAccount } from '../../../api/cafeAccounts';
import { listTokens, balanceOf } from '../../../api/cafeTokens';
import { CafeCustomerStudio } from '../../cafe/CafeCustomerStudio';

// 카페 자동화 발행(관리자) — 접수 승인 후 토큰이 발행된 고객사를 골라 '우리가' 대신 발행한다.
//   고객사 목록 = publish_enabled 된 카페 계정. 각 업체의 잔여 토큰 표시. 선택 시 그 업체 발행 스튜디오 노출.
export function CafeAdminPublishTab() {
    const [accts, setAccts] = useState<CafeAccount[]>([]);
    const [balById, setBalById] = useState<Record<string, number>>({}); // client_id → 잔여 토큰
    // 선택 고객 client_id — 세팅해두면 유지(새로고침·재방문에도). localStorage 지속.
    const [sel, setSelState] = useState<string | null>(() => localStorage.getItem('cafeAdminPubSel'));
    const setSel = (id: string | null) => {
        setSelState(id);
        if (id) localStorage.setItem('cafeAdminPubSel', id); else localStorage.removeItem('cafeAdminPubSel');
    };
    const [loading, setLoading] = useState(true);

    const reload = () => {
        setLoading(true);
        void getCafeAccounts().then(async ({ data }) => {
            // 발행 승인(토큰 발행)된 업체만. client_id 기준 중복 제거.
            const enabled = data.filter((a) => a.client_id && a.publish_enabled);
            const seen = new Set<string>();
            const uniq = enabled.filter((a) => (seen.has(a.client_id!) ? false : (seen.add(a.client_id!), true)));
            const bals: Record<string, number> = {};
            for (const a of uniq) {
                const { data: t } = await listTokens(a.client_id!);
                bals[a.client_id!] = balanceOf(t);
            }
            setAccts(uniq);
            setBalById(bals);
            setLoading(false);
        });
    };
    useEffect(reload, []);

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
                <div className="flex flex-wrap gap-2">
                    {accts.map((a) => {
                        const bal = balById[a.client_id!] ?? 0;
                        const active = sel === a.client_id;
                        return (
                            <button key={a.id} type="button" onClick={() => setSel(a.client_id!)}
                                className={`rounded-lg border px-3 py-2 text-left text-sm ${active ? 'border-[#7c3aed] bg-[#f5f3ff]' : 'border-[#e2e8f0] bg-white hover:bg-[#f8fafc]'}`}>
                                <div className={`font-bold ${active ? 'text-[#6d28d9]' : 'text-[#334155]'}`}>{a.display_name || a.company_key}</div>
                                <div className={`text-[12px] ${bal > 0 ? 'text-[#059669]' : 'text-[#dc2626]'}`}>잔여 토큰 {bal}건</div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* 선택 고객사 발행 스튜디오 */}
            {sel ? (
                <CafeCustomerStudio clientId={sel} />
            ) : (
                <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-12 text-center text-sm text-[#94a3b8]">
                    위에서 발행할 고객사를 선택하세요.
                </div>
            )}
        </div>
    );
}
