import { useMemo } from 'react';
import { useErpData } from '../context/ErpDataContext';
import { calcContract, formatAmount, STATUS_BADGE } from '../lib/erpUtils';
import Button from '../components/Button';

function go(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new Event('app:navigate'));
}

function DashboardPage() {
    const { clients, salespeople, contractData, canSeeAll, myName, loading, error } = useErpData();

    const today = new Date().toISOString().slice(0, 10);

    const stats = useMemo(() => {
        const rateOf = (manager: string | null) =>
            salespeople.find((s) => s.name === (manager || ''))?.commission_rate ?? null;

        let revenue = 0;
        let net = 0;
        let unpaid = 0;
        let incentive = 0;
        let contractCount = 0;

        clients.forEach((client) => {
            const cd = contractData[client.id];
            if (!cd) {
                return;
            }
            contractCount += 1;
            const fin = calcContract(cd, rateOf(client.manager));
            revenue += fin.revenue;
            net += fin.net;
            unpaid += fin.unpaid;
            incentive += fin.incentive;
        });

        const contracted = clients.filter((c) => c.status === '계약완료').length;
        return { contractCount, contracted, incentive, net, revenue, unpaid };
    }, [clients, contractData, salespeople]);

    // 만료 임박(30일 이내)
    const expiring = useMemo(() => {
        const limit = new Date();
        limit.setDate(limit.getDate() + 30);
        const limitStr = limit.toISOString().slice(0, 10);
        return clients
            .filter((c) => c.contract_end && c.contract_end >= today && c.contract_end <= limitStr)
            .sort((a, b) => (a.contract_end || '').localeCompare(b.contract_end || ''));
    }, [clients, today]);

    // 연락 필요(다음 연락일 지남)
    const needContact = useMemo(
        () =>
            clients
                .filter((c) => c.next_contact && c.next_contact <= today)
                .sort((a, b) => (a.next_contact || '').localeCompare(b.next_contact || '')),
        [clients, today],
    );

    // 영업자별 실적
    const byManager = useMemo(() => {
        const map = new Map<string, { count: number; net: number; incentive: number; unpaid: number }>();
        clients.forEach((client) => {
            const key = client.manager || '미지정';
            const entry = map.get(key) ?? { count: 0, incentive: 0, net: 0, unpaid: 0 };
            entry.count += 1;
            const cd = contractData[client.id];
            if (cd) {
                const rate = salespeople.find((s) => s.name === key)?.commission_rate ?? null;
                const fin = calcContract(cd, rate);
                entry.net += fin.net;
                entry.incentive += fin.incentive;
                entry.unpaid += fin.unpaid;
            }
            map.set(key, entry);
        });
        return [...map.entries()]
            .map(([name, value]) => ({ name, ...value }))
            .sort((a, b) => b.net - a.net);
    }, [clients, contractData, salespeople]);

    return (
        <section className="grid gap-4">
            <div>
                <p className="m-0 text-sm text-[#64748b]">
                    {canSeeAll ? '전체 현황' : `${myName} 님의 담당 현황`}
                    {loading ? ' · 불러오는 중...' : ''}
                </p>
            </div>

            {error ? (
                <p className="m-0 rounded-md bg-[#fee2e2] px-4 py-3 text-sm text-[#dc2626]">{error}</p>
            ) : null}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label="담당 고객" value={`${clients.length}`} sub={`계약완료 ${stats.contracted}`} />
                <Kpi label="총 매출" value={formatAmount(stats.revenue)} sub={`계약 ${stats.contractCount}건`} />
                <Kpi label="순수익" value={formatAmount(stats.net)} accent="#059669" sub={`인센 ${formatAmount(stats.incentive)}`} />
                <Kpi label="미수금" value={formatAmount(stats.unpaid)} accent="#dc2626" sub="수금 필요" />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                {/* 알림: 연락 필요 */}
                <Panel
                    title="🔔 연락 필요"
                    count={needContact.length}
                    onMore={() => go('/clients')}
                >
                    {needContact.length ? (
                        needContact.slice(0, 6).map((c) => (
                            <Row key={c.id} onClick={() => go('/clients')}>
                                <span className="font-medium">{c.company || c.manager || '고객'}</span>
                                <span className="flex items-center gap-2">
                                    <Badge text={c.status || ''} />
                                    <span className="text-xs text-[#dc2626]">{c.next_contact}</span>
                                </span>
                            </Row>
                        ))
                    ) : (
                        <Empty text="연락 예정이 지난 고객이 없습니다" />
                    )}
                </Panel>

                {/* 만료 임박 */}
                <Panel
                    title="⏰ 계약 만료 임박 (30일)"
                    count={expiring.length}
                    onMore={() => go('/contracts')}
                >
                    {expiring.length ? (
                        expiring.slice(0, 6).map((c) => (
                            <Row key={c.id} onClick={() => go('/contracts')}>
                                <span className="font-medium">{c.company || '업체'}</span>
                                <span className="text-xs text-[#d97706]">~ {c.contract_end}</span>
                            </Row>
                        ))
                    ) : (
                        <Empty text="30일 내 만료 예정 계약이 없습니다" />
                    )}
                </Panel>
            </div>

            {/* 영업자별 실적 */}
            <Panel title="👤 영업자별 실적" count={byManager.length}>
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-sm">
                        <thead>
                            <tr className="border-b border-[#e2e8f0] text-[11px] text-[#64748b]">
                                <th className="px-2 py-1.5 font-semibold">영업자</th>
                                <th className="px-2 py-1.5 text-right font-semibold">고객수</th>
                                <th className="px-2 py-1.5 text-right font-semibold">순수익</th>
                                <th className="px-2 py-1.5 text-right font-semibold">인센티브</th>
                                <th className="px-2 py-1.5 text-right font-semibold">미수금</th>
                            </tr>
                        </thead>
                        <tbody>
                            {byManager.length ? (
                                byManager.map((row) => (
                                    <tr key={row.name} className="border-b border-[#f1f5f9]">
                                        <td className="px-2 py-1.5 font-medium">{row.name}</td>
                                        <td className="px-2 py-1.5 text-right">{row.count}</td>
                                        <td className="px-2 py-1.5 text-right font-semibold text-[#059669]">
                                            {formatAmount(row.net)}
                                        </td>
                                        <td className="px-2 py-1.5 text-right text-[#7c3aed]">
                                            {formatAmount(row.incentive)}
                                        </td>
                                        <td className="px-2 py-1.5 text-right text-[#dc2626]">
                                            {formatAmount(row.unpaid)}
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td className="px-2 py-6 text-center text-[#94a3b8]" colSpan={5}>
                                        데이터가 없습니다
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Panel>
        </section>
    );
}

function Kpi({
    label,
    value,
    sub,
    accent,
}: {
    label: string;
    value: string;
    sub?: string;
    accent?: string;
}) {
    return (
        <div className="rounded-[8px] border border-[#e2e8f0] bg-white p-4">
            <p className="m-0 text-xs text-[#64748b]">{label}</p>
            <p className="m-0 mt-1 text-2xl font-bold" style={{ color: accent ?? '#0f172a' }}>
                {value}
            </p>
            {sub ? <p className="m-0 mt-0.5 text-[11px] text-[#94a3b8]">{sub}</p> : null}
        </div>
    );
}

function Panel({
    title,
    count,
    onMore,
    children,
}: {
    title: string;
    count: number;
    onMore?: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="rounded-[8px] border border-[#e2e8f0] bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
                <h3 className="m-0 text-sm font-bold text-[#0f172a]">
                    {title} <span className="text-[#94a3b8]">({count})</span>
                </h3>
                {onMore ? (
                    <Button
                        className="text-xs font-semibold text-[#1e40af]"
                        onClick={onMore}
                        type="button"
                    >
                        전체보기 →
                    </Button>
                ) : null}
            </div>
            <div className="grid gap-1">{children}</div>
        </div>
    );
}

function Row({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
    return (
        <Button
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-[#f8fafc]"
            onClick={onClick}
            type="button"
        >
            {children}
        </Button>
    );
}

function Badge({ text }: { text: string }) {
    if (!text) {
        return null;
    }
    return (
        <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                STATUS_BADGE[text] || 'bg-[#e2e8f0] text-[#64748b]'
            }`}
        >
            {text}
        </span>
    );
}

function Empty({ text }: { text: string }) {
    return <p className="m-0 py-5 text-center text-xs text-[#94a3b8]">{text}</p>;
}

export default DashboardPage;
