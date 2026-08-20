import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { GuideOverlay, type GuideStep } from './GuideOverlay';
import { AGENCY_MIN_COUNT } from '../api/cafeTokens';

// 고객 ERP '충전 요청' 사용 가이드 — 카페 배포 접수 가이드(CustomerGuide)와 같은 방식.
//   토큰을 받아야 주문서를 넣을 수 있는 선불 구조라, **접수 직전까지**를 안내한다.
//   ⚠️ 상대가 다르다: 대행사는 우리(든든한마케팅)에게, 하부 업체는 소속 대행사에게 신청한다.
//     같은 문구로 안내하면 어디에 입금해야 할지 반대로 알게 된다.
const GUIDE_KEY = (uid: string) => `chargeGuideSeen:${uid}`;

// 충전 요청 탭 경로 — 담당자 미리보기(?as=업체)를 유지한다.
//   안 챙기면 미리보기가 풀려 빈 화면 위에서 투어가 돈다(카페 배포 가이드와 같은 함정).
const chargePath = () => {
    const as = new URLSearchParams(window.location.search).get('as');
    return `/portal/cafe?tab=charge${as ? `&as=${encodeURIComponent(as)}` : ''}`;
};

const FORM_SEL = '[data-tour="charge-form"]';
const S = (selector: string | undefined, title: string, body: string): GuideStep => ({ selector, title, body });

function buildSteps(kind: 'agency' | 'sub' | 'direct', agencyName: string): GuideStep[] {
    const seller = kind === 'sub' ? (agencyName || '소속 대행사') : '든든한마케팅';
    const steps: GuideStep[] = [
        S(undefined, '충전 요청 가이드 👋',
            '카페에 글을 발행하려면 먼저 **발행 건수(토큰)**를 충전해야 합니다.\n'
            + `${seller} 에 신청하고 → 금액을 통보받고 → 입금하면 → 건수가 들어옵니다.\n\n`
            + '순서대로 짚어 드릴게요. 언제든 "건너뛰기"로 닫을 수 있습니다.'),

        S('[data-tour="charge-balance"]', '지금 몇 건 남았나',
            '· 잔여 발행 — 지금 쓸 수 있는 건수입니다. 0이면 주문서를 넣을 수 없습니다.\n'
            + '· 총 충전 — 지금까지 받은 건수\n'
            + '· 총 사용(발행) — 실제 발행에 쓴 건수\n\n'
            + '발행 1건 = 1건 차감입니다.'),

        S('[data-tour="charge-method"]', '① 결제 방식',
            '계좌이체 · 카드결제 · 기타 중에서 고르세요.\n'
            + `${seller} 담당자가 이 방식에 맞춰 안내드립니다.`),

        S('[data-tour="charge-count"]', '② 건수',
            kind === 'agency'
                ? `필요한 발행 건수를 적으세요. 대행사는 최소 ${AGENCY_MIN_COUNT}건부터 신청할 수 있습니다.\n`
                  + '나중에 더 필요하면 추가로 신청하시면 되고, 건수는 누적됩니다.'
                : '필요한 발행 건수를 적으세요.\n'
                  + '한 번에 처리 중인 신청은 하나뿐입니다 — 이번 건이 끝나야 다음 신청이 됩니다.'),

        S('[data-tour="charge-submit"]', '③ 충전 요청',
            `누르면 ${seller} 에 신청이 접수됩니다.\n`
            + '**이 단계에서는 아직 입금하지 마세요.** 금액을 먼저 통보받습니다.'),

        S('[data-tour="charge-list"]', '④ 금액 통보 받기',
            '신청한 건이 아래 목록에 쌓입니다. 상태가 이렇게 바뀝니다:\n\n'
            + '접수 → 금액 통보 → 입금 확인 중 → 충전완료\n\n'
            + '"금액 통보"가 되면 공급가 · 부가세 · 입금액이 표시됩니다.\n'
            + '금액은 부가세 별도로 안내되고, 실제 입금액은 부가세를 더한 값입니다.'),

        S('[data-tour="charge-account"]', '⑤ 입금 계좌 확인',
            '금액과 함께 **입금 계좌**가 전달됩니다. 이 계좌로 입금해 주세요.\n\n'
            + '주황색 상자에 은행 · 계좌번호 · 예금주가 적혀 있습니다.\n'
            + '통보 전에는 이 상자가 보이지 않습니다.'),

        S('[data-tour="charge-declare"]', '⑥ 계좌이체 완료',
            '입금하신 뒤 **입금자명**을 적고 "계좌이체 완료"를 눌러 주세요.\n'
            + '입금자명이 통장에 찍힌 이름과 다르면 확인이 늦어집니다.\n\n'
            + `${seller} 담당자가 통장을 확인하면 건수가 바로 들어옵니다.`),

        S(undefined, '충전이 끝나면 🎉',
            '건수가 들어오면 위 "잔여 발행"이 늘어납니다.\n'
            + '그 다음 **"주문서 작성" 탭**에서 발행할 내용을 접수하시면 됩니다.\n'
            + '주문서 작성은 그 탭의 "📖 가이드 보기"에서 따로 안내해 드립니다.\n\n'
            + '이 가이드는 "📖 가이드 보기"로 다시 볼 수 있습니다.'),
    ];
    return steps;
}

