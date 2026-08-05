import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { canSeeLeakErp } from '../lib/permissions';
import LeakCustomersTab from '../components/leak/LeakCustomersTab';
import LeakJobsTab from '../components/leak/LeakJobsTab';
import LeakLedgerTab from '../components/leak/LeakLedgerTab';
import LeakOutsourcingTab from '../components/leak/LeakOutsourcingTab';
import { Toast } from '../components/leak/ui';

// 누수탐지 ERP — 메뉴는 좌측 사이드바(Sidebar 의 isLeakView 분기)에서 전환한다.
//   4인 전용(김종인·송민경·조재현·장규진). 화면 게이트 + DB RLS(is_leak_member) 이중.
export type LeakSection = 'customers' | 'jobs' | 'ledger' | 'outsourcing';

export default function LeakPage({ section = 'customers' }: { section?: LeakSection }) {
    const { profile } = useAuth();
    const [toast, setToast] = useState('');

    const notify = (m: string) => {
        setToast(m);
        window.setTimeout(() => setToast(''), 2600);
    };

    if (!canSeeLeakErp(profile?.email)) {
        return (
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-8 text-center">
                <p className="text-sm font-semibold text-[#334155]">접근 권한이 없습니다</p>
                <p className="mt-1 text-xs text-[#94a3b8]">누수탐지 ERP는 지정된 담당자만 이용할 수 있습니다.</p>
            </div>
        );
    }

    return (
        <div className="flex min-w-0 flex-col gap-4">
            {section === 'customers' ? <LeakCustomersTab notify={notify} /> : null}
            {section === 'jobs' ? <LeakJobsTab notify={notify} /> : null}
            {section === 'ledger' ? <LeakLedgerTab notify={notify} /> : null}
            {section === 'outsourcing' ? <LeakOutsourcingTab notify={notify} /> : null}
            <Toast msg={toast} />
        </div>
    );
}
