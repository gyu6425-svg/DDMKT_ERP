import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import {
    getClients,
    getContractData,
    getSalespeople,
    type ErpClient,
    type ErpContractData,
    type ErpSalesperson,
} from '../api/erp';
import { useAuth } from '../hooks/useAuth';

type ErpDataValue = {
    clients: ErpClient[]; // 역할 필터가 적용된, 현재 사용자가 볼 수 있는 고객
    allClients: ErpClient[]; // 원본 전체
    salespeople: ErpSalesperson[];
    contractData: Record<string, ErpContractData>;
    canSeeAll: boolean;
    myName: string;
    loading: boolean;
    error: string;
    refresh: () => Promise<void>;
};

const ErpDataContext = createContext<ErpDataValue | null>(null);

export function ErpDataProvider({ children }: { children: ReactNode }) {
    const [clients, setClients] = useState<ErpClient[]>([]);
    const [salespeople, setSalespeople] = useState<ErpSalesperson[]>([]);
    const [contractData, setContractData] = useState<Record<string, ErpContractData>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        setLoading(true);
        setError('');

        const [clientsResult, salespeopleResult, contractResult] = await Promise.all([
            getClients(),
            getSalespeople(),
            getContractData(),
        ]);

        const firstError =
            clientsResult.error || salespeopleResult.error || contractResult.error || null;

        if (firstError) {
            setError(firstError.message || '데이터를 불러오지 못했습니다.');
            setLoading(false);
            return;
        }

        setClients(clientsResult.data);
        setSalespeople(salespeopleResult.data);

        const map: Record<string, ErpContractData> = {};
        contractResult.data.forEach((item) => {
            map[String(item.client_id)] = item;
        });
        setContractData(map);
        setLoading(false);
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // 역할별 접근: 어드민/매니저는 전체, 그 외(영업자 등)는 본인 담당 고객만.
    const { isAdmin, profile } = useAuth();
    const canSeeAll = isAdmin || profile?.role === 'manager';
    const myName = profile?.name ?? '';
    const visibleClients = useMemo(
        () => (canSeeAll ? clients : clients.filter((client) => (client.manager || '') === myName)),
        [clients, canSeeAll, myName],
    );

    const value = useMemo(
        () => ({
            allClients: clients,
            canSeeAll,
            clients: visibleClients,
            contractData,
            error,
            loading,
            myName,
            refresh,
            salespeople,
        }),
        [clients, visibleClients, canSeeAll, myName, contractData, error, loading, refresh, salespeople],
    );

    return <ErpDataContext.Provider value={value}>{children}</ErpDataContext.Provider>;
}

export function useErpData() {
    const context = useContext(ErpDataContext);

    if (!context) {
        throw new Error('useErpData must be used within ErpDataProvider');
    }

    return context;
}
