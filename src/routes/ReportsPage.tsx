import { useMemo } from 'react';
import AdminOnly from '../components/AdminOnly';
import { useErpData } from '../context/ErpDataContext';
import {
    calcContract,
    formatAmount,
    SOURCE_BADGE,
    STATUS_BADGE,
    STATUS_OPTIONS,
    todayStr,
} from '../lib/erpUtils';

function ReportsPage() {
    const { clients, salespeople, contractData, canSeeAll, myName, loading } = useErpData();

    const rateOf = (manager: string | null) =>
        salespeople.find((s) => s.name === (manager || ''))?.commission_rate ?? null;

    // 월별 청구/수금 추이
    const monthly = useMemo(() => {
        const map = new Map<string, { billed: number; paid: number }>();
        clients.forEach((client) => {
            const cd = contractData[client.id];
            if (!cd) {
                return;
            }
            (cd.billing_records || []).forEach((record) => {
                const entry = map.get(record.ym) ?? { billed: 0, paid: 0 };
                entry.billed += Number(record.amount) || 0;
                if (record.paid) {
                    entry.paid += Number(record.amount) || 0;
                }
                map.set(record.ym, entry);
            });
        });
        return [...map.entries()]
            .map(([month, value]) => ({ month, ...value }))
            .sort((a, b) => a.month.localeCompare(b.month))
            .slice(-12);
    }, [clients, contractData]);

    const maxBilled = Math.max(1, ...monthly.map((m) => m.billed));

    // 문의 경로별
    const bySource = useMemo(() => {
        const map = new Map<string, number>();
        clients.forEach((c) => {
            const key = c.source || '기타';
            map.set(key, (map.get(key) ?? 0) + 1);
        });
        return [...map.entries()].sort((a, b) => b[1] - a[1]);
    }, [clients]);

    // 상태별 퍼널
    const byStatus = useMemo(() => {
        const map = new Map<string, number>();
        clients.forEach((c) => {
            const key = c.status || '신규문의';
            map.set(key, (map.get(key) ?? 0) + 1);
        });
        return STATUS_OPTIONS.map((status) => ({ count: map.get(status) ?? 0, status }));
    }, [clients]);

    const totalNet = useMemo(
        () =>
            clients.reduce((sum, client) => {
                const cd = contractData[client.id];
                return cd ? sum + calcContract(cd, rateOf(client.manager)).net : sum;
            }, 0),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [clients, contractData, salespeople],
    );

    const exportCsv = () => {
        const header = ['월', '청구액', '수금액', '미수금'];
        const rows = monthly.map((m) => [m.month, m.billed, m.paid, m.billed - m.paid]);
        const csv =
            '﻿' + [header, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        link.download = `리포트_${todayStr()}.csv`;
        link.click();
    };

    return (
        <section className="grid gap-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">리포트</h2>
                    <p className="mt-1 mb-0 text-sm text-[#64748b]">
                        {canSeeAll ? '전체' : `${myName} 담당`} · 순수익 합계{' '}
                        <strong className="text-[#059669]">{formatAmount(totalNet)}</strong>
                        {loading ? ' · 불러오는 중...' : ''}
                    </p>
                </div>
                <AdminOnly>
                    <button
                        className="rounded-md border border-[#cbd5e1] bg-white px-4 py-2 text-sm font-semibold"
                        onClick={exportCsv}
                        type="button"
                    >
                        CSV 다운로드
                    </button>
                </AdminOnly>
            </div>

            {/* 월별 추이 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <h3 className="m-0 mb-3 text-sm font-bold text-[#0f172a]">월별 청구·수금 추이</h3>
                {monthly.length ? (
                    <div className="grid gap-2">
                        {monthly.map((m) => (
                            <div key={m.month} className="flex items-center gap-3">
                                <span className="w-16 shrink-0 text-xs text-[#64748b]">{m.month}</span>
                                <div className="relative h-5 flex-1 overflow-hidden rounded bg-[#f1f5f9]">
                                    <div
                                        className="absolute inset-y-0 left-0 rounded bg-[#bfdbfe]"
                                        style={{ width: `${(m.billed / maxBilled) * 100}%` }}
                                    />
                                    <div
                                        className="absolute inset-y-0 left-0 rounded bg-[#059669]"
                                        style={{ width: `${(m.paid / maxBilled) * 100}%` }}
                                    />
                                </div>
                                <span className="w-24 shrink-0 text-right text-xs font-medium">
                                    {formatAmount(m.billed)}
                                </span>
                            </div>
                        ))}
                        <p className="m-0 mt-1 text-[11px] text-[#94a3b8]">
                            <span className="text-[#059669]">■</span> 수금 ·{' '}
                            <span className="text-[#bfdbfe]">■</span> 청구
                        </p>
                    </div>
                ) : (
                    <p className="m-0 py-6 text-center text-sm text-[#94a3b8]">청구 데이터가 없습니다</p>
                )}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                {/* 경로별 */}
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <h3 className="m-0 mb-3 text-sm font-bold text-[#0f172a]">문의 경로별 분포</h3>
                    <div className="grid gap-2">
                        {bySource.length ? (
                            bySource.map(([source, count]) => (
                                <div key={source} className="flex items-center justify-between">
                                    <span
                                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                            SOURCE_BADGE[source] || 'bg-[#e2e8f0] text-[#64748b]'
                                        }`}
                                    >
                                        {source}
                                    </span>
                                    <span className="text-sm font-medium">{count}건</span>
                                </div>
                            ))
                        ) : (
                            <p className="m-0 py-4 text-center text-sm text-[#94a3b8]">데이터 없음</p>
                        )}
                    </div>
                </div>

                {/* 상태 퍼널 */}
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <h3 className="m-0 mb-3 text-sm font-bold text-[#0f172a]">영업 단계별 현황</h3>
                    <div className="grid gap-2">
                        {byStatus.map(({ status, count }) => (
                            <div key={status} className="flex items-center justify-between">
                                <span
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                        STATUS_BADGE[status] || 'bg-[#e2e8f0] text-[#64748b]'
                                    }`}
                                >
                                    {status}
                                </span>
                                <span className="text-sm font-medium">{count}건</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}

export default ReportsPage;
