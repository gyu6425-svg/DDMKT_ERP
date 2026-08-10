import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { GuideOverlay, type GuideStep } from './GuideOverlay';

// 고객(viewer) ERP 첫 로그인 '카페 배포' 사용 가이드 — 검정+블러 배경에 빨간 네모 스포트라이트로 접수 폼 안내.
//   ⚠️ profiles.onboarded 는 '가이드 봤음'이 아니라 카카오 가입 완료 플래그(별개). '봤음'은 localStorage로만 1회 관리.
//   첫 로그인 시 카페 배포 접수 화면으로 이동시킨 뒤 그 폼의 각 단계(data-tour)를 짚어준다.
const GUIDE_KEY = (uid: string) => `cafeDeployGuideSeen:${uid}`;
const CAFE_INTAKE_PATH = `/portal/cafe?sub=${encodeURIComponent('카페 배포')}`;

const STEPS: GuideStep[] = [
    { title: '카페 배포 접수 가이드 👋', body: '카페 발행을 접수하는 방법을 짧게 안내해 드릴게요.\n언제든 “건너뛰기”로 닫을 수 있습니다.' },
    { selector: '[data-tour="cafe-deploy-type"]', title: '① 배포 종류 선택', body: '“일반 배포”(적어주신 키워드 그대로) 또는 “인기탭 배포”(인기글에 들어갈 키워드만) 중 선택합니다.' },
    { selector: '[data-tour="cafe-deploy-basic"]', title: '② 업체 · 키워드 입력', body: '업체명과 발행할 키워드를 입력합니다.\n인기탭 배포는 플레이스 주소로 키워드를 찾을 수 있어요.' },
    { selector: '[data-tour="cafe-deploy-account"]', title: '③ 카페 발행 정보', body: '저희가 대신 발행하기 위한 네이버 계정·카페·게시판 정보입니다.\n비밀번호는 안전하게 보관되고 화면에 표시되지 않습니다.' },
    { selector: '[data-tour="cafe-deploy-photos"]', title: '④ 사진 전달', body: '메인배너·실사사진·배너를 올려 주세요. 업로드 시 자동으로 압축됩니다.' },
    { selector: '[data-tour="cafe-deploy-submit"]', title: '⑤ 접수하기', body: '작성을 마치면 “접수하기”를 누르세요. 담당자 확인 후 세팅해 드립니다.' },
    { title: '준비 완료! 🎉', body: '이제 카페 배포를 직접 접수해 보세요. 이 가이드는 다시 표시되지 않습니다.' },
];

// 지금 화면이 '카페 배포' 접수 화면인지 — 여기여야 data-tour 타겟(빨간 네모)이 붙는다.
const onIntakeScreen = () => window.location.pathname === '/portal/cafe'
    && new URLSearchParams(window.location.search).get('sub') === '카페 배포';

export function CustomerGuide() {
    const { role, profile, pending, needsOnboarding } = useAuth();
    const uid = profile?.user_id || '';
    const [show, setShow] = useState(false);

    useEffect(() => {
        // 고객(viewer)만 · 게이트(승인대기/온보딩/비번변경) 해제 뒤 · 아직 안 본 계정에만 1회.
        if (role !== 'viewer' || pending || needsOnboarding || profile?.must_change_password || !uid) {
            setShow(false);
            return;
        }
        let seen = false;
        try { seen = !!localStorage.getItem(GUIDE_KEY(uid)); } catch { /* 무시 */ }
        if (seen) return;
        // 카페 배포 접수 화면이 아니면 그리로 이동(커스텀 라우팅: pushState + app:navigate) → 폼 타겟이 마운트되게.
        const onIntake = onIntakeScreen();
        if (!onIntake) {
            window.history.pushState(null, '', CAFE_INTAKE_PATH);
            window.dispatchEvent(new Event('app:navigate'));
        }
        const t = setTimeout(() => setShow(true), 900); // 화면 전환·타겟 마운트 대기
        return () => clearTimeout(t);
    }, [role, pending, needsOnboarding, profile?.must_change_password, uid]);

    // '가이드 보기' 버튼에서 다시 열기 — seen 여부와 무관하게 즉시 표시.
    //   다른 탭(관리시트·순위 트래커·충전내역)에서 눌러도 되게 접수 화면으로 먼저 이동한 뒤 띄운다.
    useEffect(() => {
        let t: number | undefined;
        const open = () => {
            if (onIntakeScreen()) { setShow(true); return; }
            window.history.pushState(null, '', CAFE_INTAKE_PATH);
            window.dispatchEvent(new Event('app:navigate'));
            t = window.setTimeout(() => setShow(true), 600); // 접수 폼 마운트 대기
        };
        window.addEventListener('cafe-guide:open', open);
        return () => { window.removeEventListener('cafe-guide:open', open); if (t) clearTimeout(t); };
    }, []);

    const finish = useCallback(() => {
        try { if (uid) localStorage.setItem(GUIDE_KEY(uid), new Date().toISOString()); } catch { /* 무시 */ }
        setShow(false);
    }, [uid]);

    if (!show) return null;
    return <GuideOverlay steps={STEPS} onFinish={finish} />;
}
