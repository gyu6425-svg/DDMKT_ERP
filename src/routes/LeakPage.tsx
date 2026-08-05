import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { canSeeLeakErp } from '../lib/permissions';
import LeakCustomersTab from '../components/leak/LeakCustomersTab';
import LeakJobsTab from '../components/leak/LeakJobsTab';
import LeakLedgerTab from '../components/leak/LeakLedgerTab';
import LeakOutsourcingTab from '../components/leak/LeakOutsourcingTab';
import { Toast } from '../components/leak/ui';

// 누수탐지 ERP — 상담 → 작업·정산 → 통장원장 → 외주발주.
//   4인 전용(김종인·송민경·조재현·장규진). 화면 게이트 + DB RLS(is_leak_member) 이중.
const TABS = [
    { key: 'customers', label: '고객 관리' },
    { key: 'jobs', label: '작업 · 정산' },
    { key: 'ledger', label: '통장 원장' },
    { key: 'outsourcing', label: '외주 발주' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default function LeakPage() {
    const { profile } = useAuth();
    const [tab, setTab] = useState<TabKey>('customers');
    const [toast, setToast] = useState('');

    const notify = (m: string) => {
        setToast(m);
        window.setTimeout(() => setToast(''), 2600);
    };

    useEffect(() => {
        document.title = '누수탐지 ERP';
    }, []);

    if (!canSeeLeakErp(profile?.email)) {
        return (
            <div>
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-8 text-center">
                    <p className="text-sm font-semibold text-[#334155]">접근 권한이 없습니다</p>
                    <p className="mt-1 text-xs text-[#94a3b8]">누수탐지 ERP는 지정된 담당자만 이용할 수 있습니다.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {/* 제목은 Header 가 '누수탐지 ERP' 로 표시한다(중복 방지). 여기서는 탭부터. */}
            <div className="inline-flex w-fit rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-0.5 text-sm font-semibold">
                {TABS.map((t) => (
                    <button
                        className={`rounded-md px-3 py-1.5 ${tab === t.key ? 'bg-white text-[#1e40af] shadow-sm' : 'text-[#94a3b8]'}`}
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        type="button"
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'customers' ? <LeakCustomersTab notify={notify} /> : null}
            {tab === 'jobs' ? <LeakJobsTab notify={notify} /> : null}
            {tab === 'ledger' ? <LeakLedgerTab notify={notify} /> : null}
            {tab === 'outsourcing' ? <LeakOutsourcingTab notify={notify} /> : null}

            <Toast msg={toast} />
        </div>
    );
}
