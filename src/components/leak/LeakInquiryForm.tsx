import { useMemo, useState } from 'react';
import {
    createInquiry,
    LEAK_COUNSELORS,
    LEAK_SIDOS,
    LEAK_SOURCES,
    updateInquiry,
    type InquiryInput,
    type LeakInquiry,
} from '../../api/leakErp';
import { Btn, Field, INPUT_CLS, Modal, Toggle } from './ui';

const blank: InquiryInput = {
    contracted: false, counselor: '', inquired_on: '', leak_type: '', note: '',
    phone: '', region: '', sido: '', site_name: '', source: '',
};

const fromRow = (r: LeakInquiry): InquiryInput => ({
    contracted: r.contracted, counselor: r.counselor ?? '', inquired_on: r.inquired_on ?? '',
    leak_type: r.leak_type ?? '', note: r.note ?? '', phone: r.phone ?? '',
    region: r.region ?? '', sido: r.sido ?? '', site_name: r.site_name ?? '', source: r.source ?? '',
});

// 상담 등록/수정 모달. edit=null 이면 신규.
//   lockPhone: 고객 상세에서 '이 고객으로 추가'할 때 연락처 고정.
export default function LeakInquiryForm({
    edit,
    lockPhone,
    known,
    onClose,
    onSaved,
    notify,
}: {
    edit: LeakInquiry | null;
    lockPhone?: string;
    known: LeakInquiry[];
    onClose: () => void;
    onSaved: () => void;
    notify: (m: string) => void;
}) {
    const [form, setForm] = useState<InquiryInput>(() =>
        edit ? fromRow(edit) : { ...blank, inquired_on: new Date().toISOString().slice(0, 10), phone: lockPhone ?? '' },
    );
    const [busy, setBusy] = useState(false);
    const set = (k: keyof InquiryInput, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

    // 기본 3인 + 기존 데이터에만 있는 이름도 유지 — 수정 시 값이 조용히 지워지지 않게.
    const counselors = useMemo(() => {
        const extra = known.map((r) => (r.counselor ?? '').trim()).filter((c) => c && !LEAK_COUNSELORS.includes(c as never));
        const cur = (form.counselor ?? '').trim();
        if (cur && !LEAK_COUNSELORS.includes(cur as never)) extra.push(cur);
        return [...LEAK_COUNSELORS, ...new Set(extra)];
    }, [known, form.counselor]);

    const submit = async () => {
        setBusy(true);
        const { error } = edit ? await updateInquiry(edit.id, form) : await createInquiry(form);
        setBusy(false);
        if (error) return notify(`!${error.message}`);
        notify(edit ? '수정했습니다' : '상담을 등록했습니다');
        onSaved();
        onClose();
    };

    return (
        <Modal
            footer={
                <>
                    <Btn kind="ghost" onClick={onClose}>취소</Btn>
                    <Btn disabled={busy} onClick={submit}>{edit ? '수정 저장' : '등록'}</Btn>
                </>
            }
            onClose={onClose}
            title={edit ? '상담 수정' : '상담 접수 추가'}
        >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Field label="문의일">
                    <input className={INPUT_CLS} onChange={(e) => set('inquired_on', e.target.value)} type="date" value={form.inquired_on ?? ''} />
                </Field>
                <Field label="상담자">
                    <select className={INPUT_CLS} onChange={(e) => set('counselor', e.target.value)} value={form.counselor ?? ''}>
                        <option value="">선택</option>
                        {counselors.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                </Field>
                <Field label="연락처" hint={lockPhone ? '이 고객으로 고정' : undefined}>
                    <input
                        className={INPUT_CLS}
                        disabled={!!lockPhone}
                        onChange={(e) => set('phone', e.target.value)}
                        placeholder="010-0000-0000"
                        value={form.phone ?? ''}
                    />
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
            <div className="mt-3">
                <Field label="비고">
                    <input className={INPUT_CLS} onChange={(e) => set('note', e.target.value)} value={form.note ?? ''} />
                </Field>
            </div>
        </Modal>
    );
}
