import { useMemo, useState } from 'react';
import {
    createJob,
    fmtPhone,
    fullPlace,
    INVOICE_STATUSES,
    LEAK_SIDOS,
    parseWon,
    shareMismatch,
    suggestShares,
    updateJob,
    won,
    type JobInput,
    type LeakInquiry,
    type LeakJob,
} from '../../api/leakErp';
import { Btn, Chip, Field, INPUT_CLS, Modal, Toggle } from './ui';

const blank: JobInput = {
    applied_rate: 30, base_amount: null, deduction_amount: 0, deduction_note: '', exception_reason: '',
    gross_amount: 0, inquiry_id: '', invoice_status: '미발행', is_rule_exception: false, note: '',
    our_share: 0, partner_share: 0, phone: '', region: '', settled_on: '', sido: '', site_name: '',
    vendor: '백준누수', vendor_phone: '', worked_on: '',
};

const fromRow = (r: LeakJob): JobInput => ({
    applied_rate: r.applied_rate ?? 30, base_amount: r.base_amount, deduction_amount: r.deduction_amount,
    deduction_note: r.deduction_note ?? '', exception_reason: r.exception_reason ?? '',
    gross_amount: r.gross_amount, inquiry_id: r.inquiry_id ?? '', invoice_status: r.invoice_status,
    is_rule_exception: r.is_rule_exception, note: r.note ?? '', our_share: r.our_share,
    partner_share: r.partner_share, phone: r.phone ?? '', region: r.region ?? '',
    settled_on: r.settled_on ?? '', sido: r.sido ?? '', site_name: r.site_name ?? '',
    vendor: r.vendor ?? '', vendor_phone: r.vendor_phone ?? '', worked_on: r.worked_on ?? '',
});

