import { useEffect, useMemo, useState } from 'react';
import {
    createJob,
    deleteJob,
    fmtPhone,
    fullPlace,
    INVOICE_STATUSES,
    LEAK_SIDOS,
    listInquiries,
    listJobs,
    parseWon,
    shareMismatch,
    suggestShares,
    updateJob,
    won,
    type JobInput,
    type LeakInquiry,
    type LeakJob,
} from '../../api/leakErp';
import { Btn, Card, Chip, Empty, Field, INPUT_CLS, Td, Th, Toggle } from './ui';

const blank: JobInput = {
    applied_rate: 30, base_amount: null, deduction_amount: 0, deduction_note: '', exception_reason: '',
    gross_amount: 0, inquiry_id: '', invoice_status: '미발행', is_rule_exception: false, note: '',
    our_share: 0, partner_share: 0, phone: '', region: '', settled_on: '', sido: '', site_name: '',
    vendor: '백준누수', vendor_phone: '', worked_on: '',
};

export default function LeakJobsTab({ notify }: { notify: (m: string) => void }) {
    const [rows, setRows] = useState<LeakJob[]>([]);
    const [inquiries, setInquiries] = useState<LeakInquiry[]>([]);
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState<JobInput>(blank);
    const [editId, setEditId] = useState('');
    const [q, setQ] = useState('');

    const load = async () => {
        setLoading(true);
        const [j, i] = await Promise.all([listJobs(), listInquiries()]);
        if (j.error) notify(`!불러오기 실패: ${j.error.message}`);
        setRows(j.data);
        setInquiries(i.data);
        setLoading(false);
    };
    useEffect(() => {
        void load();
    }, []);

    const set = (k: keyof JobInput, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

    // 제안값 — 저장되는 값이 아니라 입력 보조. 실제 저장은 사용자가 확정한 our/partner.
    const sug = useMemo(
        () => suggestShares(form.gross_amount ?? 0, form.deduction_amount ?? 0, form.applied_rate ?? 0),
        [form.gross_amount, form.deduction_amount, form.applied_rate],
    );
    // 합계 검산 — (든든+백준) − (결제−공제). 0이 아니면 경고.
    const diff = useMemo(
        () => shareMismatch({
            deduction_amount: form.deduction_amount ?? 0, gross_amount: form.gross_amount ?? 0,
            our_share: form.our_share ?? 0, partner_share: form.partner_share ?? 0,
        }),
        [form.gross_amount, form.deduction_amount, form.our_share, form.partner_share],
    );
    const offRule = (form.our_share ?? 0) !== sug.our || (form.partner_share ?? 0) !== sug.partner;

    const applySuggestion = () => {
        setForm((f) => ({ ...f, base_amount: sug.base, our_share: sug.our, partner_share: sug.partner }));
    };

    const submit = async () => {
        // 규칙에서 벗어났는데 사유가 없으면 막는다 — 나중에 왜 이 금액인지 알 수 없게 되는 걸 방지.
        const payload: JobInput = { ...form, base_amount: form.base_amount ?? sug.base, is_rule_exception: offRule || diff !== 0 };
        if (payload.is_rule_exception && !(payload.exception_reason ?? '').trim()) {
            return notify('!제안값과 다릅니다 — 예외 사유를 입력하세요');
        }
        const { error } = editId ? await updateJob(editId, payload) : await createJob(payload);
        if (error) return notify(`!${error.message}`);
        notify(editId ? '수정했습니다' : '작업을 등록했습니다');
        setForm(blank);
        setEditId('');
        void load();
    };

    const startEdit = (r: LeakJob) => {
        setEditId(r.id);
        setForm({
            applied_rate: r.applied_rate ?? 30, base_amount: r.base_amount, deduction_amount: r.deduction_amount,
            deduction_note: r.deduction_note ?? '', exception_reason: r.exception_reason ?? '',
            gross_amount: r.gross_amount, inquiry_id: r.inquiry_id ?? '', invoice_status: r.invoice_status,
            is_rule_exception: r.is_rule_exception, note: r.note ?? '', our_share: r.our_share,
            partner_share: r.partner_share, phone: r.phone ?? '', region: r.region ?? '',
            settled_on: r.settled_on ?? '', sido: r.sido ?? '', site_name: r.site_name ?? '',
            vendor: r.vendor ?? '', vendor_phone: r.vendor_phone ?? '', worked_on: r.worked_on ?? '',
        });
        window.scrollTo({ behavior: 'smooth', top: 0 });
    };

    const remove = async (r: LeakJob) => {
        if (!window.confirm(`작업 삭제 — ${fullPlace(r.sido, r.region, r.site_name)}\n되돌릴 수 없습니다. 진행할까요?`)) return;
        const { error } = await deleteJob(r.id);
        if (error) return notify(`!${error.message}`);
        notify('삭제했습니다');
        void load();
    };

    // 상담 선택 시 현장/연락처 자동 채움(연락처가 두 표를 잇는 키).
    const pickInquiry = (id: string) => {
        const hit = inquiries.find((i) => i.id === id);
        setForm((f) => ({
            ...f,
            inquiry_id: id,
            ...(hit
                ? { phone: hit.phone ?? '', region: hit.region ?? '', sido: hit.sido ?? '', site_name: hit.site_name ?? '' }
                : {}),
        }));
    };

    const filtered = useMemo(() => {
        const s = q.trim().toLowerCase();
        if (!s) return rows;
        return rows.filter((r) =>
            [r.sido, r.region, r.site_name, r.phone, r.vendor, r.note, r.deduction_note]
                .some((v) => (v || '').toLowerCase().includes(s)),
        );
    }, [rows, q]);

    const sum = useMemo(
        () => filtered.reduce(
            (a, r) => ({ gross: a.gross + r.gross_amount, our: a.our + r.our_share, partner: a.partner + r.partner_share }),
            { gross: 0, our: 0, partner: 0 },
        ),
        [filtered],
    );

    const contracted = inquiries.filter((i) => i.contracted);

    return (
        <div className="flex flex-col gap-4">
            <Card
                title={editId ? '작업 수정' : '작업 등록'}
                right={editId ? <Btn kind="ghost" onClick={() => { setEditId(''); setForm(blank); }}>취소</Btn> : null}
            >
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
                    <Field label="상담 연결" hint="선택하면 현장·연락처 자동 입력">
                        <select className={INPUT_CLS} onChange={(e) => pickInquiry(e.target.value)} value={form.inquiry_id ?? ''}>
                            <option value="">연결 안 함</option>
                            {contracted.map((i) => (
                                <option key={i.id} value={i.id}>
                                    {fullPlace(i.sido, i.region, i.site_name)} · {fmtPhone(i.phone)}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label="지역">
                        <Toggle onChange={(v) => set('sido', v)} options={LEAK_SIDOS} value={form.sido ?? ''} />
                    </Field>
                    <Field label="시/구/동">
                        <input className={INPUT_CLS} onChange={(e) => set('region', e.target.value)} placeholder="수원시 팔달구" value={form.region ?? ''} />
                    </Field>
                    <Field label="현장">
                        <input className={INPUT_CLS} onChange={(e) => set('site_name', e.target.value)} placeholder="아파트·상가명" value={form.site_name ?? ''} />
                    </Field>
                    <Field label="연락처">
                        <input className={INPUT_CLS} onChange={(e) => set('phone', e.target.value)} value={form.phone ?? ''} />
                    </Field>
                    <Field label="진행일자">
                        <input className={INPUT_CLS} onChange={(e) => set('worked_on', e.target.value)} type="date" value={form.worked_on ?? ''} />
                    </Field>
                    <Field label="집행 업체">
                        <input className={INPUT_CLS} onChange={(e) => set('vendor', e.target.value)} value={form.vendor ?? ''} />
                    </Field>
                    <Field label="업체 연락처" hint="타업체 진행 시">
                        <input className={INPUT_CLS} onChange={(e) => set('vendor_phone', e.target.value)} value={form.vendor_phone ?? ''} />
                    </Field>
                </div>

                {/* ── 정산 ── */}
                <div className="mt-4 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-[#0f172a]">정산</span>
                        <span className="text-[11px] text-[#94a3b8]">제안값은 참고용입니다 — 저장되는 건 입력한 확정 금액입니다</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                        <Field label="결제금액 (VAT 포함)">
                            <input className={INPUT_CLS} onChange={(e) => set('gross_amount', parseWon(e.target.value))} value={won(form.gross_amount)} />
                        </Field>
                        <Field label="공제액 (자재비 등)">
                            <input className={INPUT_CLS} onChange={(e) => set('deduction_amount', parseWon(e.target.value))} value={won(form.deduction_amount)} />
                        </Field>
                        <Field label="공제 사유">
                            <input className={INPUT_CLS} onChange={(e) => set('deduction_note', e.target.value)} placeholder="자재비 6만원 등" value={form.deduction_note ?? ''} />
                        </Field>
                        <Field label="적용 요율 (%)" hint={`기준금액 ${won(sug.base)}원`}>
                            <input className={INPUT_CLS} onChange={(e) => set('applied_rate', Number(e.target.value) || 0)} type="number" value={form.applied_rate ?? 0} />
                        </Field>
                        <Field label="든든 정산액 (확정)" hint={`제안 ${won(sug.our)}원`}>
                            <input className={INPUT_CLS} onChange={(e) => set('our_share', parseWon(e.target.value))} value={won(form.our_share)} />
                        </Field>
                        <Field label="백준 정산액 (확정)" hint={`제안 ${won(sug.partner)}원`}>
                            <input className={INPUT_CLS} onChange={(e) => set('partner_share', parseWon(e.target.value))} value={won(form.partner_share)} />
                        </Field>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Btn kind="ghost" onClick={applySuggestion}>제안값 채우기</Btn>
                        {diff !== 0 ? (
                            <Chip tone="warn">
                                합계 불일치 — (든든+백준) − (결제−공제) = {diff > 0 ? '+' : ''}{won(diff)}원
                            </Chip>
                        ) : (
                            <Chip tone="ok">합계 일치</Chip>
                        )}
                        {offRule ? <Chip tone="warn">제안값과 다름 — 예외 사유 필요</Chip> : null}
                    </div>
                    {offRule || diff !== 0 ? (
                        <div className="mt-2">
                            <Field label="예외 사유 *" hint="왜 이 금액인지 남겨야 나중에 근거를 알 수 있습니다">
                                <input className={`${INPUT_CLS} md:w-[32rem]`} onChange={(e) => set('exception_reason', e.target.value)} value={form.exception_reason ?? ''} />
                            </Field>
                        </div>
                    ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-3">
                    <Field label="정산날짜">
                        <input className={INPUT_CLS} onChange={(e) => set('settled_on', e.target.value)} type="date" value={form.settled_on ?? ''} />
                    </Field>
                    <Field label="계산서">
                        <select className={INPUT_CLS} onChange={(e) => set('invoice_status', e.target.value)} value={form.invoice_status ?? '미발행'}>
                            {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </Field>
                    <Field label="비고">
                        <input className={`${INPUT_CLS} md:w-80`} onChange={(e) => set('note', e.target.value)} value={form.note ?? ''} />
                    </Field>
                    <Btn onClick={submit}>{editId ? '수정 저장' : '등록'}</Btn>
                </div>
            </Card>

            <Card
                title={`작업 목록 (${filtered.length}건 · 결제 ${won(sum.gross)}원 · 든든 ${won(sum.our)}원 · 백준 ${won(sum.partner)}원)`}
                right={<input className={`${INPUT_CLS} w-52`} onChange={(e) => setQ(e.target.value)} placeholder="현장·업체 검색" value={q} />}
            >
                {loading ? (
                    <Empty>불러오는 중…</Empty>
                ) : filtered.length === 0 ? (
                    <Empty>{rows.length ? '검색 결과가 없습니다' : '등록된 작업이 없습니다'}</Empty>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1100px]">
                            <thead>
                                <tr>
                                    <Th>진행일</Th><Th>지역</Th><Th>현장</Th><Th>연락처</Th><Th align="right">결제금액</Th>
                                    <Th align="right">공제</Th><Th align="right">든든</Th><Th align="right">백준</Th>
                                    <Th align="center">검산</Th><Th>정산일</Th><Th align="center">계산서</Th><Th align="right">관리</Th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((r) => {
                                    const d = shareMismatch(r);
                                    return (
                                        <tr className="hover:bg-[#f8fafc]" key={r.id}>
                                            <Td>{r.worked_on ?? '-'}</Td>
                                            <Td className="font-semibold">
                                                {r.sido ? <Chip tone="info">{r.sido}</Chip> : null} {r.region ?? ''}
                                            </Td>
                                            <Td>{r.site_name ?? '-'}</Td>
                                            <Td>{fmtPhone(r.phone)}</Td>
                                            <Td align="right">{won(r.gross_amount)}</Td>
                                            <Td align="right" className={r.deduction_amount ? 'text-[#b45309]' : ''}>
                                                {r.deduction_amount ? won(r.deduction_amount) : '-'}
                                            </Td>
                                            <Td align="right" className="font-semibold text-[#1e40af]">{won(r.our_share)}</Td>
                                            <Td align="right">{won(r.partner_share)}</Td>
                                            <Td align="center">
                                                {d === 0 ? <Chip tone="ok">OK</Chip> : <Chip tone="warn">{d > 0 ? '+' : ''}{won(d)}</Chip>}
                                            </Td>
                                            <Td>{r.settled_on ?? '-'}</Td>
                                            <Td align="center">
                                                {r.invoice_status === '발행완료' ? <Chip tone="ok">발행완료</Chip> : <Chip tone="muted">미발행</Chip>}
                                            </Td>
                                            <Td align="right">
                                                <div className="flex justify-end gap-1">
                                                    <button className="rounded px-2 py-1 text-xs font-semibold text-[#1e40af] hover:bg-[#eff6ff]" onClick={() => startEdit(r)} type="button">수정</button>
                                                    <button className="rounded px-2 py-1 text-xs font-semibold text-[#b91c1c] hover:bg-[#fef2f2]" onClick={() => remove(r)} type="button">삭제</button>
                                                </div>
                                            </Td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
}
