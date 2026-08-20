import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
    getMyOrg, agencyPendingSignups, agencyChildren, agencyTransfers, listSubRequests,
    type MyOrg, type AgencyChild, type AgencyTransfer, type SubTokenRequest,
} from '../../api/orgs';
import { listTokens, balanceOf, listChargeRequests, won } from '../../api/cafeTokens';

// 대행사 통합 대시보드 — 조직 현황 + 정산을 한 화면에.
//   조직 관리는 '처리하는 곳'(승인·통보·발행), 여기는 '보는 곳'이다.
//   숫자를 두 곳에서 각각 계산하면 언젠가 갈라지므로, 계산식은 여기 한 곳에만 둔다.

const nav = (path: string) => () => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new Event('app:navigate'));
};

export default function AgencyDashboard() {
    const { profile } = useAuth();
    const asParam = new URLSearchParams(window.location.search).get('as') || '';
    const clientId = asParam || profile?.client_id || '';

    const [org, setOrg] = useState<MyOrg>({ me: null, children: [], invites: [] });
    const [kids, setKids] = useState<AgencyChild[]>([]);
    const [pending, setPending] = useState(0);
    const [subReqs, setSubReqs] = useState<SubTokenRequest[]>([]);
    const [transfers, setTransfers] = useState<AgencyTransfer[]>([]);
    const [buys, setBuys] = useState({ count: 0, amount: 0 });
    const [balance, setBalance] = useState(0);
    const [loading, setLoading] = useState(true);

    const load = useCallback(() => {
        if (!clientId) { setLoading(false); return; }
        setLoading(true);
        void Promise.all([
            getMyOrg(clientId), agencyChildren(), agencyPendingSignups(),
            listSubRequests({ agencyId: clientId }), agencyTransfers(clientId),
            listTokens(clientId), listChargeRequests(clientId),
        ]).then(([o, c, p, sr, tr, t, buy]) => {
            setOrg(o.data);
            setKids(c.data);
            setPending(p.data.length);
            setSubReqs(sr.data);
            setTransfers(tr.data);
            setBalance(balanceOf(t.data, clientId));
            // 발행 완료된 건만 매입으로 본다 — 통보만 받고 입금 전이면 아직 산 게 아니다.
            const done = buy.data.filter((r) => r.status === 'done');
            setBuys({
                count: done.reduce((a, r) => a + (r.granted_count ?? r.quoted_count ?? 0), 0),
                amount: done.reduce((a, r) => a + (r.amount ?? 0), 0),
            });
            setLoading(false);
        });
    }, [clientId]);
    useEffect(load, [load]);

    if (loading) return <div className="py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>;
    if (!org.me?.is_agency) return null;

    const openReqs = subReqs.filter((r) => r.status !== 'done' && r.status !== 'rejected');
    const soldCount = transfers.reduce((a, t) => a + (t.count || 0), 0);
    const soldAmount = transfers.reduce((a, t) => a + (t.amount || 0), 0);
    const avgBuy = buys.count ? buys.amount / buys.count : 0;
    // 차액은 **판 건수 기준**. 매입 총액에서 판매 총액을 그냥 빼면 아직 안 판 재고까지
    // 손해로 잡혀 "팔수록 마이너스"라는 엉뚱한 숫자가 나온다.
    const margin = Math.round(soldAmount - soldCount * avgBuy);
    const unitMargin = soldCount ? Math.round(margin / soldCount) : 0;
    const childDone = kids.reduce((a, k) => a + k.used, 0);

    const card = (label: string, value: string | number, unit: string, tone: 'plain' | 'warn' | 'blue', go?: () => void) => (
        <button
            className={`rounded-xl border p-4 text-left transition ${
                tone === 'warn' ? 'border-[#fdba74] bg-[#fff7ed] hover:border-[#fb923c]' : 'border-[#e2e8f0] bg-white hover:border-[#1e40af]'
            } ${go ? 'cursor-pointer' : 'cursor-default'}`}
            disabled={!go}
            onClick={go}
            type="button"
        >
            <div className="text-[12px] font-semibold text-[#64748b]">{label}</div>
            <div className={`mt-1 text-[26px] font-bold ${tone === 'warn' ? 'text-[#c2410c]' : tone === 'blue' ? 'text-[#1e40af]' : 'text-[#0f172a]'}`}>
                {value}<span className="ml-1 text-[15px] font-semibold text-[#94a3b8]">{unit}</span>
            </div>
        </button>
    );

    return (
        <div className="grid gap-4">
            {/* 조직 현황 */}
            <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">
                {card('하위 업체', kids.length, '곳', 'plain', nav('/portal/org'))}
                {card('배분 가능 토큰', balance, '건', 'blue')}
                {card('가입 승인 대기', pending, '건', pending ? 'warn' : 'plain', nav('/portal/org'))}
                {card('하위 충전 신청', openReqs.length, '건', openReqs.length ? 'warn' : 'plain', nav('/portal/org'))}
            </div>

            {/* 정산 */}
            <div className="rounded-xl border border-[#e2e8f0] p-4">
                <div className="mb-3 text-[14px] font-bold text-[#0f172a]">
                    정산 <span className="text-[12px] font-normal text-[#94a3b8]">공급가 · 부가세 별도</span>
                </div>
                <div className="grid grid-cols-3 gap-3 max-[700px]:grid-cols-1">
                    <div className="rounded-xl border border-[#e2e8f0] p-4">
                        <div className="text-[12px] font-semibold text-[#64748b]">매입 <span className="font-normal text-[#94a3b8]">든든한마케팅</span></div>
                        <div className="mt-1 text-[22px] font-bold text-[#b91c1c]">-₩{won(buys.amount)}</div>
                        <div className="mt-0.5 text-[11px] text-[#94a3b8]">
                            {buys.count}건{avgBuy ? ` · 건당 ₩${won(Math.round(avgBuy))}` : ''}
                        </div>
                    </div>
                    <div className="rounded-xl border border-[#e2e8f0] p-4">
                        <div className="text-[12px] font-semibold text-[#64748b]">판매 <span className="font-normal text-[#94a3b8]">하위 업체</span></div>
                        <div className="mt-1 text-[22px] font-bold text-[#1d4ed8]">+₩{won(soldAmount)}</div>
                        <div className="mt-0.5 text-[11px] text-[#94a3b8]">
                            {soldCount}건{soldCount ? ` · 건당 ₩${won(Math.round(soldAmount / soldCount))}` : ''}
                        </div>
                    </div>
                    <div className={`rounded-xl border p-4 ${margin > 0 ? 'border-[#a7f3d0] bg-[#f0fdf4]' : 'border-[#e2e8f0]'}`}>
                        <div className="text-[12px] font-semibold text-[#64748b]">차액 <span className="font-normal text-[#94a3b8]">판매분 기준</span></div>
                        <div className={`mt-1 text-[22px] font-bold ${margin > 0 ? 'text-[#059669]' : margin < 0 ? 'text-[#b91c1c]' : 'text-[#0f172a]'}`}>
                            {margin > 0 ? '+' : ''}₩{won(margin)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[#94a3b8]">
                            {soldCount ? `건당 ${unitMargin > 0 ? '+' : ''}₩${won(unitMargin)} × ${soldCount}건` : '아직 판매 없음'}
                            {buys.count > soldCount ? ` · 미판매 ${buys.count - soldCount}건` : ''}
                        </div>
                    </div>
                </div>
            </div>

            {/* 하위 업체 현황 */}
            <div className="rounded-xl border border-[#e2e8f0]">
                <div className="flex flex-wrap items-center gap-2 border-b border-[#e2e8f0] px-4 py-3">
                    <div className="text-[14px] font-bold text-[#0f172a]">하위 업체 현황</div>
                    <span className="text-[12px] text-[#94a3b8]">발행 {childDone}건</span>
                    <button
                        className="ml-auto rounded-md border border-[#cbd5e1] px-3 py-1 text-xs font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                        onClick={nav('/portal/org')}
                        type="button"
                    >
                        조직 관리로
                    </button>
                </div>
                {kids.length === 0 ? (
                    <div className="px-4 py-12 text-center text-[13px] text-[#94a3b8]">
                        아직 하위 업체가 없습니다. 조직 관리에서 초대 코드를 전달해 주세요.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                            <thead>
                                <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                                    {['업체', '받은 토큰', '남은 토큰', '발행'].map((h) => (
                                        <th className="px-3 py-2 font-semibold" key={h}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {kids.map((k) => (
                                    <tr className="border-b border-[#e2e8f0]" key={k.client_id}>
                                        <td className="px-3 py-2 font-medium text-[#334155]">{k.company}</td>
                                        <td className="px-3 py-2 text-[#475569]">{k.granted}건</td>
                                        <td className="px-3 py-2 font-semibold text-[#1e40af]">{k.balance}건</td>
                                        <td className="px-3 py-2 text-[#475569]">{k.used}건</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
