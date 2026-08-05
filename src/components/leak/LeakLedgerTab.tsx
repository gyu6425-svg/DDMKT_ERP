import { useEffect, useMemo, useState } from 'react';
import {
    createLedger,
    deleteLedger,
    listLedger,
    OUTFLOW_KINDS,
    parseWon,
    updateLedger,
    withRunningBalance,
    won,
    type LeakLedger,
    type LedgerInput,
} from '../../api/leakErp';
import { Btn, Card, Chip, Empty, Field, INPUT_CLS, Modal, Td, Th } from './ui';

const today = () => new Date().toISOString().slice(0, 10);
const blank = (): LedgerInput => ({
    entry_date: today(), inflow: 0, memo: '', outflow: 0, outflow_kind: '', unreconciled: false,
});

// 시작 잔액 — 시트에서 이월된 값이 있으면 여기에 넣고 쓴다(브라우저 로컬 보관).
const OPENING_KEY = 'leak_ledger_opening';

export default function LeakLedgerTab({ notify }: { notify: (m: string) => void }) {
    const [rows, setRows] = useState<LeakLedger[]>([]);
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState<LedgerInput>(blank());
    const [editId, setEditId] = useState('');
    const [open, setOpen] = useState(false);
    const [opening, setOpening] = useState(() => Number(localStorage.getItem(OPENING_KEY) || 0));

    const load = async () => {
        setLoading(true);
        const { data, error } = await listLedger();
        if (error) notify(`!불러오기 실패: ${error.message}`);
        setRows(data);
        setLoading(false);
    };
    useEffect(() => {
        void load();
    }, []);

    const set = (k: keyof LedgerInput, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

    const submit = async () => {
        const { error } = editId ? await updateLedger(editId, form) : await createLedger(form);
        if (error) return notify(`!${error.message}`);
        notify(editId ? '수정했습니다' : '내역을 등록했습니다');
        setForm(blank());
        setEditId('');
        setOpen(false);
        void load();
    };

    const startEdit = (r: LeakLedger) => {
        setEditId(r.id);
        setOpen(true);
        setForm({
            entry_date: r.entry_date, inflow: r.inflow, memo: r.memo ?? '',
            outflow: r.outflow, outflow_kind: r.outflow_kind ?? '', unreconciled: r.unreconciled,
        });
    };

    const remove = async (r: LeakLedger) => {
        if (!window.confirm(`원장 삭제 — ${r.entry_date}\n되돌릴 수 없습니다. 진행할까요?`)) return;
        const { error } = await deleteLedger(r.id);
        if (error) return notify(`!${error.message}`);
        notify('삭제했습니다');
        void load();
    };

    // 잔액은 저장하지 않고 매번 누적 계산한다(시트의 월합계 손입력 오류를 반복하지 않기 위해).
    const withBal = useMemo(() => withRunningBalance(rows, opening), [rows, opening]);
    const total = useMemo(
        () => rows.reduce((a, r) => ({ in: a.in + r.inflow, out: a.out + r.outflow }), { in: 0, out: 0 }),
        [rows],
    );
    // 출금 종류별 합계 — 시트에서 '외주비' 한 칸에 섞여 있던 걸 분리해 본다.
    const byKind = useMemo(() => {
        const m = new Map<string, number>();
        rows.forEach((r) => {
            if (!r.outflow) return;
            const k = r.outflow_kind || '미분류';
            m.set(k, (m.get(k) ?? 0) + r.outflow);
        });
        return [...m.entries()].sort((a, b) => b[1] - a[1]);
    }, [rows]);

    const saveOpening = (v: number) => {
        setOpening(v);
        localStorage.setItem(OPENING_KEY, String(v));
    };

    const formBody = (
        <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    <Field label="날짜">
                        <input className={INPUT_CLS} onChange={(e) => set('entry_date', e.target.value)} type="date" value={form.entry_date ?? ''} />
                    </Field>
                    <Field label="입금">
                        <input className={INPUT_CLS} onChange={(e) => set('inflow', parseWon(e.target.value))} value={won(form.inflow)} />
                    </Field>
                    <Field label="출금">
                        <input className={INPUT_CLS} onChange={(e) => set('outflow', parseWon(e.target.value))} value={won(form.outflow)} />
                    </Field>
                    <Field label="출금 종류" hint="외주비 한 칸에 섞지 말 것">
                        <select className={INPUT_CLS} onChange={(e) => set('outflow_kind', e.target.value)} value={form.outflow_kind ?? ''}>
                            <option value="">선택</option>
                            {OUTFLOW_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                    </Field>
                    <Field label="메모">
                        <input className={INPUT_CLS} onChange={(e) => set('memo', e.target.value)} value={form.memo ?? ''} />
                    </Field>
                    <Field label="근거 미확인">
                        <select className={INPUT_CLS} onChange={(e) => set('unreconciled', e.target.value === '1')} value={form.unreconciled ? '1' : '0'}>
                            <option value="0">확인됨</option>
                            <option value="1">미확인</option>
                        </select>
                    </Field>
                </div>
        </>
    );

    return (
        <div className="flex min-w-0 flex-col gap-4">
            <Card
                title={`통장 원장 (입금 ${won(total.in)}원 · 출금 ${won(total.out)}원 · 잔액 ${won(opening + total.in - total.out)}원)`}
                right={
                    <>
                        <Field label="시작 잔액(이월)">
                            <input className={`${INPUT_CLS} w-36`} onChange={(e) => saveOpening(parseWon(e.target.value))} value={won(opening)} />
                        </Field>
                        <Btn onClick={() => { setEditId(''); setForm(blank()); setOpen(true); }}>+ 입출금 추가</Btn>
                    </>
                }
            >
                {byKind.length ? (
                    <div className="mb-3 flex flex-wrap gap-1.5">
                        {byKind.map(([k, v]) => (
                            <Chip key={k} tone={k === '미분류' ? 'warn' : 'muted'}>{k} {won(v)}원</Chip>
                        ))}
                    </div>
                ) : null}
                {loading ? (
                    <Empty>불러오는 중…</Empty>
                ) : withBal.length === 0 ? (
                    <Empty>등록된 내역이 없습니다</Empty>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[820px]">
                            <thead>
                                <tr>
                                    <Th>날짜</Th><Th align="right">입금</Th><Th align="right">출금</Th>
                                    <Th>종류</Th><Th align="right">잔액</Th><Th>메모</Th><Th align="center">근거</Th><Th align="right">관리</Th>
                                </tr>
                            </thead>
                            <tbody>
                                {withBal.map((r) => (
                                    <tr className="hover:bg-[#f8fafc]" key={r.id}>
                                        <Td>{r.entry_date}</Td>
                                        <Td align="right" className={r.inflow ? 'font-semibold text-[#15803d]' : ''}>{r.inflow ? won(r.inflow) : '-'}</Td>
                                        <Td align="right" className={r.outflow ? 'font-semibold text-[#b91c1c]' : ''}>{r.outflow ? won(r.outflow) : '-'}</Td>
                                        <Td>{r.outflow_kind ? <Chip tone="muted">{r.outflow_kind}</Chip> : r.outflow ? <Chip tone="warn">미분류</Chip> : '-'}</Td>
                                        <Td align="right" className="font-semibold">{won(r.balance)}</Td>
                                        <Td className="max-w-[240px] truncate">{r.memo ?? ''}</Td>
                                        <Td align="center">{r.unreconciled ? <Chip tone="warn">미확인</Chip> : ''}</Td>
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
                            <Btn kind="ghost" onClick={() => { setOpen(false); setEditId(''); setForm(blank()); }}>취소</Btn>
                            <Btn onClick={submit}>{editId ? '수정 저장' : '등록'}</Btn>
                        </>
                    }
                    onClose={() => { setOpen(false); setEditId(''); setForm(blank()); }}
                    title={editId ? '입출금 수정' : '입출금 추가'}
                >
                    {formBody}
                </Modal>
            ) : null}
        </div>
    );
}
