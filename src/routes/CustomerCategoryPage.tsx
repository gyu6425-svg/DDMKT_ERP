import { useEffect, useState } from 'react';
import { BlogRankProvider } from '../components/blogRank/lib/BlogRankContext';
import { SheetTab } from '../components/blogRank/pages/SheetTab';
import { TrackerTab } from '../components/blogRank/pages/TrackerTab';
import { CustomerReportsTab } from '../components/blogRank/pages/CustomerReportsTab';
import { categoryByKey, type CategoryKey } from '../components/categoryRank/categories';
import { CustomerPlaceRank } from './CustomerPlaceRank';
import { CafeTrackerTab } from '../components/cafeRank/pages/CafeTrackerTab';
import { CafeSheetTab } from '../components/cafeRank/pages/CafeSheetTab';
import { CafeCustomerStudio } from '../components/cafe/CafeCustomerStudio';
import { CafeDeployIntake } from '../components/cafe/CafeDeployIntake';
import { CafeTokenHistory } from '../components/cafe/CafeTokenHistory';
import { getCafeAccounts } from '../api/cafeAccounts';
import { listCafeDeployRequests } from '../api/cafeDeployRequests';
import { useAuth } from '../hooks/useAuth';

export function useAsParam(): string {
    const [as, setAs] = useState(() => new URLSearchParams(window.location.search).get('as') || '');
    useEffect(() => {
        const sync = () => setAs(new URLSearchParams(window.location.search).get('as') || '');
        window.addEventListener('app:navigate', sync);
        window.addEventListener('popstate', sync);
        return () => {
            window.removeEventListener('app:navigate', sync);
            window.removeEventListener('popstate', sync);
        };
    }, []);
    return as;
}

type CustomerView = 'sheet' | 'tracker' | 'reports';
const CUSTOMER_TABS: { key: CustomerView; name: string }[] = [
    { key: 'sheet', name: '블로그 관리 시트' },
    { key: 'tracker', name: '순위 트래커' },
    { key: 'reports', name: '저장,발행 성과' },
];

