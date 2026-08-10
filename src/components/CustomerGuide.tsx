import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { GuideOverlay, type GuideStep } from './GuideOverlay';

// 고객(viewer) ERP 첫 로그인 '카페 배포' 사용 가이드 — 검정+블러 배경에 빨간 네모 스포트라이트로 접수 폼 안내.
//   ⚠️ profiles.onboarded 는 '가이드 봤음'이 아니라 카카오 가입 완료 플래그(별개). '봤음'은 localStorage로만 1회 관리.
//   첫 로그인 시 카페 배포 접수 화면으로 이동시킨 뒤 그 폼의 각 단계(data-tour)를 짚어준다.
const GUIDE_KEY = (uid: string) => `cafeDeployGuideSeen:${uid}`;
const CAFE_INTAKE_PATH = `/portal/cafe?sub=${encodeURIComponent('카페 배포')}`;

const BASIC_SEL = '[data-tour="cafe-deploy-basic"]';
// ② 업체·키워드 단계는 고른 배포 방식마다 입력 순서가 아예 다르다 → 방식별 안내로 바꿔 준다.
//   키 = form.deploy_type (접수 폼이 data-deploy-type 으로 흘려 준다).
//   selector 를 주면 그 방식만 다른 곳(전용 키워드 블록)을 빨간 네모로 짚는다.
const KW_SEL = '[data-tour="cafe-deploy-kw"]';
const BASIC_BY_TYPE: Record<string, { title: string; body: string; selector?: string }> = {
    '직접형': {
        title: '② 업체 · 발행 키워드 (일반 배포)',
        body: '① 업체명 입력\n② 발행할 키워드를 적고 “추가”(최대 50개)\n\n인기탭을 따지지 않고 적어 주신 키워드 그대로 발행합니다.',
    },
    '지역형': {
        title: '② 업체 · 키워드 (지역형)',
        body: '① 업체명 입력\n② 원하는 지역을 모두 선택(복수 가능)\n③ 제품 키워드(예: 입주청소)를 적고 “추가”\n④ “지역 키워드 생성” → 지역+키워드 조합에서 인기탭에 들어가는 것만 걸러 드립니다.',
    },
    '키워드형': {
        title: '② 업체 · 키워드 (키워드형)',
        body: '① 업체명 입력\n② 플레이스 주소(URL) 붙여넣기\n③ “정확 인기탭 분석” → 실제 인기글 섹션을 확인합니다(수초~수십초).\n\n플레이스에 메뉴·정보가 부족하면 “📋 상세 정보 입력”에 소개글·메뉴를 붙여넣어 주세요.',
    },
    '인기직접형': {
        selector: KW_SEL,
        title: '② 업체 · 키워드 (직접 입력형)',
        body: '① 업체명 입력\n② 원하는 키워드를 하나씩 적어 칩으로 모으기\n③ 모아 둔 키워드를 한 번에 인기탭 판정 → 실제로 인기글에 들어가는 것만 골라 드립니다.',
    },
    '연관형': {
        selector: KW_SEL,
        title: '② 업체 · 키워드 (연관형)',
        body: '① 업체명 입력\n② 대표 단어 하나만 입력(예: 보홀 · 장기요양) → “① 연관어 펼치기”\n③ 확인할 키워드를 골라 스캔 → 인기탭 가능한 연관 키워드를 찾아 드립니다.\n\n플레이스·지역이 없어도 됩니다.',
    },
    '정보형': {
        title: '② 업체 · 키워드 (정보형)',
        body: '① 업체명 입력\n② 지역 선택(국내 지역이 없으면 “🌏 지역 없음” 체크)\n③ 위치 + 홈페이지·네이버 블로그 주소 입력 → “⬇ 주소로 가져오기”\n④ “① 키워드 뽑기” → 쓸 키워드만 체크 → “③ 제품키워드로 추가” → “지역 키워드 생성”\n\n💡 블로그와 홈페이지를 같이 넣으면 키워드가 훨씬 많이 나옵니다.',
    },
};
const BASIC_FALLBACK = {
    title: '② 업체 · 키워드 입력',
    body: '업체명과 발행할 키워드를 입력합니다. 위에서 고른 방식에 따라 입력 방법이 달라집니다.\n\n· 지역형 — 지역 선택 + 제품키워드\n· 키워드형 — 플레이스 주소\n· 직접 입력형 — 키워드를 직접 적어 인기탭 확인\n· 연관형 — 대표 단어 하나\n· 정보형 — 홈페이지·블로그 주소로 키워드 추출',
};

const STEPS: GuideStep[] = [
    { title: '카페 배포 접수 가이드 👋', body: '카페 발행을 접수하는 방법을 짧게 안내해 드릴게요.\n언제든 “건너뛰기”로 닫을 수 있습니다.' },
    {
        selector: '[data-tour="cafe-deploy-type"]',
        title: '① 배포 종류 선택',
        body: '“일반 배포”(적어 주신 키워드 그대로) 또는 “인기탭 배포”(인기글에 들어갈 키워드만) 중 카드를 눌러 선택합니다.\n\n인기탭 배포를 고르면 아래에 키워드 잡는 방식 5가지가 나옵니다 — 지역형 · 키워드형 · 직접 입력형 · 연관형 · 정보형. 카드 설명을 보고 고르세요.',
    },
    { selector: BASIC_SEL, title: '② 업체 · 키워드 입력', body: '' },   // 본문은 고른 배포 방식에 따라 아래에서 교체
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

    // 접수 폼이 흘려 주는 현재 배포 방식(data-deploy-type)을 따라가며 ② 단계 설명을 바꾼다.
    //   가이드 도중 방식을 바꿔도 설명이 같이 바뀌어야 해서 폴링(가벼운 속성 읽기).
    const [dtype, setDtype] = useState('');
    useEffect(() => {
        if (!show) return;
        const read = () => setDtype(document.querySelector(BASIC_SEL)?.getAttribute('data-deploy-type') || '');
        read();
        const t = setInterval(read, 400);
        return () => clearInterval(t);
    }, [show]);

    const steps = useMemo<GuideStep[]>(
        () => STEPS.map((s) => (s.selector === BASIC_SEL ? { ...s, ...(BASIC_BY_TYPE[dtype] ?? BASIC_FALLBACK) } : s)),
        [dtype],
    );

    if (!show) return null;
    return <GuideOverlay steps={steps} onFinish={finish} />;
}
