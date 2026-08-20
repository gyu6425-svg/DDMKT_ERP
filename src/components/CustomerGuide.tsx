import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { GuideOverlay, type GuideStep } from './GuideOverlay';

// 고객(viewer) ERP '카페 배포' 사용 가이드 — 검정+블러 배경에 빨간 네모 스포트라이트로 접수 폼을 항목별 안내.
//   ⚠️ profiles.onboarded 는 '가이드 봤음'이 아니라 카카오 가입 완료 플래그(별개). '봤음'은 localStorage로만 1회 관리.
const GUIDE_KEY = (uid: string) => `cafeDeployGuideSeen:${uid}`;
// 접수 화면 경로 — 담당자 미리보기(?as=업체)를 유지한다. 안 챙기면 미리보기가 풀려 빈 폼 위에서 투어가 돈다.
const cafeIntakePath = () => {
    const as = new URLSearchParams(window.location.search).get('as');
    return `/portal/cafe?sub=${encodeURIComponent('카페 배포')}${as ? `&as=${encodeURIComponent(as)}` : ''}`;
};

const BASIC_SEL = '[data-tour="cafe-deploy-basic"]';

// ── 단계 조립 ─────────────────────────────────────────────────────────────
//   접수 폼은 '배포 종류 × 키워드 잡는 방식'에 따라 보이는 칸이 통째로 달라진다.
//   그래서 고정 목록이 아니라 지금 고른 방식(deploy_type)에 맞는 단계만 만들어 준다.
//   플래그 정의는 CafeDeployIntake 와 1:1 — 직접형=일반 배포 / 지역형·키워드형·인기직접형·정보형=인기탭 배포.
//   ※ 연관형은 화면 카드에서 빠졌지만(정보형에 흡수) 과거 접수 레코드가 있어 분기는 남겨 둔다.
const S = (selector: string | undefined, title: string, body: string): GuideStep => ({ selector, title, body });

