import { supabase } from '../lib/supabase';

// 누수탐지 ERP — 상담/작업·정산/통장원장/외주발주.
//   ⚠️ 정산액(our_share·partner_share)은 절대 자동계산하지 않는다. 화면에서 "제안값"만 보여주고
//      저장은 입력값 그대로. 기존 11건 중 8건이 30/70 규칙 이탈이고 일부는 계산서 발행완료라,
//      재계산하면 발행 금액과 어긋난다. (docs/누수탐지-ERP-설계.md §2-2)

// 연락처 정규화 — 상담↔작업을 잇는 유일한 키. 원본에 '010 -1234-5678'(공백)·유선번호가 섞여 있다.
export const normPhone = (v: string | null | undefined) => (v || '').replace(/\D/g, '');
// 표시용 하이픈 포맷(휴대폰 11자리 / 지역번호 10자리 등 흔한 형태만).
export const fmtPhone = (v: string | null | undefined) => {
    const d = normPhone(v);
    if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
    if (d.length === 10) return d.startsWith('02') ? `02-${d.slice(2, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    return v || '';
};
export const won = (n: number | null | undefined) => (Number(n) || 0).toLocaleString('ko-KR');
// "1,900,000원" / "1900000" 등 자유 입력 → 정수. 음수(환불) 허용.
export const parseWon = (v: string | number | null | undefined): number => {
    if (typeof v === 'number') return Math.round(v);
    const s = (v ?? '').toString().replace(/[^\d-]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n) : 0;
};

// 상담 담당자 — 누수탐지 ERP 사용 4인 중 상담을 받는 3인.
export const LEAK_COUNSELORS = ['김종인', '송민경', '조재현'] as const;
export const LEAK_SOURCES = ['카페', '블로그', '플레이스', '지인소개', '기타'] as const;
export const OUTFLOW_KINDS = ['외주비', '급여', '세금', '대표인출', '기타'] as const;
export const INVOICE_STATUSES = ['미발행', '발행완료'] as const;

export type LeakInquiry = {
    id: string;
    created_at: string;
    updated_at: string | null;
    counselor: string | null;
    region: string | null;
    phone: string | null;
    phone_norm: string | null;
    inquired_on: string | null;
    leak_type: string | null;
    contracted: boolean;
    source: string | null;
    note: string | null;
};

export type LeakJob = {
    id: string;
    created_at: string;
    updated_at: string | null;
    inquiry_id: string | null;
    site_name: string | null;
    phone: string | null;
    phone_norm: string | null;
    worked_on: string | null;
    gross_amount: number;
    vendor: string | null;
    vendor_phone: string | null;
    deduction_amount: number;
    deduction_note: string | null;
    base_amount: number | null;
    applied_rate: number | null;
    our_share: number;
    partner_share: number;
    is_rule_exception: boolean;
    exception_reason: string | null;
    settled_on: string | null;
    invoice_status: string;
    note: string | null;
};

export type LeakLedger = {
    id: string;
    created_at: string;
    entry_date: string;
    inflow: number;
    outflow: number;
    outflow_kind: string | null;
    job_id: string | null;
    memo: string | null;
    unreconciled: boolean;
};

export type LeakOutsourcing = {
    id: string;
    created_at: string;
    item_name: string | null;
    marketing_type: string | null;
    vendor: string | null;
    started_on: string | null;
    ended_on: string | null;
    amount: number;
    amount_vat: number;
    entry_kind: string;
    settled_to_vendor: boolean;
    settled_final: boolean;
    note: string | null;
};

const trimOrNull = (v: string | null | undefined) => (v ?? '').trim() || null;
const nowIso = () => new Date().toISOString();

// ── 상담/문의 ────────────────────────────────────────────────────────────
export async function listInquiries(limit = 1000) {
    const { data, error } = await supabase
        .from('leak_inquiries')
        .select('*')
        .order('inquired_on', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit)
        .returns<LeakInquiry[]>();
    return { data: data ?? [], error };
}

export type InquiryInput = Partial<Omit<LeakInquiry, 'id' | 'created_at' | 'updated_at' | 'phone_norm'>>;

function inquiryPayload(input: InquiryInput) {
    return {
        counselor: trimOrNull(input.counselor),
        region: trimOrNull(input.region),
        phone: trimOrNull(input.phone),
        phone_norm: normPhone(input.phone) || null,
        inquired_on: input.inquired_on || null,
        leak_type: trimOrNull(input.leak_type),
        contracted: !!input.contracted,
        source: trimOrNull(input.source),
        note: trimOrNull(input.note),
    };
}

export async function createInquiry(input: InquiryInput) {
    if (!trimOrNull(input.region) && !normPhone(input.phone)) {
        return { error: { message: '지역 또는 연락처 중 하나는 입력하세요' } };
    }
    const { error } = await supabase.from('leak_inquiries').insert(inquiryPayload(input));
    return { error };
}

export async function updateInquiry(id: string, input: InquiryInput) {
    const { error } = await supabase
        .from('leak_inquiries')
        .update({ ...inquiryPayload(input), updated_at: nowIso() })
        .eq('id', id);
    return { error };
}

export async function deleteInquiry(id: string) {
    const { error } = await supabase.from('leak_inquiries').delete().eq('id', id);
    return { error };
}

// ── 작업 + 정산 ──────────────────────────────────────────────────────────
export async function listJobs(limit = 1000) {
    const { data, error } = await supabase
        .from('leak_jobs')
        .select('*')
        .order('worked_on', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit)
        .returns<LeakJob[]>();
    return { data: data ?? [], error };
}

export type JobInput = Partial<Omit<LeakJob, 'id' | 'created_at' | 'updated_at' | 'phone_norm'>>;

function jobPayload(input: JobInput) {
    return {
        inquiry_id: input.inquiry_id || null,
        site_name: trimOrNull(input.site_name),
        phone: trimOrNull(input.phone),
        phone_norm: normPhone(input.phone) || null,
        worked_on: input.worked_on || null,
        gross_amount: Math.round(input.gross_amount ?? 0),
        vendor: trimOrNull(input.vendor),
        vendor_phone: trimOrNull(input.vendor_phone),
        deduction_amount: Math.round(input.deduction_amount ?? 0),
        deduction_note: trimOrNull(input.deduction_note),
        base_amount: input.base_amount == null ? null : Math.round(input.base_amount),
        applied_rate: input.applied_rate == null ? null : Number(input.applied_rate),
        our_share: Math.round(input.our_share ?? 0),
        partner_share: Math.round(input.partner_share ?? 0),
        is_rule_exception: !!input.is_rule_exception,
        exception_reason: trimOrNull(input.exception_reason),
        settled_on: input.settled_on || null,
        invoice_status: input.invoice_status || '미발행',
        note: trimOrNull(input.note),
    };
}

export async function createJob(input: JobInput) {
    if (!trimOrNull(input.site_name)) return { error: { message: '현장(지역)을 입력하세요' } };
    const { error } = await supabase.from('leak_jobs').insert(jobPayload(input));
    return { error };
}

export async function updateJob(id: string, input: JobInput) {
    const { error } = await supabase
        .from('leak_jobs')
        .update({ ...jobPayload(input), updated_at: nowIso() })
        .eq('id', id);
    return { error };
}

export async function deleteJob(id: string) {
    const { error } = await supabase.from('leak_jobs').delete().eq('id', id);
    return { error };
}

// 정산 "제안값" — 저장용이 아니라 입력 보조. 실제 저장은 사용자가 확정한 값.
export function suggestShares(gross: number, deduction: number, ratePct: number) {
    const base = Math.max(0, (gross || 0) - (deduction || 0));
    const our = Math.round((base * (ratePct || 0)) / 100);
    return { base, our, partner: base - our };
}

// 합계 검산 — 든든+백준 이 기준금액과 맞는지. UI 경고용.
export function shareMismatch(job: Pick<LeakJob, 'gross_amount' | 'deduction_amount' | 'our_share' | 'partner_share'>) {
    const base = (job.gross_amount || 0) - (job.deduction_amount || 0);
    return (job.our_share || 0) + (job.partner_share || 0) - base;
}

// ── 통장 원장 ────────────────────────────────────────────────────────────
export async function listLedger(limit = 2000) {
    const { data, error } = await supabase
        .from('leak_ledger')
        .select('*')
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit)
        .returns<LeakLedger[]>();
    return { data: data ?? [], error };
}

export type LedgerInput = Partial<Omit<LeakLedger, 'id' | 'created_at'>>;

function ledgerPayload(input: LedgerInput) {
    return {
        entry_date: input.entry_date || new Date().toISOString().slice(0, 10),
        inflow: Math.round(input.inflow ?? 0),
        outflow: Math.round(input.outflow ?? 0),
        outflow_kind: trimOrNull(input.outflow_kind),
        job_id: input.job_id || null,
        memo: trimOrNull(input.memo),
        unreconciled: !!input.unreconciled,
    };
}

export async function createLedger(input: LedgerInput) {
    if (!input.entry_date) return { error: { message: '날짜를 입력하세요' } };
    if (!(input.inflow ?? 0) && !(input.outflow ?? 0)) return { error: { message: '입금 또는 출금 금액을 입력하세요' } };
    const { error } = await supabase.from('leak_ledger').insert(ledgerPayload(input));
    return { error };
}

export async function updateLedger(id: string, input: LedgerInput) {
    const { error } = await supabase.from('leak_ledger').update(ledgerPayload(input)).eq('id', id);
    return { error };
}

export async function deleteLedger(id: string) {
    const { error } = await supabase.from('leak_ledger').delete().eq('id', id);
    return { error };
}

// 잔액 러닝밸런스 — 시트의 '하나은행 계좌' 열에 해당. 저장하지 않고 오래된 순으로 누적해 산출한다.
//   (시트의 월합계 잔고는 손입력이라 2건 오류가 있었음 → 집계로만 낸다.)
export function withRunningBalance(rows: LeakLedger[], opening = 0) {
    const asc = [...rows].sort((a, b) =>
        a.entry_date === b.entry_date ? a.created_at.localeCompare(b.created_at) : a.entry_date.localeCompare(b.entry_date),
    );
    let bal = opening;
    const out = asc.map((r) => {
        bal += (r.inflow || 0) - (r.outflow || 0);
        return { ...r, balance: bal };
    });
    return out.reverse(); // 화면은 최신순
}

// ── 외주 발주 ────────────────────────────────────────────────────────────
export async function listOutsourcing(limit = 1000) {
    const { data, error } = await supabase
        .from('leak_outsourcing')
        .select('*')
        .order('started_on', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit)
        .returns<LeakOutsourcing[]>();
    return { data: data ?? [], error };
}

export type OutsourcingInput = Partial<Omit<LeakOutsourcing, 'id' | 'created_at'>>;

function outsourcingPayload(input: OutsourcingInput) {
    const amount = Math.round(input.amount ?? 0);
    return {
        item_name: trimOrNull(input.item_name),
        marketing_type: trimOrNull(input.marketing_type),
        vendor: trimOrNull(input.vendor),
        started_on: input.started_on || null,
        ended_on: input.ended_on || null,
        amount,
        amount_vat: Math.round(input.amount_vat ?? 0),
        // 음수는 환불/차감 — 건수 집계가 왜곡되지 않게 종류로 구분해 둔다.
        entry_kind: input.entry_kind || (amount < 0 ? 'refund' : 'order'),
        settled_to_vendor: !!input.settled_to_vendor,
        settled_final: !!input.settled_final,
        note: trimOrNull(input.note),
    };
}

export async function createOutsourcing(input: OutsourcingInput) {
    if (!trimOrNull(input.item_name)) return { error: { message: '품목명을 입력하세요' } };
    const { error } = await supabase.from('leak_outsourcing').insert(outsourcingPayload(input));
    return { error };
}

export async function updateOutsourcing(id: string, input: OutsourcingInput) {
    const { error } = await supabase.from('leak_outsourcing').update(outsourcingPayload(input)).eq('id', id);
    return { error };
}

export async function deleteOutsourcing(id: string) {
    const { error } = await supabase.from('leak_outsourcing').delete().eq('id', id);
    return { error };
}
