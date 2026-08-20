import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { agencyChildren, agencyTransfers, type AgencyChild, type AgencyTransfer } from '../../api/orgs';
import { listChargeRequests, won } from '../../api/cafeTokens';

// 대행사 '계약 관리' — 하부 업체별 계약 목록.
//   ★ 여기 금액은 대행사 관점이다.
//     우리에게 산 것 = 매입(-), 하부에 판 것 = 그 업체와의 계약 금액(+).
//     기존 고객 대시보드의 '매출(공급가)' 카드는 우리 매출이라 대행사 화면에 그대로 두면
//     자기 매출로 오해한다 — 그래서 매입(-)으로 바꿔 단다.

const progColor = (p: number) => (p >= 70 ? '#059669' : p >= 40 ? '#d97706' : '#dc2626');

export default function AgencyContracts() {
    const { profile } = useAuth();
    const asParam = new URLSearchParams(window.location.search).get('as') || '';
    const clientId = asParam || profile?.client_id || '';

    const [kids, setKids] = useState<AgencyChild[]>([]);
    const [transfers, setTransfers] = useState<AgencyTransfer[]>([]);
    const [buys, setBuys] = useState({ count: 0, amount: 0 });
    const [q, setQ] = useState('');
    const [loading, setLoading] = useState(true);

    const load = useCallback(() => {
        if (!clientId) { setLoading(false); return; }
        setLoading(true);
        void Promise.all([agencyChildren(), agencyTransfers(clientId), listChargeRequests(clientId)])
            .then(([c, tr, buy]) => {
                setKids(c.data);
                setTransfers(tr.data);
                const done = buy.data.filter((r) => r.status === 'done');
                setBuys({
                    count: done.reduce((a, r) => a + (r.granted_count ?? r.quoted_count ?? 0), 0),
                    amount: done.reduce((a, r) => a + (r.amount ?? 0), 0),
                });
                setLoading(false);
            });
    }, [clientId]);
    useEffect(load, [load]);

    // 하부 업체별 계약 = 그 업체에 넘긴 건수·금액 + 토큰 현황.
    const rows = useMemo(() => {
        const byChild = new Map<string, { count: number; amount: number; last: string | null }>();
        transfers.forEach((t) => {
            const d = byChild.get(t.child_client_id) ?? { count: 0, amount: 0, last: null };
            d.count += t.count || 0;
            d.amount += t.amount || 0;
            if (!d.last || t.created_at > d.last) d.last = t.created_at;
            byChild.set(t.child_client_id, d);
        });
        const list = kids.map((k) => {
            const d = byChild.get(k.client_id) ?? { count: 0, amount: 0, last: null };
            const goal = d.count || k.granted;   // 계약 건수 = 넘긴 건수
            return {
                ...k,
                goal,
                amount: d.amount,
                unit: d.count ? Math.round(d.amount / d.count) : 0,
                last: d.last,
                prog: goal ? Math.min(100, Math.round((k.used / goal) * 100)) : null,
            };
        });
        const s = q.trim().toLowerCase();
        return s ? list.filter((r) => (r.company || '').toLowerCase().includes(s)) : list;
    }, [kids, transfers, q]);

    const soldAmount = transfers.reduce((a, t) => a + (t.amount || 0), 0);

    if (loading) return <div className="py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>;

    return (
        <div className="grid gap-4">
            {/* 요약 — 우리에게 산 것은 매입(-), 하부에 판 것은 계약 합계(+) */}
            <div className="grid grid-cols-3 gap-3 max-[700px]:grid-cols-1">
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="text-[12px] text-[#64748b]">매입 <span className="text-[#94a3b8]">든든한마케팅</span></div>
                    <div className="mt-0.5 text-2xl font-bold text-[#b91c1c]">-{won(buys.amount)}원</div>
                    <div className="mt-0.5 text-[11px] text-[#94a3b8]">{buys.count}건 · 공급가</div>
                </div>
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="text-[12px] text-[#64748b]">하부 계약</div>
                    <div className="mt-0.5 text-2xl font-bold text-[#1e40af]">{rows.length}<span className="ml-1 text-[15px] text-[#94a3b8]">곳</span></div>
                    <div className="mt-0.5 text-[11px] text-[#94a3b8]">합계 {won(soldAmount)}원 · 공급가</div>
                </div>
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="text-[12px] text-[#64748b]">발행</div>
                    <div className="mt-0.5 text-2xl font-bold text-[#0f172a]">{kids.reduce((a, k) => a + k.used, 0)}<span className="ml-1 text-[15px] text-[#94a3b8]">건</span></div>
                    <div className="mt-0.5 text-[11px] text-[#94a3b8]">잔여 {kids.reduce((a, k) => a + k.balance, 0)}건</div>
                </div>
            </div>

            {/* 검색 — 하부 업체가 늘어나면 목록으로만은 못 찾는다. */}
            <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[#e2e8f0] bg-[#f1f5f9] p-3">
                <input
                    className="h-9 min-w-[180px] flex-1 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="하부 업체명 검색"
                    value={q}
                />
                <span className="ml-auto text-xs font-medium text-[#64748b]">{rows.length}개</span>
            </div>

            <div className="overflow-x-auto rounded-[8px] border border-[#e2e8f0] bg-white">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            {['하부 업체', '계약 건수', '단가', '금액(공급가)', '발행', '잔여', '진행률', '최근 배분'].map((h) => (
                                <th className="px-3 py-2 font-semibold" key={h}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={8}>
                                    {q ? '검색 결과가 없습니다.' : '아직 하부 업체 계약이 없습니다. 조직 관리에서 충전 신청을 처리하면 여기에 쌓입니다.'}
                                </td>
                            </tr>
                        ) : rows.map((r) => (
                            <tr className="border-b border-[#e2e8f0] hover:bg-[#f8fafc]" key={r.client_id}>
                                <td className="px-3 py-2 font-medium text-[#334155]">{r.company}</td>
                                <td className="px-3 py-2 text-[#475569]">{r.goal ? `${r.goal}건` : '-'}</td>
                                <td className="px-3 py-2 text-[#475569]">{r.unit ? `${won(r.unit)}원` : '-'}</td>
                                <td className="px-3 py-2 font-semibold text-[#0f172a]">{r.amount ? `${won(r.amount)}원` : '-'}</td>
                                <td className="px-3 py-2 text-[#475569]">{r.used}건</td>
                                <td className="px-3 py-2 font-semibold text-[#1e40af]">{r.balance}건</td>
                                <td className="px-3 py-2">
                                    {r.prog == null ? (
                                        <span className="text-[#94a3b8]">-</span>
                                    ) : (
                                        <div className="min-w-[80px]">
                                            <div className="text-[13px] font-bold" style={{ color: progColor(r.prog) }}>{r.prog}%</div>
                                            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#e2e8f0]">
                                                <div className="h-full rounded-full" style={{ background: progColor(r.prog), width: `${r.prog}%` }} />
                                            </div>
                                        </div>
                                    )}
                                </td>
                                <td className="px-3 py-2 text-[11px] text-[#94a3b8]">{r.last ? r.last.slice(0, 10) : '-'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="m-0 text-[12px] text-[#94a3b8]">
                금액은 모두 공급가(부가세 별도)입니다. 진행률은 배분한 건수 대비 하부 업체가 발행한 건수입니다.
            </p>
        </div>
    );
}