function buildSteps(dt: string): GuideStep[] {
    const isManual = dt === '직접형';
    const isKw = dt === '키워드형';
    const isPopManual = dt === '인기직접형';
    const isInfo = dt === '정보형' || dt === '연관형';
    const isRegion = !isManual && !isKw && !isPopManual && !isInfo;   // 지역형(기본)

    const modeName = isManual ? '일반 배포'
        : isKw ? '키워드형' : isPopManual ? '직접 입력형' : isInfo ? '정보형' : '지역형';

    const steps: GuideStep[] = [
        S(undefined, '카페 배포 접수 가이드 👋',
            '카페 발행을 접수하는 순서를 처음부터 끝까지 짚어 드릴게요.\n'
            + `지금 고르신 방식(${modeName})에 맞는 칸만 안내합니다.\n`
            + '언제든 "건너뛰기"로 닫을 수 있습니다.'),

        S('[data-tour="cafe-deploy-type-cards"]', '배포 종류',
            '· 일반 배포 — 인기탭을 따지지 않고, 적어 주신 키워드 그대로 발행합니다.\n'
            + '· 인기탭 배포 — 실제 인기글 섹션에 들어갈 수 있는 키워드만 골라 발행합니다.\n\n'
            + '카드를 눌러 고르세요. 인기탭 배포를 고르면 아래에 "키워드 잡는 방식"이 나옵니다.'),
    ];

    if (!isManual) {
        steps.push(S('[data-tour="cafe-deploy-kwmode"]', '키워드 잡는 방식 (4가지)',
            '· 지역형 — 원하는 지역을 골라서 노출되고 싶을 때 (지역 + 제품키워드)\n'
            + '· 키워드형 — 플레이스 주소로 우리 업체 키워드를 잡을 때\n'
            + '· 직접 입력형 — 내가 원하는 키워드를 직접 적고 인기탭 확인 후 배포할 때\n'
            + '· 🌐 정보형 — 대표 단어나 홈페이지·블로그 주소로 키워드를 뽑아 낼 때\n\n'
            + `고르는 방식에 따라 아래 입력칸이 바뀝니다. 지금은 "${modeName}" 기준으로 안내합니다.`));
    }

    // 방식별 전용 키워드 블록 — 여기서 실제로 인기탭에 들어갈 키워드를 찾는다.
    if (isInfo) {
        steps.push(S('[data-tour="cafe-deploy-kw-seed"]', '① 연관어로 찾기',
            '대표 단어를 쉼표로 적고(예: 창업, 프랜차이즈)\n'
            + '· "🔎 단어 발굴" — 어떤 단어를 쓸지 모를 때 비슷한 단어를 찾아 줍니다\n'
            + '· "① 연관어 펼치기" — 그 단어의 연관 키워드를 펼칩니다\n'
            + '· 목록에서 확인할 키워드를 고르고 "③ 인기탭 찾기"\n\n'
            + '찾은 키워드는 화면 맨 위 "발굴 적재함"에 쌓입니다.'));
        // ②주소로 찾기 블록은 정보형에만 있다(연관형 레코드에는 없음) → 그 경우 단계도 빼야 헛짚지 않는다.
        if (dt === '정보형') steps.push(S('[data-tour="cafe-deploy-kw-site"]', '② 주소로 찾기',
            '홈페이지·네이버 블로그 주소를 넣고 "⬇ 주소로 가져오기" → 글에서 키워드를 뽑아 냅니다.\n'
            + '· 플레이스가 있으면 "⬇ 플레이스 리뷰 가져오기"도 함께\n'
            + '· "① 키워드 뽑기" → 쓸 키워드만 체크 → "③ 인기탭 찾기"\n'
            + '· 국내 지역이 없는 업체(해외·전국)는 "🌏 지역 없음"을 체크하세요\n\n'
            + '💡 블로그와 홈페이지를 같이 넣으면 키워드가 훨씬 많이 나옵니다.'));
    }
    if (isPopManual) {
        steps.push(S('[data-tour="cafe-deploy-kw-manual"]', '키워드 직접 입력',
            '발행하고 싶은 키워드를 하나씩 적고 "추가"(최대 50개).\n'
            + '다 모았으면 "인기탭 확인"을 누르면 실제 인기글 섹션에 들어가는 것만 남습니다.'));
    }

    steps.push(S('[data-tour="cafe-deploy-company"]', '업체명',
        '발행 글에 나갈 업체 이름입니다. 계약된 이름이 자동으로 채워집니다.\n'
        + '실제 상호와 다르면 고쳐 주세요 — 이 이름 그대로 글에 나갑니다. (필수)'));

    if (!isManual) {
        steps.push(S('[data-tour="cafe-deploy-url"]',
            isKw ? '플레이스 주소 (필수)' : '홈페이지 (선택)',
            isKw
                ? '네이버 플레이스 주소를 붙여넣고 "정확 인기탭 분석"을 누르세요.\n'
                  + '워커가 실제 인기글 섹션을 확인합니다(수초~수십초).\n\n'
                  + '플레이스에 메뉴·정보가 부족하면 "📋 상세 정보 입력"에 소개글·메뉴를 붙여넣어 주시면 담당자가 키워드 선정에 씁니다.'
                : '있으면 적어 주세요. 담당자가 업체를 파악하는 데 씁니다(필수 아님).'
                  + (isInfo ? '\n\n※ 키워드를 뽑는 주소는 위 "주소로 찾기" 칸에 넣어야 합니다. 여기 적은 주소는 읽지 않습니다.' : '')));
    }

    // 키워드형은 이 칸이 화면에 그대로 보인다(숨기지 않음) → 투어에서 건너뛰면 "왜 안 짚지?"가 된다.
    if (isKw) {
        steps.push(S('[data-tour="cafe-deploy-keyword"]', '키워드 (참고용)',
            '플레이스 분석으로 잡히지 않는 키워드가 있으면 여기에 적어 두세요.\n'
            + '접수 내용에 그대로 저장되어 담당자가 참고합니다(자동 판정 대상은 아닙니다).'));
    }

    if (isRegion) {
        steps.push(S('[data-tour="cafe-deploy-region"]', '지역 선택 (복수)',
            '노출되고 싶은 지역을 모두 고르세요.\n'
            + '고르지 않으면 서울·경기·인천으로 찾습니다.\n'
            + '너무 많이 고르면 확인할 조합이 급격히 늘어 오래 걸립니다.'));
        steps.push(S('[data-tour="cafe-deploy-keyword"]', '제품 키워드 (업종)',
            '"입주청소"처럼 우리가 파는 것을 적고 "추가"를 눌러 칩으로 쌓으세요.\n'
            + '· "🎯 인기탭 찾기" — 지역 × 제품키워드 조합에서 인기탭에 들어가는 것만 걸러 냅니다\n'
            + '· "지역 키워드 생성" — 조합만 먼저 만들어 봅니다\n\n'
            + '⚠️ 적고 "추가"를 안 누르면 칩에 안 담깁니다.'));
    }
    if (isManual) {
        steps.push(S('[data-tour="cafe-deploy-keyword"]', '발행 키워드 (직접 입력)',
            '발행할 키워드를 적고 "추가"(최대 50개).\n'
            + '일반 배포는 인기탭을 따지지 않고 적어 주신 그대로 발행합니다.'));
    }

    steps.push(S('[data-tour="cafe-deploy-schedule"]', '발행 일정 · 건수',
        '· 미션 시작일 — 언제부터 발행할지\n'
        + '· 일 발행건수 — 하루 최대 5건 (계정 안전을 위한 상한)\n'
        + '· 총 발행건수 — 이번에 받을 전체 건수\n'
        + '· 상품종류 — 카페로 고정(수정 불가)\n\n'
        + '총 발행건수보다 고른 키워드가 적으면, 접수할 때 "나머지는 맡길게요"를 고를 수 있습니다.'));

    steps.push(S('[data-tour="cafe-deploy-account"]', '카페 발행 정보 (대신 발행용)',
        '저희가 고객님 카페에 대신 글을 올리기 위해 필요합니다.\n'
        + '· 네이버 아이디 · 비밀번호 — 안전하게 보관되고 화면에는 표시되지 않습니다\n'
        + '· 발행 카페명 · 게시판 — 어느 카페 어느 게시판에 올릴지\n'
        + '· 2단계 인증을 쓰신다면 반드시 체크해 주세요 (자동 로그인이 막혀 발행이 안 됩니다)'));

    steps.push(S('[data-tour="cafe-deploy-photos"]', '사진 전달',
        '· 메인배너 — 글 맨 위 이미지\n'
        + '· 실사사진 — 현장·시공 사진(많을수록 좋습니다)\n'
        + '· 배너 — 글 끝 홍보 이미지\n\n'
        + '올리면 자동으로 압축됩니다. 사진이 없어도 접수는 되지만 글 품질이 떨어집니다.'));

    // ★ 선불 토큰제에서는 잔액이 0이면 접수 버튼이 잠겨 있다. "이제 접수해 보세요"로 끝내면
    //   투어는 하라 하고 버튼은 회색인 상태가 되어 사장님이 그 자리에서 멈춘다(검증 2026-08-20).
    const locked = typeof document !== 'undefined'
        && !!document.querySelector('[data-tour="cafe-deploy-submit"][disabled]');

    steps.push(S('[data-tour="cafe-deploy-submit"]', '접수하기',
        locked
            ? '지금은 발행 건수(토큰)가 없어 접수 버튼이 잠겨 있습니다.\n'
              + '"충전 요청" 탭에서 먼저 충전하시면 이 버튼이 열립니다.'
            : '다 적었으면 "접수하기"를 누르세요.\n'
              + '담당자가 확인 후 세팅해 드립니다.\n'
              + '접수 후에도 내용 수정이 필요하면 담당자에게 말씀해 주세요.'));

    steps.push(S(undefined, locked ? '먼저 충전이 필요합니다' : '준비 완료! 🎉',
        locked
            ? '"충전 요청" 탭에서 건수를 충전하시면 바로 접수하실 수 있습니다.\n'
              + '충전 방법은 그 탭의 "📖 가이드 보기"에서 안내해 드립니다.'
            : '이제 직접 접수해 보세요.\n다시 보고 싶으면 화면 위 "📖 사용 가이드"를 누르시면 됩니다.'));

    return steps;
}

