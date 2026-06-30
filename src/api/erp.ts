import { supabase } from '../lib/supabase';

// ── 타입 ────────────────────────────────────────────────
export type ClientHistory = { date: string; text: string };

export type ErpClient = {
    id: string;
    created_at: string;
    manager: string | null;
    source: string | null;
    company: string | null;
    contact: string | null;
    phone: string | null;
    email: string | null;
    product: string | null;
    budget: string | null;
    amount: number | null;
    next_contact: string | null;
    contract_start: string | null;
    contract_end: string | null;
    status: string | null;
    notes: string | null;
    history: ClientHistory[] | null;
    business_number: string | null;
    invoice_email: string | null;
    address: string | null;
    industry: string | null;
    url: string | null;
};

// ERP의 '영업자 명단'은 기존 인증/역할 테이블 sales_people을 재사용한다.
// (incentive_rate 대신 commission_rate 사용)
export type ErpSalesperson = {
    id: string;
    name: string;
    email: string | null;
    commission_rate: number | null;
    role: string | null;
    is_active: boolean | null;
};

export type ContractProduct = {
    type: string;
    unit_price: number;
    quantity: number;
    unit_outsource: number;
    done: number;
    note?: string;
};

export type BillingRecord = {
    ym: string;
    rid?: string;
    amount: number;
    paid: boolean;
    paid_date?: string | null;
    memo?: string | null;
};

export type WorkItem = {
    type: string;
    planned: number;
    done: number;
    unit_outsource: number;
};

export type ScheduleItem = {
    id: number;
    type: string;
    title: string;
    due_date?: string;
    status: string;
    url?: string;
};

export type ErpContractData = {
    id?: string;
    client_id: string;
    billing_day: number | null;
    billing_amount: number;
    billing_records: BillingRecord[];
    monthly_work: Record<string, WorkItem[] | string>;
    schedule: ScheduleItem[];
    outsource_cost: number;
    pay_method: string;
    vat_included: boolean;
    contract_type: string;
    manual_revenue: number;
    manual_outsource: number;
    contract_products: ContractProduct[];
    updated_at?: string;
};

// ── 고객 DB ─────────────────────────────────────────────
export async function getClients() {
    const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false })
        .returns<ErpClient[]>();

    return { data: data ?? [], error };
}

export async function insertClient(payload: Partial<ErpClient>) {
    const { data, error } = await supabase.from('clients').insert(payload).select().returns<ErpClient[]>();

    return { data: data ?? [], error };
}

export async function updateClient(id: string, payload: Partial<ErpClient>) {
    const { data, error } = await supabase
        .from('clients')
        .update(payload)
        .eq('id', id)
        .select()
        .returns<ErpClient[]>();

    return { data: data ?? [], error };
}

export async function deleteClient(id: string) {
    const { error } = await supabase.from('clients').delete().eq('id', id);

    return { error };
}

// ── 영업자 (기존 sales_people 재사용) ────────────────────
export async function getSalespeople() {
    const { data, error } = await supabase
        .from('sales_people')
        .select('id, name, email, commission_rate, role, is_active')
        .order('name', { ascending: true })
        .returns<ErpSalesperson[]>();

    return { data: data ?? [], error };
}

export async function insertSalesperson(payload: Partial<ErpSalesperson>) {
    const { data, error } = await supabase
        .from('sales_people')
        .insert({
            commission_rate: payload.commission_rate ?? 0,
            email: payload.email ?? null,
            is_active: true,
            name: payload.name,
            role: payload.role ?? 'sales',
        })
        .select('id, name, email, commission_rate, role, is_active')
        .returns<ErpSalesperson[]>();

    return { data: data ?? [], error };
}

export async function deleteSalesperson(id: string) {
    const { error } = await supabase.from('sales_people').delete().eq('id', id);

    return { error };
}

// ── 계약 상세 ───────────────────────────────────────────
export async function getContractData() {
    const { data, error } = await supabase
        .from('contract_data')
        .select('*')
        .returns<ErpContractData[]>();

    return { data: data ?? [], error };
}

export async function upsertContractData(payload: ErpContractData) {
    const { error } = await supabase
        .from('contract_data')
        .upsert({ ...payload, updated_at: new Date().toISOString() }, { onConflict: 'client_id' });

    return { error };
}

export function emptyContractData(clientId: string): ErpContractData {
    return {
        billing_amount: 0,
        billing_day: null,
        billing_records: [],
        client_id: clientId,
        contract_products: [],
        contract_type: '신규',
        manual_outsource: 0,
        manual_revenue: 0,
        monthly_work: {},
        outsource_cost: 0,
        pay_method: 'cash',
        schedule: [],
        vat_included: false,
    };
}
