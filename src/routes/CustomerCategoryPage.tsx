import { BlogRankProvider, useBlogRank } from '../components/blogRank/lib/BlogRankContext';
import { DashboardTab } from '../components/blogRank/pages/DashboardTab';
import { SheetTab } from '../components/blogRank/pages/SheetTab';
import { TrackerTab } from '../components/blogRank/pages/TrackerTab';
import { categoryByKey, type CategoryKey } from '../components/categoryRank/categories';
import type { Tab } from '../components/blogRank/lib/helpers';

// 고객 ERP 카테고리 화면 — 블로그는 완성된 대시보드의 3개 탭(대시보드·블로그 관리 시트·순위 트래커) 재사용.
//   고객은 본인 업체만/계약 중만 본다(customerMode = 계약종료 숨김, 실제 본인업체 격리는 RLS).
//   나머지 카테고리(영상/인스타/카페/트래픽)는 준비 중 — 구현 시 동일 구조로.
const CUSTOMER_TABS: { key: Tab; name: string }[] = [
    { key: 'dashboard', name: '대시보드' },
    { key: 'sheet', name: '블로그 관리 시트' },
    { key: 'tracker', name: '순위 트래커' },
];

// 블로그 고객 뷰 — BlogRankContext의 tab/goTab을 써서 대시보드 카드의 이동(통합10위→트래커 등)도 동작.
function BlogCustomerView() {
    const { tab, goTab } = useBlogRank();
    const shown: Tab = tab === 'sheet' || tab === 'tracker' ? tab : 'dashboard';
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
            {shown === 'dashboard' ? <DashboardTab /> : shown === 'sheet' ? <SheetTab /> : <TrackerTab />}
        </>
    );
}

function CustomerCategoryPage() {
    const key = (window.location.pathname.split('/')[2] || 'blog') as CategoryKey;
    const def = categoryByKey(key);

    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2">
                <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">{def.label}</h2>
                <span className="rounded-full bg-[#dbeafe] px-2.5 py-1 text-xs font-bold text-[#1e40af]">고객 뷰</span>
            </div>
            <p className="m-0 text-sm text-[#64748b]">본인 업체의 정보만 표시됩니다.</p>

            {key === 'blog' ? (
                <BlogRankProvider customerMode>
                    <BlogCustomerView />
                </BlogRankProvider>
            ) : (
                <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-16 text-center">
                    <div className="text-base font-semibold text-[#475569]">{def.label} — 준비 중</div>
                    <p className="mx-auto mt-2 max-w-md text-sm text-[#94a3b8]">
                        블로그와 동일하게 본인 업체의 대시보드·시트·순위만 보이게 구현될 예정입니다.
                    </p>
                </div>
            )}
        </section>
    );
}

export default CustomerCategoryPage;