// 접수 폼이 실제로 화면에 그려져 있는지 — URL 로 판정하면 안 된다.
//   탭 전환(관리시트·순위 트래커·충전내역)은 URL 을 안 바꾸고 state 만 바꾸므로,
//   URL 만 보면 '접수 화면'이라 착각해 폼 없는 상태에서 투어가 시작된다(전체 검정 화면).
const intakeFormMounted = () => !!document.querySelector(BASIC_SEL);

// 접수 화면으로 보낸 뒤 '폼이 실제로 그려지면' 투어를 연다.
//   고정 타이머(900ms)로 열면 계정 로딩이 느릴 때 빈 화면 위에서 시작된다 → 존재 확인 후 시작.
//   최대 6초까지만 기다리고, 그래도 없으면 그냥 연다(설명만이라도 보이게).
function openWhenFormReady(open: () => void): () => void {
    if (!intakeFormMounted()) {
        window.history.pushState(null, '', cafeIntakePath());
        window.dispatchEvent(new Event('app:navigate'));
    }
    let n = 0;
    const t = window.setInterval(() => {
        if (intakeFormMounted() || ++n > 40) { window.clearInterval(t); open(); }
    }, 150);
    return () => window.clearInterval(t);
}

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
        const stop = openWhenFormReady(() => setShow(true));
        return stop;
    }, [role, pending, needsOnboarding, profile?.must_change_password, uid]);

    // '가이드 보기' 버튼에서 다시 열기 — seen 여부와 무관하게 즉시 표시.
    //   다른 탭(관리시트·순위 트래커·충전내역)에서 눌러도 되게 접수 화면으로 먼저 이동한 뒤 띄운다.
    useEffect(() => {
        let stop: (() => void) | undefined;
        const open = () => { stop?.(); stop = openWhenFormReady(() => setShow(true)); };
        window.addEventListener('cafe-guide:open', open);
        return () => { window.removeEventListener('cafe-guide:open', open); stop?.(); };
    }, []);

    const finish = useCallback(() => {
        try { if (uid) localStorage.setItem(GUIDE_KEY(uid), new Date().toISOString()); } catch { /* 무시 */ }
        setShow(false);
    }, [uid]);

    // 접수 폼이 흘려 주는 현재 배포 방식(data-deploy-type)을 읽어 그 방식의 단계만 만든다.
    //   투어를 여는 시점의 선택을 기준으로 잡는다(도중에 바뀌면 단계 수가 흔들려 순서가 어긋난다).
    const [dtype, setDtype] = useState('지역형');
    useEffect(() => {
        if (!show) return;
        const read = () => document.querySelector(BASIC_SEL)?.getAttribute('data-deploy-type') || '';
        const now = read();
        if (now) setDtype(now);
        // 폼이 아직 안 그려졌을 수 있으니 잠깐만 다시 확인(그 뒤엔 고정).
        let n = 0;
        const t = setInterval(() => {
            const v = read();
            if (v) setDtype(v);
            if (v || ++n > 10) clearInterval(t);
        }, 300);
        return () => clearInterval(t);
    }, [show]);

    const steps = useMemo<GuideStep[]>(() => buildSteps(dtype), [dtype]);

    if (!show) return null;
    return <GuideOverlay steps={steps} onFinish={finish} />;
}
