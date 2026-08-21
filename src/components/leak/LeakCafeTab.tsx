import { useEffect, useState } from 'react';
import { CafeSheetTab } from '../cafeRank/pages/CafeSheetTab';
import { CafeTrackerTab } from '../cafeRank/pages/CafeTrackerTab';
import { LEAK_CAFE_CLIENT_ID } from '../../api/leakErp';
import { getCafeAccounts } from '../../api/cafeAccounts';

// 누수탐지 카페 — 관리시트 + 순위 트래커(계약관리 미연동). 회사ERP 컴포넌트를 누수 client_id 로 스코프해 재사용.
//   등록: 관리시트 '업체 등록' → cafe_accounts(client_id=누수). 글: 순위 트래커 '시트 붙여넣기' → cafe_rank_posts.
const TABS = [
    { key: 'sheet', label: '관리 시트' },
    { key: 'tracker', label: '순위 트래커' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export default function LeakCafeTab() {
    const [tab, setTab] = useState<Tab>('sheet');
    // 자체 카페(is_own)의 client 를 전부 스코프에 넣는다.
    //   ⚠️ 예전엔 LEAK_CAFE_CLIENT_ID 하나만 넘겨서, 2026-08-20 에 추가한 경기·인천·누수의 모든것이
    //     각자 다른 client_id 라 화면에서 통째로 빠져 있었다. 상수에 손으로 적어두면 또 빠진다.
    //     is_own 에서 매번 만들면 새 자체 카페가 자동으로 들어온다.
    const [scope, setScope] = useState<string[]>([LEAK_CAFE_CLIENT_ID]);
    useEffect(() => {
        let alive = true;
        void getCafeAccounts().then(({ data }) => {
            if (!alive) return;
            const ids = new Set<string>([LEAK_CAFE_CLIENT_ID]);
            for (const a of data) if (a.is_own && a.client_id) ids.add(a.client_id);
            setScope([...ids]);
        });
        return () => { alive = false; };
    }, []);
    return (
        <div className="flex min-w-0 flex-col gap-4">
            <div>
                <h2 className="m-0 text-base font-bold text-[#0f172a]">누수탐지 카페</h2>
                <p className="m-0 mt-0.5 text-xs text-[#64748b]">우리 카페 {scope.length}곳 관리시트 · 순위 트래커 (계약관리와 별개)</p>
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
                ? <CafeSheetTab key={scope.join(',')} scopeClientId={scope} />
                : <CafeTrackerTab key={scope.join(',')} scopeClientId={scope} />}
        </div>
    );
}
