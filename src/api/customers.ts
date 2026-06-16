import { supabase } from '../lib/supabase';
import type { Customer, CustomerHistory } from '../types';

export type CreateCustomerInput = {
    salesperson_id?: string | null;

    company_name: string;
    source?: string | null;
    contact_name?: string | null;
    phone?: string | null;
    main_phone?: string | null;
    email?: string | null;

    product?: string | null;
    ad_budget?: number;
    contract_amount?: number;

    status?: string;
    recent_history?: string | null;
    next_contact_date?: string | null;
    inquiry_date?: string | null;

    contract_start_date?: string | null;
    contract_end_date?: string | null;

    memo?: string | null;
    is_favorite?: boolean;

    inquiry_content?: string | null;
    kakao_name?: string | null;
    business_type?: string | null;
    region?: string | null;
    priority?: string | null;
    last_contacted_at?: string | null;
    converted_at?: string | null;
};

export type UpdateCustomerInput = Partial<CreateCustomerInput>;

export type CreateCustomerHistoryInput = {
    customer_id: string;
    user_id?: string | null;

    history_type?: string;
    content: string;
    next_contact_date?: string | null;

    contact_method?: string | null;
    status_after?: string | null;
    created_by_name?: string | null;
};

export async function getCustomers() {
    return supabase
        .from('customers')
        .select(
            `
      *,
      sales_people (
        name
      )
    `
        )
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .returns<Customer[]>();
}

export async function getCustomerById(id: string) {
    return supabase
        .from('customers')
        .select(
            `
      *,
      sales_people (
        name
      )
    `
        )
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle<Customer>();
}

export async function getCustomersBySalespersonId(salespersonId: string) {
    return supabase
        .from('customers')
        .select(
            `
      *,
      sales_people (
        name
      )
    `
        )
        .eq('salesperson_id', salespersonId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .returns<Customer[]>();
}

export async function createCustomer(input: CreateCustomerInput) {
    return supabase.from('customers').insert(input).select('*').single<Customer>();
}

export async function updateCustomer(id: string, input: UpdateCustomerInput) {
    return supabase
        .from('customers')
        .update({
            ...input,
            updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .is('deleted_at', null)
        .select('*')
        .single<Customer>();
}

export async function softDeleteCustomer(id: string) {
    return supabase
        .from('customers')
        .update({
            deleted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single<Customer>();
}

export async function toggleCustomerFavorite(id: string, isFavorite: boolean) {
    return supabase
        .from('customers')
        .update({
            is_favorite: isFavorite,
            updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .is('deleted_at', null)
        .select('*')
        .single<Customer>();
}

export async function searchCustomers(keyword: string) {
    return supabase
        .from('customers')
        .select(
            `
      *,
      sales_people (
        name
      )
    `
        )
        .is('deleted_at', null)
        .or(
            `company_name.ilike.%${keyword}%,contact_name.ilike.%${keyword}%,phone.ilike.%${keyword}%,main_phone.ilike.%${keyword}%,product.ilike.%${keyword}%,source.ilike.%${keyword}%`
        )
        .order('created_at', { ascending: false })
        .returns<Customer[]>();
}

export async function getCustomerHistories(customerId: string) {
    return supabase
        .from('customer_histories')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .returns<CustomerHistory[]>();
}

export async function createCustomerHistory(input: CreateCustomerHistoryInput) {
    return supabase.from('customer_histories').insert(input).select('*').single<CustomerHistory>();
}