// 작업(계약) 등록/수정 모달.
//   ⚠️ 정산액은 자동계산하지 않는다 — 제안값만 보여주고 저장은 입력한 확정 금액.
export default function LeakJobForm({
    edit,
    lockPhone,
    inquiries,
    onClose,
    onSaved,
    notify,
}: {
    edit: LeakJob | null;
    lockPhone?: string;
    inquiries: LeakInquiry[];
    onClose: () => void;
    onSaved: () => void;
    notify: (m: string) => void;
}) {
    const [form, setForm] = useState<JobInput>(() => {
        if (edit) return fromRow(edit);
        const base = { ...blank, phone: lockPhone ?? '', worked_on: new Date().toISOString().slice(0, 10) };
        // 고객 상세에서 열었으면 그 고객의 최근 상담 정보로 채운다.
        const hit = lockPhone ? inquiries.find((i) => (i.phone_norm ?? '') === lockPhone.replace(/\D/g, '')) : null;
        return hit ? { ...base, inquiry_id: hit.id, region: hit.region ?? '', sido: hit.sido ?? '', site_name: hit.site_name ?? '' } : base;
    });
    const [busy, setBusy] = useState(false);
    const set = (k: keyof JobInput, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

    const sug = useMemo(
        () => suggestShares(form.gross_amount ?? 0, form.deduction_amount ?? 0, form.applied_rate ?? 0),
        [form.gross_amount, form.deduction_amount, form.applied_rate],
    );
    const diff = useMemo(
        () => shareMismatch({
            deduction_amount: form.deduction_amount ?? 0, gross_amount: form.gross_amount ?? 0,
            our_share: form.our_share ?? 0, partner_share: form.partner_share ?? 0,
        }),
        [form.gross_amount, form.deduction_amount, form.our_share, form.partner_share],
    );
    const offRule = (form.our_share ?? 0) !== sug.our || (form.partner_share ?? 0) !== sug.partner;

    const pickInquiry = (id: string) => {
        const hit = inquiries.find((i) => i.id === id);
        setForm((f) => ({
            ...f,
            inquiry_id: id,
            ...(hit ? { phone: hit.phone ?? '', region: hit.region ?? '', sido: hit.sido ?? '', site_name: hit.site_name ?? '' } : {}),
        }));
    };

    const submit = async () => {
        const payload: JobInput = { ...form, base_amount: form.base_amount ?? sug.base, is_rule_exception: offRule || diff !== 0 };
        if (payload.is_rule_exception && !(payload.exception_reason ?? '').trim()) {
            return notify('!제안값과 다릅니다 — 예외 사유를 입력하세요');
        }
        setBusy(true);
        const { error } = edit ? await updateJob(edit.id, payload) : await createJob(payload);
        setBusy(false);
        if (error) return notify(`!${error.message}`);
        notify(edit ? '수정했습니다' : '작업을 등록했습니다');
        onSaved();
        onClose();
    };

    const contracted = inquiries.filter((i) => i.contracted);

    return (
        <Modal
            footer={
                <>
                    <Btn kind="ghost" onClick={onClose}>취소</Btn>
                    <Btn disabled={busy} onClick={submit}>{edit ? '수정 저장' : '등록'}</Btn>
                </>
            }
            onClose={onClose}
            title={edit ? '작업 수정' : '작업 추가'}
            wide
        >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Field label="상담 연결" hint="선택하면 지역·현장·연락처 자동 입력">
                    <select className={INPUT_CLS} onChange={(e) => pickInquiry(e.target.value)} value={form.inquiry_id ?? ''}>
                        <option value="">연결 안 함</option>
                        {contracted.map((i) => (
                            <option key={i.id} value={i.id}>
                                {fullPlace(i.sido, i.region, i.site_name)} · {fmtPhone(i.phone)}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="진행일자">
                    <input className={INPUT_CLS} onChange={(e) => set('worked_on', e.target.value)} type="date" value={form.worked_on ?? ''} />
                </Field>
                <Field label="연락처" hint={lockPhone ? '이 고객으로 고정' : undefined}>
                    <input className={INPUT_CLS} disabled={!!lockPhone} onChange={(e) => set('phone', e.target.value)} value={form.phone ?? ''} />
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
                <Field label="집행 업체">
                    <input className={INPUT_CLS} onChange={(e) => set('vendor', e.target.value)} value={form.vendor ?? ''} />
                </Field>
                <Field label="업체 연락처" hint="타업체 진행 시">
                    <input className={INPUT_CLS} onChange={(e) => set('vendor_phone', e.target.value)} value={form.vendor_phone ?? ''} />
                </Field>
            </div>

            {/* ── 정산 ── */}
            <div className="mt-4 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#0f172a]">정산</span>
                    <span className="text-[11px] text-[#94a3b8]">제안값은 참고용 — 저장되는 건 입력한 확정 금액입니다</span>
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
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
                    <Btn kind="ghost" onClick={() => setForm((f) => ({ ...f, base_amount: sug.base, our_share: sug.our, partner_share: sug.partner }))}>
                        제안값 채우기
                    </Btn>
                    {diff !== 0 ? (
                        <Chip tone="warn">합계 불일치 — (든든+백준) − (결제−공제) = {diff > 0 ? '+' : ''}{won(diff)}원</Chip>
                    ) : (
                        <Chip tone="ok">합계 일치</Chip>
                    )}
                    {offRule ? <Chip tone="warn">제안값과 다름 — 예외 사유 필요</Chip> : null}
                </div>
                {offRule || diff !== 0 ? (
                    <div className="mt-2">
                        <Field label="예외 사유 *" hint="왜 이 금액인지 남겨야 나중에 근거를 알 수 있습니다">
                            <input className={INPUT_CLS} onChange={(e) => set('exception_reason', e.target.value)} value={form.exception_reason ?? ''} />
                        </Field>
                    </div>
                ) : null}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
                <Field label="정산날짜">
                    <input className={INPUT_CLS} onChange={(e) => set('settled_on', e.target.value)} type="date" value={form.settled_on ?? ''} />
                </Field>
                <Field label="계산서">
                    <select className={INPUT_CLS} onChange={(e) => set('invoice_status', e.target.value)} value={form.invoice_status ?? '미발행'}>
                        {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                </Field>
                <Field label="비고">
                    <input className={INPUT_CLS} onChange={(e) => set('note', e.target.value)} value={form.note ?? ''} />
                </Field>
            </div>
        </Modal>
    );
}
