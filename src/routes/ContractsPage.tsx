import { useMemo, useState } from 'react';
import {
    emptyContractData,
    upsertContractData,
    type ContractProduct,
    type ErpClient,
    type ErpContractData,
    type ScheduleItem,
} from '../api/erp';
import { useErpData } from '../context/ErpDataContext';
import { calcContract, formatAmount, todayStr, ym } from '../lib/erpUtils';

const PAY_METHODS: Record<string, string> = {
    card: '카드',
    cash: '현금/계좌',
    tax_invoice: '세금계산서',
};
const CONTRACT_TYPES = ['신규', '재계약', '연장', '추가'];
const SCHEDULE_STATUS = ['예정', '진행중', '완료', '보류'];

type Draft = ErpContractData;

function ContractsPage() {
    const { clients, salespeople, contractData, loading, error, refresh } = useErpData();

    const [search, setSearch] = useState('');
    const [onlyUnpaid, setOnlyUnpaid] = useState(false);
    const [toast, setToast] = useState('');

    const [editClient, setEditClient] = useState<ErpClient | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [saving, setSaving] = useState(false);
    const [tab, setTab] = useState<'products' | 'billing' | 'schedule'>('products');

    const showToast = (message: string) => {
        setToast(message);
        window.setTimeout(() => setToast(''), 2200);
    };

    const rateOf = (client: ErpClient): number | null => {
        const sp = salespeople.find((s) => s.name === (client.manager || ''));
        return sp?.commission_rate ?? null;
    };

    // 계약 대상: 상태가 '계약완료'인 고객만. 검색·미수금 필터.
    const rows = useMemo(() => {
        const term = search.trim().toLowerCase();
        return clients
            .filter((client) => client.status === '계약완료')
            .map((client) => {
                const cd = contractData[client.id] ?? emptyContractData(client.id);
                const fin = calcContract(cd, rateOf(client));
                return { client, cd, fin };
            })
            .filter(({ client }) => {
                if (!term) {
                    return true;
                }
                return (
                    (client.company || '').toLowerCase().includes(term) ||
                    (client.manager || '').toLowerCase().includes(term)
                );
            })
            .filter(({ fin }) => (onlyUnpaid ? fin.unpaid > 0 : true));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clients, contractData, salespeople, search, onlyUnpaid]);

    const totals = useMemo(() => {
        return rows.reduce(
            (acc, { fin }) => ({
                net: acc.net + fin.net,
                incentive: acc.incentive + fin.incentive,
                revenue: acc.revenue + fin.revenue,
                unpaid: acc.unpaid + fin.unpaid,
            }),
            { incentive: 0, net: 0, revenue: 0, unpaid: 0 },
        );
    }, [rows]);

    const openEdit = (client: ErpClient) => {
        const existing = contractData[client.id];
        setEditClient(client);
        setDraft(
            existing
                ? JSON.parse(JSON.stringify(existing))
                : emptyContractData(client.id),
        );
        setTab('products');
    };

    const closeEdit = () => {
        setEditClient(null);
        setDraft(null);
    };

    const patch = (changes: Partial<Draft>) => {
        setDraft((current) => (current ? { ...current, ...changes } : current));
    };

    // ── 상품 ──
    const addProduct = () => {
        if (!draft) {
            return;
        }
        const product: ContractProduct = {
            done: 0,
            quantity: 1,
            type: '',
            unit_outsource: 0,
            unit_price: 0,
        };
        patch({ contract_products: [...draft.contract_products, product] });
    };

    const updateProduct = (index: number, changes: Partial<ContractProduct>) => {
        if (!draft) {
            return;
        }
        const list = draft.contract_products.map((p, i) => (i === index ? { ...p, ...changes } : p));
        patch({ contract_products: list });
    };

    const removeProduct = (index: number) => {
        if (!draft) {
            return;
        }
        patch({ contract_products: draft.contract_products.filter((_, i) => i !== index) });
    };

    // ── 청구·수금 ──
    const addBillingMonth = () => {
        if (!draft) {
            return;
        }
        const month = ym(new Date());
        if (draft.billing_records.some((r) => r.ym === month)) {
            showToast('이번 달 청구가 이미 있습니다');
            return;
        }
        patch({
            billing_records: [
                { amount: draft.billing_amount || 0, paid: false, ym: month },
                ...draft.billing_records,
            ],
        });
    };

    const updateBilling = (index: number, changes: Partial<Draft['billing_records'][number]>) => {
        if (!draft) {
            return;
        }
        const list = draft.billing_records.map((r, i) => (i === index ? { ...r, ...changes } : r));
        patch({ billing_records: list });
    };

    const togglePaid = (index: number) => {
        if (!draft) {
            return;
        }
        const record = draft.billing_records[index];
        updateBilling(index, {
            paid: !record.paid,
            paid_date: !record.paid ? todayStr() : null,
        });
    };

    const removeBilling = (index: number) => {
        if (!draft) {
            return;
        }
        patch({ billing_records: draft.billing_records.filter((_, i) => i !== index) });
    };

    // ── 작업 일정 ──
    const addSchedule = () => {
        if (!draft) {
            return;
        }
        const item: ScheduleItem = {
            id: draft.schedule.reduce((max, s) => Math.max(max, s.id), 0) + 1,
            status: '예정',
            title: '',
            type: '',
        };
        patch({ schedule: [...draft.schedule, item] });
    };

    const updateSchedule = (index: number, changes: Partial<ScheduleItem>) => {
        if (!draft) {
            return;
        }
        const list = draft.schedule.map((s, i) => (i === index ? { ...s, ...changes } : s));
        patch({ schedule: list });
    };

    const removeSchedule = (index: number) => {
        if (!draft) {
            return;
        }
        patch({ schedule: draft.schedule.filter((_, i) => i !== index) });
    };

    const save = async () => {
        if (!draft) {
            return;
        }
        setSaving(true);
        const { error: saveError } = await upsertContractData(draft);
        setSaving(false);
        if (saveError) {
            showToast(`오류: ${saveError.message}`);
            return;
        }
        closeEdit();
        await refresh();
        showToast('계약이 저장되었습니다');
    };

    const draftFin = useMemo(
        () => (draft && editClient ? calcContract(draft, rateOf(editClient)) : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [draft, editClient, salespeople],
    );

    return (
        <section className="grid gap-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">계약 관리</h2>
                    <p className="mt-1 mb-0 text-sm text-[#64748b]">
                        '계약완료' 고객의 상품·청구·수금·순수익·인센티브를 관리합니다.{' '}
                        {loading ? '불러오는 중...' : `총 ${rows.length}건`}
                    </p>
                </div>
            </div>

            {error ? (
                <p className="m-0 rounded-md bg-[#fee2e2] px-4 py-3 text-sm text-[#dc2626]">
                    {error} — Supabase에 contract_data 테이블이 있는지 확인하세요 (docs/erp-tables.sql)
                </p>
            ) : null}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <KpiCard label="총 매출" value={formatAmount(totals.revenue)} />
                <KpiCard label="순수익" value={formatAmount(totals.net)} accent="#059669" />
                <KpiCard label="미수금" value={formatAmount(totals.unpaid)} accent="#dc2626" />
                <KpiCard label="인센티브 합계" value={formatAmount(totals.incentive)} accent="#7c3aed" />
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#e2e8f0] bg-[#f1f5f9] p-3">
                <input
                    className="h-9 min-w-[180px] flex-1 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="업체명·담당자 검색..."
                    value={search}
                />
                <label className="flex items-center gap-1 text-xs text-[#334155]">
                    <input
                        checked={onlyUnpaid}
                        onChange={(event) => setOnlyUnpaid(event.target.checked)}
                        type="checkbox"
                    />
                    미수금만
                </label>
                <button
                    className="inline-flex h-8 items-center rounded-md border border-[#cbd5e1] bg-white px-3 text-xs font-semibold"
                    onClick={() => void refresh()}
                    type="button"
                >
                    새로고침
                </button>
            </div>

            <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">업체명</th>
                            <th className="px-3 py-2 font-semibold">담당자</th>
                            <th className="px-3 py-2 font-semibold">유형</th>
                            <th className="px-3 py-2 text-right font-semibold">월 청구액</th>
                            <th className="px-3 py-2 text-right font-semibold">매출</th>
                            <th className="px-3 py-2 text-right font-semibold">순수익</th>
                            <th className="px-3 py-2 text-right font-semibold">인센티브</th>
                            <th className="px-3 py-2 text-right font-semibold">미수금</th>
                            <th className="px-3 py-2 font-semibold">액션</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length ? (
                            rows.map(({ client, cd, fin }) => {
                                const hasContract = Boolean(contractData[client.id]);
                                return (
                                    <tr key={client.id} className="border-b border-[#e2e8f0]">
                                        <td className="px-3 py-2 font-medium">
                                            {client.company || '--'}
                                            {!hasContract ? (
                                                <span className="ml-2 rounded bg-[#f1f5f9] px-1.5 py-0.5 text-[10px] text-[#94a3b8]">
                                                    미작성
                                                </span>
                                            ) : null}
                                        </td>
                                        <td className="px-3 py-2">{client.manager || '--'}</td>
                                        <td className="px-3 py-2 text-xs text-[#64748b]">
                                            {cd.contract_type || '--'}
                                        </td>
                                        <td className="px-3 py-2 text-right text-xs">
                                            {formatAmount(cd.billing_amount)}
                                        </td>
                                        <td className="px-3 py-2 text-right text-xs">
                                            {formatAmount(fin.revenue)}
                                        </td>
                                        <td className="px-3 py-2 text-right text-xs font-semibold text-[#059669]">
                                            {formatAmount(fin.net)}
                                        </td>
                                        <td className="px-3 py-2 text-right text-xs text-[#7c3aed]">
                                            {formatAmount(fin.incentive)}
                                            <span className="ml-1 text-[10px] text-[#94a3b8]">
                                                {fin.incentivePct}%
                                            </span>
                                        </td>
                                        <td
                                            className={`px-3 py-2 text-right text-xs ${
                                                fin.unpaid > 0 ? 'font-semibold text-[#dc2626]' : 'text-[#94a3b8]'
                                            }`}
                                        >
                                            {formatAmount(fin.unpaid)}
                                        </td>
                                        <td className="px-3 py-2">
                                            <button
                                                className="rounded border border-[#cbd5e1] px-2 py-1 text-[11px] text-[#334155]"
                                                onClick={() => openEdit(client)}
                                                type="button"
                                            >
                                                {hasContract ? '상세/수정' : '계약 작성'}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })
                        ) : (
                            <tr>
                                <td className="px-3 py-12 text-center text-sm text-[#64748b]" colSpan={9}>
                                    {loading
                                        ? '불러오는 중...'
                                        : "계약완료 상태의 고객이 없습니다 · 고객사 관리에서 상태를 '계약완료'로 바꾸면 여기에 표시됩니다"}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {editClient && draft ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onClick={(event) => event.target === event.currentTarget && closeEdit()}
                >
                    <div className="max-h-[92vh] w-[min(820px,96vw)] overflow-y-auto rounded-2xl bg-white p-6">
                        <div className="flex items-start justify-between">
                            <div>
                                <h3 className="m-0 text-lg font-bold">
                                    {editClient.company || '(업체명 없음)'} · 계약
                                </h3>
                                <p className="mt-1 mb-0 text-sm text-[#64748b]">
                                    담당자 {editClient.manager || '--'}
                                </p>
                            </div>
                            <button
                                className="text-2xl leading-none text-[#94a3b8]"
                                onClick={closeEdit}
                                type="button"
                            >
                                ×
                            </button>
                        </div>

                        {/* 요약 */}
                        {draftFin ? (
                            <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-[#f8fafc] p-3 text-center sm:grid-cols-4">
                                <Summary label="매출" value={formatAmount(draftFin.revenue)} />
                                <Summary label="공급가" value={formatAmount(draftFin.supply)} />
                                <Summary label="순수익" value={formatAmount(draftFin.net)} color="#059669" />
                                <Summary
                                    label={`인센티브(${draftFin.incentivePct}%)`}
                                    value={formatAmount(draftFin.incentive)}
                                    color="#7c3aed"
                                />
                            </div>
                        ) : null}

                        {/* 기본 설정 */}
                        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                            <Field label="계약 유형">
                                <select
                                    className="erp-input"
                                    onChange={(event) => patch({ contract_type: event.target.value })}
                                    value={draft.contract_type}
                                >
                                    {CONTRACT_TYPES.map((t) => (
                                        <option key={t}>{t}</option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="결제 방식">
                                <select
                                    className="erp-input"
                                    onChange={(event) => patch({ pay_method: event.target.value })}
                                    value={draft.pay_method}
                                >
                                    {Object.entries(PAY_METHODS).map(([value, label]) => (
                                        <option key={value} value={value}>
                                            {label}
                                        </option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="청구일(매월)">
                                <input
                                    className="erp-input"
                                    max={31}
                                    min={1}
                                    onChange={(event) =>
                                        patch({ billing_day: Number(event.target.value) || null })
                                    }
                                    type="number"
                                    value={draft.billing_day ?? ''}
                                />
                            </Field>
                            <Field label="월 청구액(원)">
                                <input
                                    className="erp-input"
                                    onChange={(event) =>
                                        patch({ billing_amount: Number(event.target.value) || 0 })
                                    }
                                    type="number"
                                    value={draft.billing_amount || ''}
                                />
                            </Field>
                            <Field label="매출 수동입력(원)">
                                <input
                                    className="erp-input"
                                    onChange={(event) =>
                                        patch({ manual_revenue: Number(event.target.value) || 0 })
                                    }
                                    placeholder="비우면 상품 합계"
                                    type="number"
                                    value={draft.manual_revenue || ''}
                                />
                            </Field>
                            <Field label="외주비 수동입력(원)">
                                <input
                                    className="erp-input"
                                    onChange={(event) =>
                                        patch({ manual_outsource: Number(event.target.value) || 0 })
                                    }
                                    placeholder="비우면 상품 합계"
                                    type="number"
                                    value={draft.manual_outsource || ''}
                                />
                            </Field>
                        </div>
                        <label className="mt-3 flex items-center gap-2 text-sm text-[#334155]">
                            <input
                                checked={draft.vat_included}
                                onChange={(event) => patch({ vat_included: event.target.checked })}
                                type="checkbox"
                            />
                            매출에 부가세(VAT 10%) 포함 — 체크 시 순수익은 공급가 기준으로 계산
                        </label>

                        {/* 탭 */}
                        <div className="mt-5 flex gap-1 border-b border-[#e2e8f0]">
                            {(
                                [
                                    ['products', '상품/매출'],
                                    ['billing', '청구·수금'],
                                    ['schedule', '작업 일정'],
                                ] as const
                            ).map(([key, label]) => (
                                <button
                                    className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                                        tab === key
                                            ? 'border-[#1e40af] text-[#1e40af]'
                                            : 'border-transparent text-[#94a3b8]'
                                    }`}
                                    key={key}
                                    onClick={() => setTab(key)}
                                    type="button"
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        {/* 상품 탭 */}
                        {tab === 'products' ? (
                            <div className="mt-4 grid gap-2">
                                {draft.contract_products.map((product, index) => (
                                    <div
                                        className="grid grid-cols-[1.4fr_1fr_0.7fr_1fr_0.7fr_auto] items-center gap-2 rounded-md border border-[#e2e8f0] p-2"
                                        key={index}
                                    >
                                        <input
                                            className="erp-input"
                                            onChange={(event) =>
                                                updateProduct(index, { type: event.target.value })
                                            }
                                            placeholder="상품명"
                                            value={product.type}
                                        />
                                        <input
                                            className="erp-input"
                                            onChange={(event) =>
                                                updateProduct(index, {
                                                    unit_price: Number(event.target.value) || 0,
                                                })
                                            }
                                            placeholder="단가"
                                            type="number"
                                            value={product.unit_price || ''}
                                        />
                                        <input
                                            className="erp-input"
                                            onChange={(event) =>
                                                updateProduct(index, {
                                                    quantity: Number(event.target.value) || 0,
                                                })
                                            }
                                            placeholder="수량"
                                            type="number"
                                            value={product.quantity || ''}
                                        />
                                        <input
                                            className="erp-input"
                                            onChange={(event) =>
                                                updateProduct(index, {
                                                    unit_outsource: Number(event.target.value) || 0,
                                                })
                                            }
                                            placeholder="개당 외주비"
                                            type="number"
                                            value={product.unit_outsource || ''}
                                        />
                                        <span className="text-right text-xs font-medium text-[#334155]">
                                            {formatAmount(
                                                (product.unit_price || 0) * (product.quantity || 0),
                                            )}
                                        </span>
                                        <button
                                            className="rounded border border-[#fca5a5] px-2 py-1 text-[11px] text-[#dc2626]"
                                            onClick={() => removeProduct(index)}
                                            type="button"
                                        >
                                            삭제
                                        </button>
                                    </div>
                                ))}
                                <button
                                    className="rounded-md border border-dashed border-[#cbd5e1] py-2 text-sm font-semibold text-[#64748b]"
                                    onClick={addProduct}
                                    type="button"
                                >
                                    + 상품 추가
                                </button>
                                {draft.manual_revenue > 0 || draft.manual_outsource > 0 ? (
                                    <p className="m-0 text-xs text-[#d97706]">
                                        ⚠ 수동 매출/외주비가 입력되어 있어 상품 합계 대신 수동값이
                                        우선 적용됩니다.
                                    </p>
                                ) : null}
                            </div>
                        ) : null}

                        {/* 청구·수금 탭 */}
                        {tab === 'billing' ? (
                            <div className="mt-4 grid gap-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-[#64748b]">
                                        청구 {formatAmount(draftFin?.billed ?? 0)} · 수금{' '}
                                        {formatAmount(draftFin?.paid ?? 0)} · 미수{' '}
                                        <strong className="text-[#dc2626]">
                                            {formatAmount(draftFin?.unpaid ?? 0)}
                                        </strong>
                                    </span>
                                    <button
                                        className="rounded-md bg-[#1e40af] px-3 py-1.5 text-xs font-semibold text-white"
                                        onClick={addBillingMonth}
                                        type="button"
                                    >
                                        + 이번 달 청구 생성
                                    </button>
                                </div>
                                {draft.billing_records.length ? (
                                    draft.billing_records.map((record, index) => (
                                        <div
                                            className="grid grid-cols-[1fr_1.2fr_auto_auto] items-center gap-2 rounded-md border border-[#e2e8f0] p-2"
                                            key={record.ym + index}
                                        >
                                            <input
                                                className="erp-input"
                                                onChange={(event) =>
                                                    updateBilling(index, { ym: event.target.value })
                                                }
                                                value={record.ym}
                                            />
                                            <input
                                                className="erp-input"
                                                onChange={(event) =>
                                                    updateBilling(index, {
                                                        amount: Number(event.target.value) || 0,
                                                    })
                                                }
                                                type="number"
                                                value={record.amount || ''}
                                            />
                                            <button
                                                className={`rounded px-3 py-1.5 text-xs font-semibold ${
                                                    record.paid
                                                        ? 'bg-[#d1fae5] text-[#059669]'
                                                        : 'bg-[#fee2e2] text-[#dc2626]'
                                                }`}
                                                onClick={() => togglePaid(index)}
                                                type="button"
                                            >
                                                {record.paid ? `수금완료 ${record.paid_date ?? ''}` : '미수금'}
                                            </button>
                                            <button
                                                className="rounded border border-[#fca5a5] px-2 py-1 text-[11px] text-[#dc2626]"
                                                onClick={() => removeBilling(index)}
                                                type="button"
                                            >
                                                삭제
                                            </button>
                                        </div>
                                    ))
                                ) : (
                                    <p className="m-0 py-6 text-center text-sm text-[#94a3b8]">
                                        청구 내역이 없습니다
                                    </p>
                                )}
                            </div>
                        ) : null}

                        {/* 작업 일정 탭 */}
                        {tab === 'schedule' ? (
                            <div className="mt-4 grid gap-2">
                                {draft.schedule.map((item, index) => (
                                    <div
                                        className="grid grid-cols-[1fr_1.4fr_1fr_1fr_auto] items-center gap-2 rounded-md border border-[#e2e8f0] p-2"
                                        key={item.id}
                                    >
                                        <input
                                            className="erp-input"
                                            onChange={(event) =>
                                                updateSchedule(index, { type: event.target.value })
                                            }
                                            placeholder="유형"
                                            value={item.type}
                                        />
                                        <input
                                            className="erp-input"
                                            onChange={(event) =>
                                                updateSchedule(index, { title: event.target.value })
                                            }
                                            placeholder="작업 내용"
                                            value={item.title}
                                        />
                                        <input
                                            className="erp-input"
                                            onChange={(event) =>
                                                updateSchedule(index, { due_date: event.target.value })
                                            }
                                            type="date"
                                            value={item.due_date ?? ''}
                                        />
                                        <select
                                            className="erp-input"
                                            onChange={(event) =>
                                                updateSchedule(index, { status: event.target.value })
                                            }
                                            value={item.status}
                                        >
                                            {SCHEDULE_STATUS.map((s) => (
                                                <option key={s}>{s}</option>
                                            ))}
                                        </select>
                                        <button
                                            className="rounded border border-[#fca5a5] px-2 py-1 text-[11px] text-[#dc2626]"
                                            onClick={() => removeSchedule(index)}
                                            type="button"
                                        >
                                            삭제
                                        </button>
                                    </div>
                                ))}
                                <button
                                    className="rounded-md border border-dashed border-[#cbd5e1] py-2 text-sm font-semibold text-[#64748b]"
                                    onClick={addSchedule}
                                    type="button"
                                >
                                    + 일정 추가
                                </button>
                            </div>
                        ) : null}

                        <div className="mt-6 flex justify-end gap-2">
                            <button
                                className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                                onClick={closeEdit}
                                type="button"
                            >
                                취소
                            </button>
                            <button
                                className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                                disabled={saving}
                                onClick={() => void save()}
                                type="button"
                            >
                                {saving ? '저장 중...' : '저장'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {toast ? (
                <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-[#0f172a] px-5 py-2.5 text-sm font-medium text-white shadow-lg">
                    {toast}
                </div>
            ) : null}
        </section>
    );
}

function KpiCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
    return (
        <div className="rounded-lg border border-[#e2e8f0] bg-white p-3">
            <p className="m-0 text-xs text-[#64748b]">{label}</p>
            <p className="m-0 mt-1 text-lg font-bold" style={{ color: accent ?? '#0f172a' }}>
                {value}
            </p>
        </div>
    );
}

function Summary({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div>
            <p className="m-0 text-[11px] text-[#64748b]">{label}</p>
            <p className="m-0 mt-0.5 text-sm font-bold" style={{ color: color ?? '#0f172a' }}>
                {value}
            </p>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block text-xs font-semibold text-[#334155]">
            <span className="mb-1 block">{label}</span>
            {children}
        </label>
    );
}

export default ContractsPage;