function BlogCustomerView() {
    const [view, setView] = useState<CustomerView>('sheet');

    return (
        <>
            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {CUSTOMER_TABS.map((t) => (
                    <button
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                            view === t.key ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8]'
                        }`}
                        key={t.key}
                        onClick={() => setView(t.key)}
                        type="button"
                    >
                        {t.name}
                    </button>
                ))}
            </div>
            {view === 'sheet' ? <SheetTab /> : view === 'tracker' ? <TrackerTab /> : <CustomerReportsTab />}
        </>
    );
}

// 카페 고객 뷰 — 본인 업체(client_id) 카페의 순위 트래커 + 관리 시트(읽기전용).
//   client_id → cafe_accounts.company_key 매핑 후 그 업체로 스코프.
function CafeCustomerView({ previewClientId }: { previewClientId: string | null }) {
    const { profile } = useAuth();
    const scopedClientId = previewClientId ?? (profile?.client_id ?? null);
    const [companyKeys, setCompanyKeys] = useState<string[]>([]); // 트래커용 — 이 고객의 모든 카페(마이클+자체)
    const [sheetKeys, setSheetKeys] = useState<string[]>([]);     // 관리시트용 — 자체 카페만(마이클 ddmkt2 제외)
    const [publishEnabled, setPublishEnabled] = useState(false); // 담당자 세팅 완료(자동화 발행 탭 노출)
    const [payDue, setPayDue] = useState(0); // 결제대기(승인된 접수) 건수 — 충전내역 탭 알림 뱃지
    const [loading, setLoading] = useState(true);
    // 사이드바 '카페 배포'(?sub=카페 배포) 로 들어오면 접수 탭으로 연다.
    const [view, setView] = useState<'tracker' | 'sheet' | 'intake' | 'publish' | 'charge'>(
        () => (new URLSearchParams(window.location.search).get('sub') === '카페 배포' ? 'intake' : 'sheet'),
    );
    useEffect(() => {
        const sync = () => {
            if (new URLSearchParams(window.location.search).get('sub') === '카페 배포') setView('intake');
        };
        window.addEventListener('app:navigate', sync);
        window.addEventListener('popstate', sync);
        return () => {
            window.removeEventListener('app:navigate', sync);
            window.removeEventListener('popstate', sync);
        };
    }, []);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        void getCafeAccounts().then(({ data }) => {
            if (!alive) return;
            const accs = scopedClientId ? data.filter((a) => a.client_id === scopedClientId) : [];
            setCompanyKeys(accs.map((a) => a.company_key)); // 트래커 = 전부(마이클 + 자체)
            // 관리시트 = 자체 카페만(마이클 공유카페 ddmkt2 제외). 자체 없으면(누수/더티 등) 그대로.
            const own = accs.filter((a) => a.cafe_name !== 'ddmkt2');
            setSheetKeys((own.length ? own : accs).map((a) => a.company_key));
            setPublishEnabled(accs.some((a) => a.publish_enabled));
            setLoading(false);
        });
        return () => { alive = false; };
    }, [scopedClientId]);

    // 결제대기(승인된 접수) 건수 → 충전내역 탭 알림 뱃지
    useEffect(() => {
        let alive = true;
        if (!scopedClientId) { setPayDue(0); return; }
        void listCafeDeployRequests(scopedClientId).then(({ data }) => {
            if (!alive) return;
            setPayDue(data.filter((r) => r.status === '결제대기').length);
        });
        return () => { alive = false; };
    }, [scopedClientId, view]);

    if (loading) {
        return <div className="rounded-xl border border-[#e2e8f0] bg-white px-6 py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>;
    }
    // 카페계정 없어도 '카페 자동화 발행' 탭은 항상 보인다(승인 요청용). 순위·시트만 계정 필요.
    const noCafe = (
        <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-16 text-center">
            <div className="text-base font-semibold text-[#475569]">등록된 카페 배포가 없습니다</div>
            <p className="mx-auto mt-2 max-w-md text-sm text-[#94a3b8]">아직 연결된 카페가 없습니다. "카페 배포" 탭에서 접수를 남겨 주세요.</p>
        </div>
    );
    // 자동화 발행 탭은 담당자 세팅(publish_enabled=true) 후에만 노출.
    const tabs: [string, string][] = [['sheet', '카페 관리 시트'], ['tracker', '순위 트래커'], ['intake', '카페 배포']];
    if (publishEnabled) tabs.push(['publish', '카페 자동화 발행']);
    tabs.push(['charge', '충전내역']);
    return (
        <>
            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {tabs.map(([k, name]) => (
                    <button
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                            view === k ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8]'
                        }`}
                        key={k}
                        onClick={() => setView(k as typeof view)}
                        type="button"
                    >
                        {name}
                        {k === 'charge' && payDue > 0 ? (
                            <span className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#ef4444] px-1 text-[10px] font-bold leading-none text-white">{payDue}</span>
                        ) : null}
                    </button>
                ))}
            </div>
            {view === 'tracker'
                ? (companyKeys.length ? <CafeTrackerTab lockCompany={companyKeys} /> : noCafe)
                : view === 'sheet'
                    ? (sheetKeys.length ? <CafeSheetTab scopeCompanyKey={sheetKeys} readOnly /> : noCafe)
                    : view === 'publish'
                        ? <CafeCustomerStudio clientId={scopedClientId} />
                        : view === 'charge'
                            ? <CafeTokenHistory clientId={scopedClientId} />
                            : <CafeDeployIntake clientId={scopedClientId} />}
        </>
    );
}

function CustomerCategoryPage() {
    const key = (window.location.pathname.split('/')[2] || 'blog') as CategoryKey;
    const def = categoryByKey(key);
    const as = useAsParam();

    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2">
                <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">{def.label}</h2>
                <span className="rounded-full bg-[#dbeafe] px-2.5 py-1 text-xs font-bold text-[#1e40af]">고객 뷰</span>
            </div>
            <p className="m-0 text-sm text-[#64748b]">본인 업체 정보만 표시합니다.</p>

            {key === 'blog' ? (
                <BlogRankProvider customerMode previewClientId={as || null}>
                    <BlogCustomerView />
                </BlogRankProvider>
            ) : key === 'place' ? (
                <CustomerPlaceRank previewClientId={as || null} />
            ) : key === 'cafe' ? (
                <CafeCustomerView previewClientId={as || null} />
            ) : (
                <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-16 text-center">
                    <div className="text-base font-semibold text-[#475569]">{def.label} 준비 중</div>
                    <p className="mx-auto mt-2 max-w-md text-sm text-[#94a3b8]">
                        블로그와 동일하게 본인 업체의 대시보드와 관리 시트만 보이도록 구현 예정입니다.
                    </p>
                </div>
            )}
        </section>
    );
}

export default CustomerCategoryPage;
