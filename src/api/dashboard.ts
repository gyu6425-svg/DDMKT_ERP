import { supabase } from '../lib/supabase';
import type { Customer, Contract, Payment } from '../types';

export type DashboardSummary = {
    activeCustomers: number;
    activeContracts: number;
    totalContractAmount: number;
    grossRevenue: number;
    netRevenue: number;
    outsourcingCost: number;
    todayContacts: number;
    expiringContracts: number;
};

export async function getDashboardSummary() {
    const today = new Date().toISOString().slice(0, 10);

    const thirtyDaysLater = new Date();
    thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
    const thirtyDaysLaterString = thirtyDaysLater.toISOString().slice(0, 10);

    const [
        customersResult,
        contractsResult,
        paymentsResult,
        todayContactsResult,
        expiringContractsResult,
    ] = await Promise.all([
        supabase.from('customers').select('*').is('deleted_at', null).returns<Customer[]>(),

        supabase.from('contracts').select('*').is('deleted_at', null).returns<Contract[]>(),

        supabase.from('contract_payments').select('*').is('deleted_at', null).returns<Payment[]>(),

        supabase
            .from('customers')
            .select('id', { count: 'exact', head: true })
            .is('deleted_at', null)
            .eq('next_contact_date', today),

        supabase
            .from('contracts')
            .select('id', { count: 'exact', head: true })
            .is('deleted_at', null)
            .gte('contract_end_date', today)
            .lte('contract_end_date', thirtyDaysLaterString),
    ]);

    if (customersResult.error) {
        return { data: null, error: customersResult.error };
    }

    if (contractsResult.error) {
        return { data: null, error: contractsResult.error };
    }

    if (paymentsResult.error) {
        return { data: null, error: paymentsResult.error };
    }

    if (todayContactsResult.error) {
        return { data: null, error: todayContactsResult.error };
    }

    if (expiringContractsResult.error) {
        return { data: null, error: expiringContractsResult.error };
    }

    const contracts = contractsResult.data ?? [];
    const payments = paymentsResult.data ?? [];

    const totalContractAmount = contracts.reduce(
        (sum, contract) => sum + Number(contract.total_contract_amount ?? 0),
        0
    );

    const grossRevenue = payments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);

    const outsourcingCost = contracts.reduce(
        (sum, contract) => sum + Number(contract.outsourcing_cost ?? 0),
        0
    );

    const netRevenue = contracts.reduce(
        (sum, contract) => sum + Number(contract.net_sales ?? 0),
        0
    );

    return {
        data: {
            activeCustomers: customersResult.data.length,
            activeContracts: contracts.length,
            totalContractAmount,
            grossRevenue,
            netRevenue,
            outsourcingCost,
            todayContacts: todayContactsResult.count ?? 0,
            expiringContracts: expiringContractsResult.count ?? 0,
        } satisfies DashboardSummary,
        error: null,
    };
}
