import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { isUserPresent } from '../lib/useVisiblePolling';
import { listChargeRequests } from '../api/cafeTokens';
import { listSubRequests, agencyPendingSignups } from '../api/orgs';
import { listCafeDeployRequests } from '../api/cafeDeployRequests';

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

// ★ 내부에서 ?as=<업체> 로 고객 화면을 미리보는 중이면 그 스코프를 유지해야 한다.
//   as 를 떨어뜨리면 이동한 화면이 '내 업체'(내부 직원은 없음) 기준으로 다시 그려져
//   아무것도 안 나온다 — 눌러도 안 들어가는 것처럼 보인다(실측 2026-08-20).
const nav = (path: string) => () => {
    const as = new URLSearchParams(window.location.search).get('as');
    const url = as ? `${path}${path.includes('?') ? '&' : '?'}as=${encodeURIComponent(as)}` : path;
    window.history.pushState(null, '', url);
    window.dispatchEvent(new Event('app:navigate'));
    window.scrollTo({ top: 0, behavior: 'smooth' });   // 이미 그 화면이면 아무 일도 안 일어난 것처럼 보인다
};

export default function TokenApprovalAlert() {
    const { profile, role, isAdmin } = useAuth();
    // ?as= 미리보기 중이면 그 업체 기준으로 본다 — 화면 내용과 알림이 어긋나면 둘 중 뭐가 맞는지 알 수 없다.
    const asParam = new URLSearchParams(window.location.search).get('as') || '';
    const clientId = asParam || profile?.client_id || '';
    const [items, setItems] = useState<Alert[]>([]);

    useEffect(() => {
        //   미리보기 중이면 내부 직원도 그 고객의 알림을 그대로 본다.
        const isCustomer = role === 'viewer' || !!asParam;
        if (!isAdmin && !isCustomer) return;
        let alive = true;

        const load = async () => {
            const out: Alert[] = [];

            if (isAdmin) {
                // 주문서(카페 배포 접수) — 대행사 하위 업체 것도 우리가 처리한다(발행은 우리 몫).
                //   이 알림이 없어서 하위 업체가 넣은 접수가 며칠 묻힐 뻔했다(2026-08-20).
                const { data: deploys } = await listCafeDeployRequests(undefined, 100);
                const newIntake = deploys.filter((r) => r.status === '접수').length;
                if (newIntake) out.push({
                    key: 'adm-intake', icon: '📝', tone: 'act',
                    title: '주문서 접수',
                    body: `확인해야 할 새 주문서 ${newIntake}건`,
                    go: nav('/admin?tab=deploy'),
                });

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
                        go: nav('/portal/cafe?tab=charge'),
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
                        go: nav('/portal/cafe?tab=charge'),
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
    }, [isAdmin, role, clientId, asParam]);

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
