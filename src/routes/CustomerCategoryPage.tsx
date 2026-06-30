import { useState } from 'react';
import { BlogRankProvider } from '../components/blogRank/lib/BlogRankContext';
import { SheetTab } from '../components/blogRank/pages/SheetTab';
import { TrackerTab } from '../components/blogRank/pages/TrackerTab';
import { categoryByKey, type CategoryKey } from '../components/categoryRank/categories';

// 고객 ERP 카테고리 화면 — 고객은 본인 업체의 '관리 시트 · 순위 트래커'만 본다.
//   블로그는 완성된 대시보드 재사용, 나머지 카테고리는 준비 중(카테고리 구현 시 채움).
const TAB_NAMES = ['관리 시트', '순위 트래커'] as const;

function CustomerCategoryPage() {
    const key = (window.location.pathname.split('/')[2] || 'blog') as CategoryKey;
    const def = categoryByKey(key);
    const short = def.label.replace(' 대시보드', '');
    const [active, setActive] = useState(0);

    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2">
                <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">{short} · 고객 ERP</h2>
                <span className="rounded-full bg-[#dbeafe] px-2.5 py-1 text-xs font-bold text-[#1e40af]">고객 뷰</span>
            </div>

            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {TAB_NAMES.map((t, i) => (
                    <button
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                            active === i ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8]'
                        }`}
                        key={t}
                        onClick={() => setActive(i)}
                        type="button"
                    >
                        {t}
                    </button>
                ))}
            </div>

            {key === 'blog' ? (
                <BlogRankProvider>{active === 0 ? <SheetTab /> : <TrackerTab />}</BlogRankProvider>
            ) : (
                <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-16 text-center">
                    <div className="text-base font-semibold text-[#475569]">
                        {short} · {TAB_NAMES[active]}
                    </div>
                    <p className="mx-auto mt-2 max-w-md text-sm text-[#94a3b8]">
                        {short} 카테고리는 준비 중입니다. 블로그와 동일하게 본인 업체의 시트·순위만 보이게 구현될 예정입니다.
                    </p>
                </div>
            )}
        </section>
    );
}

export default CustomerCategoryPage;
