import { useState } from 'react';
import { CafeSheetTab } from '../cafeRank/pages/CafeSheetTab';
import { CafeTrackerTab } from '../cafeRank/pages/CafeTrackerTab';
import { LEAK_TRACK_CLIENT_ID } from '../../api/leakErp';

// 누수탐지 카페 — 관리시트 + 순위 트래커(계약관리 미연동). 회사ERP 컴포넌트를 누수 client_id 로 스코프해 재사용.
//   등록: 관리시트 '업체 등록' → cafe_accounts(client_id=누수). 글: 순위 트래커 '시트 붙여넣기' → cafe_rank_posts.
const TABS = [
    { key: 'sheet', label: '관리 시트' },
    { key: 'tracker', label: '순위 트래커' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export default function LeakCafeTab() {
    const [tab, setTab] = useState<Tab>('sheet');
    return (
        <div className="flex min-w-0 flex-col gap-4">
            <div>
                <h2 className="m-0 text-base font-bold text-[#0f172a]">누수탐지 카페</h2>
                <p className="m-0 mt-0.5 text-xs text-[#64748b]">누수탐지 카페 관리시트 · 순위 트래커 (계약관리와 별개)</p>
            </div>
            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {TABS.map((t) => (
                    <button
                        key={t.key}
                        type="button"
                        onClick={() => setTab(t.key)}
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === t.key ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8] hover:text-[#475569]'}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            {tab === 'sheet'
                ? <CafeSheetTab scopeClientId={LEAK_TRACK_CLIENT_ID} />
                : <CafeTrackerTab scopeClientId={LEAK_TRACK_CLIENT_ID} />}
        </div>
    );
}