// 충전 요청 폼이 실제로 그려졌는지 — URL 로 판정하면 안 된다.
//   탭 전환은 state 만 바꾸므로 URL 만 보면 폼 없는 상태에서 투어가 시작된다(검정 화면).
const formMounted = () => !!document.querySelector(FORM_SEL);

function openWhenReady(open: () => void): () => void {
    if (!formMounted()) {
        window.history.pushState(null, '', chargePath());
        window.dispatchEvent(new Event('app:navigate'));
    }
    let n = 0;
    const t = window.setInterval(() => {
        // 처리 중인 신청이 있으면 입력 폼이 감춰진다 — 그때는 목록만 보고 진행한다(무한 대기 금지).
        if (formMounted() || document.querySelector('[data-tour="charge-list"]') || ++n > 40) {
            window.clearInterval(t);
            open();
        }
    }, 150);
    return () => window.clearInterval(t);
}

export function ChargeGuide() {
    const { role, profile, pending, needsOnboarding } = useAuth();
    const uid = profile?.user_id || '';
    const asParam = new URLSearchParams(window.location.search).get('as') || '';
    const clientId = asParam || profile?.client_id || '';
    const [show, setShow] = useState(false);
    const [kind, setKind] = useState<'agency' | 'sub' | 'direct'>('direct');
    const [agencyName, setAgencyName] = useState('');

    // 누구에게 신청하는지 — 문구가 통째로 달라진다.
    useEffect(() => {
        if (!clientId) return;
        let alive = true;
        void (async () => {
            const { data } = await supabase.from('clients')
                .select('is_agency,parent_client_id').eq('id', clientId).maybeSingle();
            if (!alive || !data) return;
            if (data.is_agency) { setKind('agency'); return; }
            if (data.parent_client_id) {
                setKind('sub');
                const { data: p } = await supabase.from('clients').select('company').eq('id', data.parent_client_id).maybeSingle();
                if (alive) setAgencyName((p?.company as string) || '');
            }
        })();
        return () => { alive = false; };
    }, [clientId]);

    // 자동 1회 — 아직 안 본 계정에만. 게이트(승인대기·온보딩·비번변경) 해제 뒤.
    //   ★ 카페 배포 가이드가 먼저 뜨는 계정에는 띄우지 않는다 — 투어 두 개가 겹치면 둘 다 못 본다.
    useEffect(() => {
        if (role !== 'viewer' || pending || needsOnboarding || profile?.must_change_password || !uid) return;
        let seen = false;
        try {
            seen = !!localStorage.getItem(GUIDE_KEY(uid))
                || !localStorage.getItem(`cafeDeployGuideSeen:${uid}`);   // 접수 가이드를 아직 안 봤으면 그쪽이 먼저
        } catch { /* 무시 */ }
        if (seen) return;
        const stop = openWhenReady(() => setShow(true));
        return stop;
    }, [role, pending, needsOnboarding, profile?.must_change_password, uid]);

    // '가이드 보기' 버튼 — 다른 탭에서 눌러도 충전 요청 화면으로 먼저 이동한 뒤 띄운다.
    useEffect(() => {
        let stop: (() => void) | undefined;
        const open = () => { stop?.(); stop = openWhenReady(() => setShow(true)); };
        window.addEventListener('charge-guide:open', open);
        return () => { window.removeEventListener('charge-guide:open', open); stop?.(); };
    }, []);

    const finish = useCallback(() => {
        try { if (uid) localStorage.setItem(GUIDE_KEY(uid), new Date().toISOString()); } catch { /* 무시 */ }
        setShow(false);
    }, [uid]);

    const steps = useMemo<GuideStep[]>(() => buildSteps(kind, agencyName), [kind, agencyName]);

    if (!show) return null;
    return <GuideOverlay steps={steps} onFinish={finish} />;
}
