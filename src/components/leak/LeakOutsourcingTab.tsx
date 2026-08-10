import { useEffect, useMemo, useState } from 'react';
import {
    createOutsourcing,
    deleteOutsourcing,
    listOutsourcing,
    parseWon,
    updateOutsourcing,
    won,
    type LeakOutsourcing,
    type OutsourcingInput,
} from '../../api/leakErp';
import { Btn, Card, Chip, Empty, Field, INPUT_CLS, Modal, Td, Th } from './ui';
import { inLeakMonth, useLeakMonth } from './leakMonth';

const blank: OutsourcingInput = {
    amount: 0, amount_vat: 0, ended_on: '', entry_kind: 'order', item_name: '', marketing_type: '',
    note: '', settled_final: false, settled_to_vendor: false, started_on: '', vendor: '',
};

export default function LeakOutsourcingTab({ notify }: { notify: (m: string) => void }) {
    const [rows, setRows] = useState<LeakOutsourcing[]>([]);
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState<OutsourcingInput>(blank);
    const [editId, setEditId] = useState('');
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');

    const load = async () => {
        setLoading(true);
        const { data, error } = await listOutsourcing();
        if (error) notify(`!불러오기 실패: ${error.message}`);
        setRows(data);
        setLoading(false);
    };
    useEffect(() => {
        void load();
    }, []);

    const set = (k: keyof OutsourcingInput, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

    const submit = async () => {
        const { error } = editId ? await updateOutsourcing(editId, form) : await createOutsourcing(form);
        if (error) return notify(`!${error.message}`);
        notify(editId ? '수정했습니다' : '발주를 등록했습니다');
        setForm(blank);
        setEditId('');
        setOpen(false);
        void load();
    };

    const startEdit = (r: LeakOutsourcing) => {
        setEditId(r.id);
        setOpen(true);
        setForm({
            amount: r.amount, amount_vat: r.amount_vat, ended_on: r.ended_on ?? '', entry_kind: r.entry_kind,
            item_name: r.item_name ?? '', marketing_type: r.marketing_type ?? '', note: r.note ?? '',
            settled_final: r.settled_final, settled_to_vendor: r.settled_to_vendor,
            started_on: r.started_on ?? '', vendor: r.vendor ?? '',
        });
    };

    const remove = async (r: LeakOutsourcing) => {
        if (!window.confirm(`발주 삭제 — ${r.item_name}\n되돌릴 수 없습니다. 진행할까요?`)) return;
        const { error } = await deleteOutsourcing(r.id);
        if (error) return notify(`!${error.message}`);
        notify('삭제했습니다');
        void load();
    };

    const month = useLeakMonth();   // 사이드바 공용 월 — 발주 시작일 기준.
    const filtered = useMemo(() => {
        const s = q.trim().toLowerCase();
        return rows.filter((r) =>
            inLeakMonth(r.started_on || r.created_at, month)
            && (!s || [r.item_name, r.vendor, r.marketing_type, r.note].some((v) => (v || '').toLowerCase().includes(s))));
    }, [rows, q, month]);

    // 환불(음수)은 건수 집계에서 분리 — 시트에서 발주 건수가 왜곡되던 부분.
    const stat = useMemo(() => {
        const orders = filtered.filter((r) => r.entry_kind !== 'refund');
        const refunds = filtered.filter((r) => r.entry_kind === 'refund');
        return {
            orderCount: orders.length,
            refundCount: refunds.length,
            vat: filtered.reduce((a, r) => a + r.amount_vat, 0),
        };
    }, [filtered]);

    const formBody = (
        <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    <Field label="품목명 *">
                        <input className={INPUT_CLS} onChange={(e) => set('item_name', e.target.value)} value={form.item_name ?? ''} />
                    </Field>
                    <Field label="마케팅 분류">
                        <input className={INPUT_CLS} onChange={(e) => set('marketing_type', e.target.value)} value={form.marketing_type ?? ''} />
                    </Field>
                    <Field label="외주업체">
                        <input className={INPUT_CLS} onChange={(e) => set('vendor', e.target.value)} value={form.vendor ?? ''} />
                    </Field>
                    <Field label="시작일">
                        <input className={INPUT_CLS} onChange={(e) => set('started_on', e.target.value)} type="date" value={form.started_on ?? ''} />
                    </Field>
                    <Field label="종료일">
                        <input className={INPUT_CLS} onChange={(e) => set('ended_on', e.target.value)} type="date" value={form.ended_on ?? ''} />
                    </Field>
                    <Field label="구분" hint="음수 금액은 환불로">
                        <select className={INPUT_CLS} onChange={(e) => set('entry_kind', e.target.value)} value={form.entry_kind ?? 'order'}>
                            <option value="order">발주</option>
                            <option value="refund">환불/차감</option>
                        </select>
                    </Field>
                    <Field label="결제 금액">
                        <input className={INPUT_CLS} onChange={(e) => set('amount', parseWon(e.target.value))} value={won(form.amount)} />
                    </Field>
                    <Field label="결제 금액 (VAT 포함)">
                        <input className={INPUT_CLS} onChange={(e) => set('amount_vat', parseWon(e.target.value))} value={won(form.amount_vat)} />
                    </Field>
                    <Field label="정산 (든든→외주)">
                        <select className={INPUT_CLS} onChange={(e) => set('settled_to_vendor', e.target.value === '1')} value={form.settled_to_vendor ? '1' : '0'}>
                            <option value="0">미정산</option>
                            <option value="1">정산완료</option>
                        </select>
                    </Field>
                    <Field label="정산 (든든 최종)">
                        <select className={INPUT_CLS} onChange={(e) => set('settled_final', e.target.value === '1')} value={form.settled_final ? '1' : '0'}>
                            <option value="0">미정산</option>
                            <option value="1">정산완료</option>
                        </select>
                    </Field>
                    <Field label="비고">
                        <input className={INPUT_CLS} onChange={(e) => set('note', e.target.value)} value={form.note ?? ''} />
                    </Field>
                </div>
        </>
    );

    return (
        <div className="flex min-w-0 flex-col gap-4">
            <Card
                title={`외주 발주 (발주 ${stat.orderCount}건 · 환불 ${stat.refundCount}건 · VAT포함 합계 ${won(stat.vat)}원)`}
                right={
                    <>
                        <input className={`${INPUT_CLS} w-52 shrink-0`} onChange={(e) => setQ(e.target.value)} placeholder="품목·업체 검색" value={q} />
                        <Btn onClick={() => { setEditId(''); setForm(blank); setOpen(true); }}>+ 발주 추가</Btn>
                    </>
                }
            >
                {loading ? (
                    <Empty>불러오는 중…</Empty>
                ) : filtered.length === 0 ? (
                    <Empty>{rows.length ? '검색 결과가 없습니다' : '등록된 발주가 없습니다'}</Empty>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1000px]">
                            <thead>
                                <tr>
                                    <Th>기간</Th><Th>품목</Th><Th>분류</Th><Th>업체</Th>
                                    <Th align="right">금액</Th><Th align="right">VAT 포함</Th>
                                    <Th align="center">외주정산</Th><Th align="center">최종정산</Th><Th>비고</Th><Th align="right">관리</Th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((r) => (
                                    <tr className="hover:bg-[#f8fafc]" key={r.id}>
                                        <Td className="text-xs">{r.started_on ?? '-'}{r.ended_on ? ` ~ ${r.ended_on}` : ''}</Td>
                                        <Td className="font-semibold">
                                            {r.item_name ?? '-'} {r.entry_kind === 'refund' ? <Chip tone="warn">환불</Chip> : null}
                                        </Td>
                                        <Td>{r.marketing_type ?? '-'}</Td>
                                        <Td>{r.vendor ?? '-'}</Td>
                                        <Td align="right" className={r.amount < 0 ? 'text-[#b91c1c]' : ''}>{won(r.amount)}</Td>
                                        <Td align="right" className={r.amount_vat < 0 ? 'text-[#b91c1c]' : ''}>{won(r.amount_vat)}</Td>
                                        <Td align="center">{r.settled_to_vendor ? <Chip tone="ok">완료</Chip> : <Chip tone="muted">미정산</Chip>}</Td>
                                        <Td align="center">{r.settled_final ? <Chip tone="ok">완료</Chip> : <Chip tone="muted">미정산</Chip>}</Td>
                                        <Td className="max-w-[200px] truncate">{r.note ?? ''}</Td>
                                        <Td align="right">
                                            <div className="flex justify-end gap-1">
                                                <button className="rounded px-2 py-1 text-xs font-semibold text-[#1e40af] hover:bg-[#eff6ff]" onClick={() => startEdit(r)} type="button">수정</button>
                                                <button className="rounded px-2 py-1 text-xs font-semibold text-[#b91c1c] hover:bg-[#fef2f2]" onClick={() => remove(r)} type="button">삭제</button>
                                            </div>
                                        </Td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {open ? (
                <Modal
                    footer={
                        <>
                            <Btn kind="ghost" onClick={() => { setOpen(false); setEditId(''); setForm(blank); }}>취소</Btn>
                            <Btn onClick={submit}>{editId ? '수정 저장' : '등록'}</Btn>
                        </>
                    }
                    onClose={() => { setOpen(false); setEditId(''); setForm(blank); }}
                    title={editId ? '발주 수정' : '외주 발주 추가'}
                    wide
                >
                    {formBody}
                </Modal>
            ) : null}
        </div>
    );
}
