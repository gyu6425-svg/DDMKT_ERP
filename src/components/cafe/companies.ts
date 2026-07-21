// 업체별 발행 설정 — CafeBanner2Tab 이 company 로 골라 쓴다.
//   새 업체는 여기에 한 항목만 추가하면 탭이 늘어난다(코드 복제 없음).
//   확인 안 된 값(facts/links/footer)은 비워둔다 — 비면 자격서술·링크·연락처가 그냥 빠질 뿐 발행은 정상.

export type CompanyKey = 'theman' | 'seolgo';

export type CompanyConfig = {
    key: CompanyKey;
    label: string;                 // 탭 이름
    brand: string;                 // 상호
    business: string;              // 업종(원고 프롬프트에 전달)
    board: string;                 // 카페 게시판 이름(정확히 일치해야 함)
    fixedDir: string;              // 중간 이미지 폴더 public/images/<dir>
    links: string[];               // 본문 끝 썸네일 카드(카카오·홈페이지 등)
    footer: string;                // 본문 맨 끝 연락처 텍스트(번호는 본문에 안 쓰고 여기서만)
    facts: string[];               // [확인된 사실] — 비면 자격 서술 금지
    tags: (region: string, service: string) => string[];  // 하단 태그 10개
    // 블루 배너 기본값(자동발행은 내용만 바뀌므로 기본값으로 충분)
    secType: string;
    titleLines: [string, string, string];
    // 완성된 고정 배너 이미지(1·8번). 있으면 AI 배너 생성을 건너뛰고 이 이미지를 쓴다(발행 시 미세변형 적용).
    bannerImage?: string;
};

function tagSet(region: string, service: string, extra: string[], brand: string): string[] {
    const r = (region || '').replace(/\s/g, '');
    const s = (service || '').replace(/\s/g, '');
    return [`${r}${s}`, ...extra.map((e) => `${r}${e}`), s, ...extra, brand]
        .filter(Boolean).slice(0, 10);
}

export const COMPANIES: Record<CompanyKey, CompanyConfig> = {
    theman: {
        key: 'theman',
        label: '더맨시스템',
        brand: '더맨시스템',
        business: '보안',
        board: '더맨시스템 시설경호업체',   // 카페(마이클의 정보 세상) menuId=3
        fixedDir: 'theman',
        links: [
            'https://pf.kakao.com/_bJxcQK/chat',   // 카카오톡 채널(로그인 없이 열림 — 확인함)
            'https://themansys.co.kr/',            // 홈페이지
        ],
        footer: ['직통번호 : 010-2068-5484', '', '대표번호 : 032-421-7112', '', '카카오톡'].join('\n'),
        facts: [],
        tags: (region, service) => tagSet(region, service, ['경비업체', '보안업체', '건물관리', '시설경비'], '더맨시스템'),
        secType: '회사 보안',
        titleLines: ['건물의', '안전을', '지킵니다'],
    },
    seolgo: {
        key: 'seolgo',
        label: '설고점',
        brand: '설고점',
        business: '소방',
        board: '설고점 소방의 모든 것',       // 카페(마이클의 정보 세상) menuId=2
        fixedDir: 'seolgo',                    // public/images/seolgo/ (중간이미지 — 사용자 제공 예정)
        links: [],                             // 카톡·홈페이지 확정되면 채움
        footer: '',                            // 연락처 확정되면 채움
        facts: [],
        tags: (region, service) => tagSet(region, service, ['소방점검', '소방시설', '소방업체', '소방관리'], '설고점'),
        secType: '소방 안전',
        titleLines: ['우리 건물', '소방 안전', '점검부터'],
        bannerImage: '/images/seolgo/selgo_main.png',   // 완성 배너(소방관·서울 전지역) — AI 생성 대신 고정 사용
    },
};
