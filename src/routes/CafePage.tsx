import { useState } from 'react';
import { CafeBannerTab } from '../components/cafe/CafeBannerTab';
import { CafeBanner2Tab } from '../components/cafe/CafeBanner2Tab';
import { PublishHistory } from '../components/cafe/PublishHistory';

// 카페 자동발행 — 운영 중인 업체 탭만 남긴다(구 실험/초판 탭 전부 제거, 2026-07-21).
//   누수탐지  = <CafeBannerTab abModel />
//   더맨시스템 = <CafeBanner2Tab abModel />
//   각 탭은 자체적으로 입력·생성·발행을 관리하고, 하단에 공통 발행 히스토리를 둔다.

const TABS: [ 'leak3' | 'theman3' | 'seolgo', string ][] = [
    ['leak3', '누수탐지'],
    ['theman3', '더맨시스템'],
    ['seolgo', '설고점'],
];

function CafePage() {
    const [activeTab, setActiveTab] = useState<'leak3' | 'theman3' | 'seolgo'>('leak3');
    return (
        <section className="grid gap-5">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">카페 자동발행</h2>
            </div>

            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {TABS.map(([k, label]) => (
                    <button
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                            activeTab === k
                                ? 'border-[#4338ca] text-[#4338ca]'
                                : 'border-transparent text-[#94a3b8] hover:text-[#475569]'
                        }`}
                        key={k}
                        onClick={() => setActiveTab(k)}
                        type="button"
                    >
                        {label}
                    </button>
                ))}
            </div>

            {activeTab === 'leak3' ? <CafeBannerTab abModel /> : activeTab === 'seolgo' ? <CafeBanner2Tab abModel company="seolgo" /> : <CafeBanner2Tab abModel />}

            <PublishHistory />
        </section>
    );
}

export default CafePage;
