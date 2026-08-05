import { useEffect, useMemo, useState } from 'react';
import {
    createInquiry,
    deleteInquiry,
    fmtPhone,
    LEAK_COUNSELORS,
    LEAK_SOURCES,
    listInquiries,
    updateInquiry,
    type InquiryInput,
    type LeakInquiry,
} from '../../api/leakErp';
import { Btn, Card, Chip, Empty, Field, INPUT_CLS, Td, Th } from './ui';

const blank: InquiryInput = {
    counselor: '', region: '', phone: '', inquired_on: '', leak_type: '', contracted: false, source: '', note: '',
};

export default function LeakInquiriesTab({ notify }: { notify: (m: string) => void }) {
    const [rows, setRows] = useState<LeakInquiry[]>([]);
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState<InquiryInput>(blank);
    const [editId, setEditId] = useState<string>('');
    const [q, setQ] = useState('');
    const [onlyContracted, setOnlyContracted] = useState(false);

    const load = async () => {
        setLoading(true);
        const { data, error } = await listInquiries();
        if (error) notify(`!불러오기 실패: ${error.message}`);
        setRows(data);
        setLoading(false);
    };
    useEffect(() => {
        void load();
    }, []);

    const set = (k: keyof InquiryInput, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

    const submit = async () => {
        const { error } = editId ? await updateInquiry(editId, form) : await createInquiry(form);
        if (error) return notify(`!${error.message}`);
        notify(editId ? '수정했습니다' : '상담을 등록했습니다');
        setForm(blank);
        setEditId('');
        void load();
    };

    const startEdit = (r: LeakInquiry) => {
        setEditId(r.id);
        setForm({
            counselor: r.counselor ?? '', region: r.region ?? '', phone: r.phone ?? '',
            inquired_on: r.inquired_on ?? '', leak_type: r.leak_type ?? '',
            contracted: r.contracted, source: r.source ?? '', note: r.note ?? '',
        });
        window.scrollTo({ behavior: 'smooth', top: 0 });
    };

    const remove = async (r: LeakInquiry) => {
        if (!window.confirm(`상담 삭제 — ${r.region || fmtPhone(r.phone)}\n되돌릴 수 없습니다. 진행할까요?`)) return;
        const { error } = await deleteInquiry(r.id);
        if (error) return notify(`!${error.message}`);
        notify('삭제했습니다');
        void load();
    };

    const filtered = useMemo(() => {
        const s = q.trim().toLowerCase();
        return rows.filter((r) => {
            if (onlyContracted && !r.contracted) return false;
            if (!s) return true;
            return [r.region, r.counselor, r.phone, r.leak_type, r.source, r.note]
                .some((v) => (v || '').toLowerCase().includes(s));
        });
    }, [rows, q, onlyContracted]);

    // 기본 3인 + 기존 데이터에만 있는 이름(과거 담당자 등)도 살려둔다 — 수정 시 값이 조용히 지워지지 않게.
    const counselorOptions = useMemo(() => {
        const extra = rows.map((r) => (r.counselor ?? '').trim()).filter((c) => c && !LEAK_COUNSELORS.includes(c as never));
        const cur = (form.counselor ?? '').trim();
        if (cur && !LEAK_COUNSELORS.includes(cur as never)) extra.push(cur);
        return [...LEAK_COUNSELORS, ...new Set(extra)];
    }, [rows, form.counselor]);

    const stat = useMemo(() => {
        const total = rows.length;
        const done = rows.filter((r) => r.contracted).length;
        return { done, rate: total ? Math.round((done / total) * 100) : 0, total };
    }, [rows]);

    return (
        <div className="flex flex-col gap-4">
            <Card
                title={editId ? '상담 수정' : '상담 접수 등록'}
                right={editId ? <Btn kind="ghost" onClick={() => { setEditId(''); setForm(blank); }}>취소</Btn> : null}
            >
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
                    <Field label="상담자">
                        <select className={INPUT_CLS} onChange={(e) => set('counselor', e.target.value)} value={form.counselor ?? ''}>
                            <option value="">선택</option>
                            {counselorOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </Field>
                    <Field label="지역/현장">
                        <input className={INPUT_CLS} onChange={(e) => set('region', e.target.value)} value={form.region ?? ''} />
                    </Field>
                    <Field label="연락처">
                        <input className={INPUT_CLS} onChange={(e) => set('phone', e.target.value)} placeholder="010-0000-0000" value={form.phone ?? ''} />
                    </Field>
                    <Field label="문의일">
                        <input className={INPUT_CLS} onChange={(e) => set('inquired_on', e.target.value)} type="date" value={form.inquired_on ?? ''} />
                    </Field>
                    <Field label="누수 종류">
                        <input className={INPUT_CLS} onChange={(e) => set('leak_type', e.target.value)} placeholder="욕실 누수 등" value={form.leak_type ?? ''} />
                    </Field>
                    <Field label="유입경로">
                        <select className={INPUT_CLS} onChange={(e) => set('source', e.target.value)} value={form.source ?? ''}>
                            <option value="">선택</option>
                            {LEAK_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </Field>
                    <Field label="계약 성사">
                        <select className={INPUT_CLS} onChange={(e) => set('contracted', e.target.value === '1')} value={form.contracted ? '1' : '0'}>
                            <option value="0">미진행</option>
                            <option value="1">진행</option>
                        </select>
                    </Field>
                </div>
                <div className="mt-3 flex items-end gap-3">
                    <Field label="비고">
                        <input className={`${INPUT_CLS} md:w-96`} onChange={(e) => set('note', e.target.value)} value={form.note ?? ''} />
                    </Field>
                    <Btn onClick={submit}>{editId ? '수정 저장' : '등록'}</Btn>
                </div>
            </Card>

            <Card
                title={`상담 목록 (${filtered.length}건 / 전체 ${stat.total}건 · 성사 ${stat.done}건 · ${stat.rate}%)`}
                right={
                    <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-[#64748b]">
                            <input checked={onlyContracted} onChange={(e) => setOnlyContracted(e.target.checked)} type="checkbox" />
                            성사만
                        </label>
                        <input className={`${INPUT_CLS} w-52`} onChange={(e) => setQ(e.target.value)} placeholder="지역·연락처·종류 검색" value={q} />
                    </div>
                }
            >
                {loading ? (
                    <Empty>불러오는 중…</Empty>
                ) : filtered.length === 0 ? (
                    <Empty>{rows.length ? '검색 결과가 없습니다' : '등록된 상담이 없습니다'}</Empty>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px]">
                            <thead>
                                <tr>
                                    <Th>문의일</Th><Th>상담자</Th><Th>지역/현장</Th><Th>연락처</Th>
                                    <Th>누수 종류</Th><Th>유입</Th><Th align="center">계약</Th><Th>비고</Th><Th align="right">관리</Th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((r) => (
                                    <tr className="hover:bg-[#f8fafc]" key={r.id}>
                                        <Td>{r.inquired_on ?? '-'}</Td>
                                        <Td>{r.counselor ?? '-'}</Td>
                                        <Td className="font-semibold">{r.region ?? '-'}</Td>
                                        <Td>{fmtPhone(r.phone)}</Td>
                                        <Td>{r.leak_type ?? '-'}</Td>
                                        <Td>{r.source ? <Chip tone="info">{r.source}</Chip> : '-'}</Td>
                                        <Td align="center">{r.contracted ? <Chip tone="ok">진행</Chip> : <Chip tone="muted">미진행</Chip>}</Td>
                                        <Td className="max-w-[220px] truncate">{r.note ?? ''}</Td>
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
        </div>
    );
}
