import { useState } from 'react';
import { BlogRankProvider } from '../components/blogRank/lib/BlogRankContext';
import { SheetTab } from '../components/blogRank/pages/SheetTab';
import { TrackerTab } from '../components/blogRank/pages/TrackerTab';

// 고객 전용 ERP (블로그) — 완성된 블로그 대시보드를 '활용'.
//   고객(업체/기자단)은 관리시트·순위트래커만 본다(대시보드/크롤링/작성기 없음).
//   현재는 회사 ERP 사용자가 토글로 미리보기. 실제 고객 격리는 RLS(customer-portal-rls.sql)로.
const TABS = [
    { name: '관리 시트', Comp: SheetTab },
    { name: '순위 트래커', Comp: TrackerTab },
] as const;

function CustomerPortalPage() {
    const [active, setActive] = useState(0);
    const Active = TABS[active].Comp;

    return (
        <BlogRankProvider>
            <section className="grid gap-4">
                <div className="flex items-center gap-2">
                    <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">블로그 · 고객 ERP</h2>
                    <span className="rounded-full bg-[#dbeafe] px-2.5 py-1 text-xs font-bold text-[#1e40af]">고객 뷰</span>
                </div>
                <p className="m-0 text-sm text-[#64748b]">고객은 본인 업체의 관리 시트와 순위만 봅니다.</p>

                <div className="flex gap-1 border-b border-[#e2e8f0]">
                    {TABS.map((t, i) => (
                        <button
                            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                                active === i ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8]'
                            }`}
                            key={t.name}
                            onClick={() => setActive(i)}
                            type="button"
                        >
                            {t.name}
                        </button>
                    ))}
                </div>

                <Active />
            </section>
        </BlogRankProvider>
    );
}

export default CustomerPortalPage;
