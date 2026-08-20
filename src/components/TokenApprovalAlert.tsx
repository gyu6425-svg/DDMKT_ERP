import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { isUserPresent } from '../lib/useVisiblePolling';
import { listChargeRequests } from '../api/cafeTokens';
import { listSubRequests, agencyPendingSignups } from '../api/orgs';

// 토큰 승인 알림 — 기자단 보고 알림(ReportPublishAlert)과 같은 톤·같은 폴링 방식.
//   ★ 양쪽 모두에게 뜬다. 한쪽만 알면 상대가 기다리는 줄 모른 채 며칠이 지나간다.
//     우리   : 대행사 충전 신청 / 대행사 입금 신고
//     대행사 : 하위 가입 승인 / 하위 충전 신청 / 하위 입금 신고 / **우리가 통보한 금액(입금할 차례)**
//     하위   : 대행사가 통보한 금액(입금할 차례)
//   내 차례가 아닌 건은 띄우지 않는다 — 아무나 볼 수 있는 알림은 아무도 안 본다.

type Alert = {
    key: string;
    icon: string;
    title: string;
    body: string;
    go: () => void;
    tone: 'act' | 'pay';   // act = 내가 처리할 것(주황) / pay = 내가 입금할 것(파랑)
};

const nav = (path: string) => () => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new Event('app:navigate'));
};

export default function TokenApprovalAlert() {
    const { profile, role, isAdmin } = useAuth();
    const clientId = profile?.client_id || '';
    const [items, setItems] = useState<Alert[]>([]);

    useEffect(() => {
        const isCustomer = role === 'viewer';
        if (!isAdmin && !isCustomer) return;
        let alive = true;

        const load = async () => {
            const out: Alert[] = [];

            if (isAdmin) {
                // 우리 큐 — 대행사가 넣은 충전 신청.
                const { data } = await listChargeRequests();
                const toQuote = data.filter((r) => r.status === 'pending').length;
                const toIssue = data.filter((r) => r.status === 'paid').length;
                if (toQuote) out.push({
                    key: 'adm-quote', icon: '💳', tone: 'act',
                    title: '충전 신청',
                    body: `금액을 통보해야 할 신청 ${toQuote}건`,
                    go: nav('/admin?tab=tokens'),
                });
                if (toIssue) out.push({
                    key: 'adm-issue', icon: '🏦', tone: 'act',
                    title: '입금 신고',
                    body: `입금 확인 후 토큰을 발행할 건 ${toIssue}건`,
                    go: nav('/admin?tab=tokens'),
                });
            }

            if (isCustomer && clientId) {
                const { data: me } = await supabase
                    .from('clients').select('is_agency,parent_client_id').eq('id', clientId).maybeSingle();
                const isAgency = !!me?.is_agency;
                const isSub = !!me?.parent_client_id;

                // 내가 입금할 차례 — 우리(또는 대행사)가 금액을 통보한 건.
                if (isAgency) {
                    const { data } = await listChargeRequests(clientId);
                    const quoted = data.filter((r) => r.status === 'quoted').length;
                    if (quoted) out.push({
                        key: 'ag-pay', icon: '💰', tone: 'pay',
                        title: '금액 통보',
                        body: `입금하실 건 ${quoted}건 — 입금 후 ‘계좌이체 완료’를 눌러 주세요`,
                        go: nav('/portal/cafe'),
                    });

                    const [{ data: subs }, { data: signups }] = await Promise.all([
                        listSubRequests({ agencyId: clientId }),
                        agencyPendingSignups(),
                    ]);
                    const subQuote = subs.filter((r) => r.status === 'pending').length;
                    const subIssue = subs.filter((r) => r.status === 'paid').length;
                    if (signups.length) out.push({
                        key: 'ag-signup', icon: '🙋', tone: 'act',
                        title: '하위 가입 승인',
                        body: `승인 대기 ${signups.length}건`,
                        go: nav('/portal/org'),
                    });
                    if (subQuote) out.push({
                        key: 'ag-quote', icon: '💳', tone: 'act',
                        title: '하위 충전 신청',
                        body: `금액을 통보해야 할 신청 ${subQuote}건`,
                        go: nav('/portal/org'),
                    });
                    if (subIssue) out.push({
                        key: 'ag-issue', icon: '🏦', tone: 'act',
                        title: '하위 입금 신고',
                        body: `입금 확인 후 토큰을 발행할 건 ${subIssue}건`,
                        go: nav('/portal/org'),
                    });
                }

                if (isSub) {
                    const { data } = await listSubRequests({ childId: clientId });
                    const quoted = data.filter((r) => r.status === 'quoted').length;
                    if (quoted) out.push({
                        key: 'sub-pay', icon: '💰', tone: 'pay',
                        title: '금액 통보',
                        body: `입금하실 건 ${quoted}건 — 입금 후 ‘계좌이체 완료’를 눌러 주세요`,
                        go: nav('/portal/cafe'),
                    });
                }
            }

            if (alive) setItems(out);
        };

        // ★ 실패하면 이전 값을 유지한다 — 일시적 오류로 배너가 사라지면 대기 건을 놓친다.
        const run = () => { void load().catch(() => undefined); };
        run();
        const id = window.setInterval(() => { if (isUserPresent()) run(); }, 60000);
        const onFocus = () => run();
        window.addEventListener('app:navigate', run);
        window.addEventListener('focus', onFocus);
        return () => {
            alive = false;
            window.clearInterval(id);
            window.removeEventListener('app:navigate', run);
            window.removeEventListener('focus', onFocus);
        };
    }, [isAdmin, role, clientId]);

    if (!items.length) return null;

    return (
        <div className="mb-5 grid gap-2">
            {items.map((a) => {
                const pay = a.tone === 'pay';
                return (
                    <div
                        className={`flex items-center gap-3 rounded-2xl border-2 px-5 py-3.5 shadow-sm ${
                            pay ? 'border-[#1d4ed8] bg-[#eff6ff]' : 'border-[#ea580c] bg-[#fff7ed]'
                        }`}
                        key={a.key}
                    >
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl ${
                            pay ? 'bg-[#1d4ed8]' : 'bg-[#ea580c]'
                        }`}>
                            {a.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className={`text-[16px] font-extrabold ${pay ? 'text-[#1d4ed8]' : 'text-[#c2410c]'}`}>
                                {a.title}
                            </div>
                            <div className={`mt-0.5 text-[13px] font-semibold ${pay ? 'text-[#1e3a8a]' : 'text-[#9a3412]'}`}>
                                {a.body}
                            </div>
                        </div>
                        <button
                            className={`h-10 shrink-0 rounded-xl px-5 text-[13px] font-bold text-white ${
                                pay ? 'bg-[#1d4ed8] hover:bg-[#1e3a8a]' : 'bg-[#ea580c] hover:bg-[#c2410c]'
                            }`}
                            onClick={a.go}
                            type="button"
                        >
                            확인하러 가기
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
