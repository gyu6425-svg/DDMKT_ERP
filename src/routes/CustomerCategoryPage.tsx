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
import { getCafeAccounts } from '../api/cafeAccounts';
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
    const [companyKey, setCompanyKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<'tracker' | 'sheet' | 'publish'>('tracker');

    useEffect(() => {
        let alive = true;
        setLoading(true);
        void getCafeAccounts().then(({ data }) => {
            if (!alive) return;
            const acc = scopedClientId ? data.find((a) => a.client_id === scopedClientId) : null;
            setCompanyKey(acc?.company_key ?? null);
            setLoading(false);
        });
        return () => { alive = false; };
    }, [scopedClientId]);

    if (loading) {
        return <div className="rounded-xl border border-[#e2e8f0] bg-white px-6 py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>;
    }
    // 카페계정 없어도 '카페 자동화 발행' 탭은 항상 보인다(승인 요청용). 순위·시트만 계정 필요.
    const noCafe = (
        <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-16 text-center">
            <div className="text-base font-semibold text-[#475569]">등록된 카페 배포가 없습니다</div>
            <p className="mx-auto mt-2 max-w-md text-sm text-[#94a3b8]">아직 연결된 카페가 없습니다. "카페 자동화 발행" 탭에서 승인 요청을 남겨 주세요.</p>
        </div>
    );
    return (
        <>
            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {([['tracker', '순위 트래커'], ['sheet', '카페 관리 시트'], ['publish', '카페 자동화 발행']] as const).map(([k, name]) => (
                    <button
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                            view === k ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8]'
                        }`}
                        key={k}
                        onClick={() => setView(k)}
                        type="button"
                    >
                        {name}
                    </button>
                ))}
            </div>
            {view === 'tracker'
                ? (companyKey ? <CafeTrackerTab lockCompany={companyKey} /> : noCafe)
                : view === 'sheet'
                    ? (companyKey ? <CafeSheetTab scopeCompanyKey={companyKey} readOnly /> : noCafe)
                    : <CafeCustomerStudio clientId={scopedClientId} />}
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
