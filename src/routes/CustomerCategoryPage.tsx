import { useEffect, useState } from 'react';
import { BlogRankProvider, useBlogRank } from '../components/blogRank/lib/BlogRankContext';
import { SheetTab } from '../components/blogRank/pages/SheetTab';
import { TrackerTab } from '../components/blogRank/pages/TrackerTab';
import { categoryByKey, type CategoryKey } from '../components/categoryRank/categories';
import type { Tab } from '../components/blogRank/lib/helpers';
import { CustomerPlaceRank } from './CustomerPlaceRank';

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

const CUSTOMER_TABS: { key: Extract<Tab, 'sheet' | 'tracker'>; name: string }[] = [
    { key: 'sheet', name: '블로그 관리 시트' },
    { key: 'tracker', name: '순위 트래커' },
];

function BlogCustomerView() {
    const { tab, goTab } = useBlogRank();
    const shown: Extract<Tab, 'sheet' | 'tracker'> = tab === 'tracker' ? 'tracker' : 'sheet';

    return (
        <>
            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {CUSTOMER_TABS.map((t) => (
                    <button
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                            shown === t.key ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8]'
                        }`}
                        key={t.key}
                        onClick={() => goTab(t.key)}
                        type="button"
                    >
                        {t.name}
                    </button>
                ))}
            </div>
            {shown === 'sheet' ? <SheetTab /> : <TrackerTab />}
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
