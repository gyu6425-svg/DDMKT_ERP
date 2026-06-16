import { supabase } from '../lib/supabase';
import type { Contract, ContractProduct, Payment, ContractTask } from '../types';

export type CreateContractInput = {
    customer_id?: string | null;
    salesperson_id?: string | null;

    company_name: string;
    contact_name?: string | null;
    phone?: string | null;
    main_phone?: string | null;
    email?: string | null;

    payment_method?: string;
    contract_type?: string;

    contract_start_date?: string | null;
    contract_end_date?: string | null;

    total_contract_amount?: number;
    total_paid_amount?: number;
    outsourcing_cost?: number;
    payment_status?: string;

    business_number?: string | null;
    invoice_email?: string | null;
    business_address?: string | null;
    business_category?: string | null;

    memo?: string | null;
};

export type UpdateContractInput = Partial<CreateContractInput>;

export type CreatePaymentInput = {
    contract_id: string;
    payment_date?: string | null;
    expected_payment_date?: string | null;
    amount: number;
    payment_status?: string;
    payment_method?: string;
    payment_round?: number;
    memo?: string | null;
};

export type CreateContractProductInput = {
    contract_id: string;
    product_name: string;
    product_type?: string | null;
    quantity?: number;
    unit_price?: number;
    status?: string;
    memo?: string | null;
};

export type CreateContractTaskInput = {
    contract_id: string;
    customer_id?: string | null;
    salesperson_id?: string | null;

    task_title: string;
    task_type?: string | null;
    task_status?: string;
    priority?: string;

    start_date?: string | null;
    due_date?: string | null;
    completed_at?: string | null;

    assignee_name?: string | null;
    reviewer_name?: string | null;

    description?: string | null;
    memo?: string | null;
};

export async function getContracts() {
    return supabase
        .from('contracts')
        .select(
            `
      *,
      sales_people (
        name
      ),
      customers (
        company_name,
        contact_name,
        phone
      )
    `
        )
        .is('deleted_at', null)
        .order('contract_start_date', { ascending: false })
        .returns<Contract[]>();
}

export async function getContractById(id: string) {
    return supabase
        .from('contracts')
        .select(
            `
      *,
      sales_people (
        name
      ),
      customers (
        company_name,
        contact_name,
        phone
      ),
      contract_products (*),
      contract_payments (*),
      contract_tasks (*)
    `
        )
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle<Contract>();
}

export async function getContractsByCustomerId(customerId: string) {
    return supabase
        .from('contracts')
        .select(
            `
      *,
      sales_people (
        name
      ),
      customers (
        company_name,
        contact_name,
        phone
      )
    `
        )
        .eq('customer_id', customerId)
        .is('deleted_at', null)
        .order('contract_start_date', { ascending: false })
        .returns<Contract[]>();
}

export async function createContract(input: CreateContractInput) {
    return supabase.from('contracts').insert(input).select('*').single<Contract>();
}

export async function updateContract(id: string, input: UpdateContractInput) {
    return supabase
        .from('contracts')
        .update({
            ...input,
            updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .is('deleted_at', null)
        .select('*')
        .single<Contract>();
}

export async function softDeleteContract(id: string, userId?: string) {
    return supabase
        .from('contracts')
        .update({
            deleted_at: new Date().toISOString(),
            ...(userId ? { deleted_by: userId } : {}),
            updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single<Contract>();
}

export async function getContractProductsByContractId(contractId: string) {
    return supabase
        .from('contract_products')
        .select('*')
        .eq('contract_id', contractId)
        .order('created_at', { ascending: true })
        .returns<ContractProduct[]>();
}

export async function createContractProduct(input: CreateContractProductInput) {
    return supabase.from('contract_products').insert(input).select('*').single<ContractProduct>();
}

export async function updateContractProduct(
    id: string,
    input: Partial<CreateContractProductInput>
) {
    return supabase
        .from('contract_products')
        .update({
            ...input,
            updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single<ContractProduct>();
}

export async function getPaymentsByContractId(contractId: string) {
    return supabase
        .from('contract_payments')
        .select('*')
        .eq('contract_id', contractId)
        .is('deleted_at', null)
        .order('payment_date', { ascending: false })
        .returns<Payment[]>();
}

export async function createPayment(input: CreatePaymentInput) {
    return supabase.from('contract_payments').insert(input).select('*').single<Payment>();
}

export async function updatePayment(id: string, input: Partial<CreatePaymentInput>) {
    return supabase
        .from('contract_payments')
        .update({
            ...input,
            updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .is('deleted_at', null)
        .select('*')
        .single<Payment>();
}

export async function softDeletePayment(id: string, userId?: string) {
    return supabase
        .from('contract_payments')
        .update({
            deleted_at: new Date().toISOString(),
            ...(userId ? { deleted_by: userId } : {}),
            updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single<Payment>();
}

export async function getContractTasksByContractId(contractId: string) {
    return supabase
        .from('contract_tasks')
        .select('*')
        .eq('contract_id', contractId)
        .is('deleted_at', null)
        .order('due_date', { ascending: true })
        .returns<ContractTask[]>();
}

export async function createContractTask(input: CreateContractTaskInput) {
    return supabase.from('contract_tasks').insert(input).select('*').single<ContractTask>();
}

export async function updateContractTask(id: string, input: Partial<CreateContractTaskInput>) {
    return supabase
        .from('contract_tasks')
        .update({
            ...input,
            updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .is('deleted_at', null)
        .select('*')
        .single<ContractTask>();
}

export async function softDeleteContractTask(id: string) {
    return supabase
        .from('contract_tasks')
        .update({
            deleted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single<ContractTask>();
}
