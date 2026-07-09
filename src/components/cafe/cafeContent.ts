// 카페 원고 자동생성기 — 9장 카드에 들어갈 구조화 콘텐츠 스키마 + 기본값(과천 예시).
//   Claude(OpenAI)가 키워드를 받아 이 구조의 JSON을 생성 → 9종 카드 템플릿에 주입 → PNG 캡처.
//   AI 이미지 생성이 아니라 HTML/CSS 템플릿 렌더라 한글·전화번호·FAQ가 100% 정확하게 나온다.

export type CafeFaq = { q: string; a: string };
export type CafeDamage = { period: string; text: string };

export type CafeContent = {
    // 공통(브랜드/지역/연락처)
    brand: string; // 든든한 누수탐지
    branch: string; // 과천점 (푸터 표기: "든든한 누수탐지 과천점")
    region: string; // 과천 (수도권 등 상위 지역은 areaWide)
    areaWide: string; // 수도권
    phone: string; // 010-4614-4424

    // 1) 커버
    coverBadge: string; // 24H LEAK DETECTION
    coverSub: string; // 수도권 누수탐지 전문
    coverTitle: string; // 든든한 누수탐지 (2줄 표기는 렌더에서 처리)
    coverEmphasisPre: string; // 물이 새는
    coverEmphasisHi: string; // 지금이 가장 저렴하게
    coverEmphasisPost: string; // 해결할 수 있는 순간입니다
    coverCta: string; // 24시간 출동 가능

    // 2) CHECK 01 — 이런 상황 아니신가요?
    situations: string[]; // 3개
    situationWarn: string; // 누수는 시간이 지나도 저절로 해결되지 않습니다

    // 3) CHECK 02 — 미룰수록 커지는 누수 피해
    damages: CafeDamage[]; // 하루/일주일/한 달
    damagePunch1: string; // 지금이
    damagePunch2: string; // 가장 저렴한 순간

    // 4) CHECK 03 — 무조건 철거부터? 저희는 다릅니다
    wayIntroPre: string; // 누수는
    wayIntroHi: string; // 벽 속 배관 · 바닥 속 배관 · 천장 내부 · 방수층 · 난방배관
    wayIntroPost: string; // 처럼 보이지 않는 곳에서 생기는 경우가 훨씬 많습니다. 그래서 저희는,
    waySteps: string[]; // 3개
    wayFooter: string; // 필요한 경우에만 공사를 안내드립니다

    // 5) CHECK 04 — 이런 경우 바로 점검이 필요합니다
    checklist: string[]; // 7개

    // 6) CHECK 05 — 발견이 빠를수록 공사는 작아집니다
    whyIntroPre: string; // 같은 누수라도
    whyIntroHi: string; // 언제 발견하느냐
    whyIntroPost: string; // 에 따라 결과가 완전히 달라집니다.
    whyEarlyLabel: string; // 초기에 발견하면
    whyEarly: string; // 간단한 보수로 끝나는 경우가 많습니다
    whyLateLabel: string; // 방치하면
    whyLate: string; // 바닥 철거와 배관 교체까지 이어질 수 있습니다

    // 7) CHECK 06 — 건물부터 배관까지 모든 누수를 다룹니다
    buildingTypes: string[]; // 아파트 빌라 주택 상가 공장
    leakTypes: string[]; // 화장실 누수 …
    serviceFooter: string; // 건물 유형 · 부위 관계없이 진단 가능

    // 8) CHECK 07 — FAQ
    faqs: CafeFaq[]; // 4개

    // 9) 약속 + 연락처
    promises: string[]; // 5개
    promiseClose1: string; // 누수는 발견 시기가 가장 중요합니다.
    promiseClose2: string; // 지금 확인하는 것이 가장 비용을 아끼는 방법입니다.
};

// 기본값 = 과천 예시(사용자 실제 원고). 생성 실패/미생성 시에도 카드가 그대로 렌더된다.
export const DEFAULT_CAFE_CONTENT: CafeContent = {
    brand: '든든한 누수탐지',
    branch: '과천점',
    region: '과천',
    areaWide: '수도권',
    phone: '010-4614-4424',

    coverBadge: '24H LEAK DETECTION',
    coverSub: '수도권 누수탐지 전문',
    coverTitle: '든든한 누수탐지',
    coverEmphasisPre: '물이 새는',
    coverEmphasisHi: '지금이 가장 저렴하게',
    coverEmphasisPost: '해결할 수 있는 순간입니다',
    coverCta: '24시간 출동 가능',

    situations: [
        '갑자기 천장에서 물이 떨어지기 시작했다',
        '수도요금이 평소보다 많이 나왔다',
        '아랫집에서 누수 때문에 연락이 왔다',
    ],
    situationWarn: '누수는 시간이 지나도 저절로 해결되지 않습니다',

    damages: [
        { period: '하루', text: '피해 범위가 커집니다' },
        { period: '일주일', text: '공사 범위가 늘어납니다' },
        { period: '한 달', text: '예상하지 못한 비용까지 발생합니다' },
    ],
    damagePunch1: '지금이',
    damagePunch2: '가장 저렴한 순간',

    wayIntroPre: '누수는',
    wayIntroHi: '벽 속 배관 · 바닥 속 배관 · 천장 내부 · 방수층 · 난방배관',
    wayIntroPost: '처럼 보이지 않는 곳에서 생기는 경우가 훨씬 많습니다. 그래서 저희는,',
    waySteps: [
        '정확한 원인 확인이 먼저입니다',
        '전문 장비로 최소 범위만 진단합니다',
        '합리적인 해결 방법을 안내합니다',
    ],
    wayFooter: '필요한 경우에만 공사를 안내드립니다',

    checklist: [
        '천장에 물자국이 생겼다',
        '벽지가 젖거나 부풀어 올랐다',
        '곰팡이가 반복적으로 생긴다',
        '수도요금이 갑자기 늘었다',
        '화장실 바닥이 항상 젖어 있다',
        '아랫집에서 누수 피해 연락이 왔다',
        '장마철 이후 누수 흔적이 생겼다',
    ],

    whyIntroPre: '같은 누수라도',
    whyIntroHi: '언제 발견하느냐',
    whyIntroPost: '에 따라 결과가 완전히 달라집니다.',
    whyEarlyLabel: '초기에 발견하면',
    whyEarly: '간단한 보수로 끝나는 경우가 많습니다',
    whyLateLabel: '방치하면',
    whyLate: '바닥 철거와 배관 교체까지 이어질 수 있습니다',

    buildingTypes: ['아파트', '빌라', '주택', '상가', '공장'],
    leakTypes: ['화장실 누수', '베란다 누수', '천장 누수', '수도배관', '난방배관', '옥상 누수', '외벽 누수'],
    serviceFooter: '건물 유형 · 부위 관계없이 진단 가능',

    faqs: [
        { q: '누수탐지는 꼭 공사를 해야 하나요?', a: '아닙니다. 원인 확인 후 필요한 경우에만 공사를 안내드립니다.' },
        { q: '집을 많이 뜯어야 하나요?', a: '아닙니다. 전문 장비를 활용해 최소 범위로 진단합니다.' },
        { q: '아랫집 누수도 확인 가능한가요?', a: '가능합니다. 윗집 · 아랫집을 함께 확인해 정확한 원인을 찾습니다.' },
        { q: '보험처리도 가능한가요?', a: '가능합니다. 보험 관련 상담과 서류 안내를 도와드립니다.' },
    ],

    promises: [
        '불필요한 공사 권유 없음',
        '정확한 원인 진단',
        '신속한 현장 대응',
        '합리적인 비용 안내',
        '책임 있는 사후관리',
    ],
    promiseClose1: '누수는 발견 시기가 가장 중요합니다.',
    promiseClose2: '지금 확인하는 것이 가장 비용을 아끼는 방법입니다.',
};

// 카페 글쓰기에 붙여넣을 '본문 원고' 조립 — 카드(이미지) 사이사이에 「사진 N」 위치 표시 + 그 카드 설명글.
//   카드와 100% 같은 문구를 쓰므로 이미지↔본문이 어긋나지 않는다. 반환 = 복사용 전체 텍스트(제목 포함).
export function buildCafePost(c: CafeContent, title: string): string {
    const L: string[] = [];
    const sec = (n: number, label: string) => L.push('', `「사진 ${n}」 ${label}`, '');

    if (title.trim()) {
        L.push(title.trim(), '');
    }
    // 사진 1 — 커버
    sec(1, '커버');
    L.push(`안녕하세요, ${c.brand} ${c.branch}입니다.`);
    L.push(`"${c.coverEmphasisPre} ${c.coverEmphasisHi} ${c.coverEmphasisPost}"`);
    L.push(`저희는 ${c.areaWide} 지역을 중심으로 누수 원인 진단부터 탐지·공사 상담까지 진행하는 ${c.coverSub.replace(/\s*전문\s*$/, '')} 전문 업체입니다.`);

    // 사진 2 — 상황
    sec(2, '이런 상황 아니신가요?');
    L.push('■ 지금 혹시 이런 상황 아니신가요?');
    c.situations.forEach((s) => L.push(`· ${s}`));
    L.push(c.situationWarn + '.');

    // 사진 3 — 피해
    sec(3, '미룰수록 커지는 누수 피해');
    L.push('■ 미룰수록 커지는 누수 피해');
    c.damages.forEach((d) => L.push(`· ${d.period} ▶ ${d.text}`));
    L.push(`그래서 ${c.damagePunch1} ${c.damagePunch2}이라고 말씀드리는 것입니다.`);

    // 사진 4 — 방식
    sec(4, '저희는 다릅니다');
    L.push('■ 무조건 철거부터 하지 않습니다');
    L.push(`${c.wayIntroPre} ${c.wayIntroHi}${c.wayIntroPost}`);
    c.waySteps.forEach((s, i) => L.push(`${i + 1}. ${s}`));
    L.push(`${c.wayFooter}.`);

    // 사진 5 — 자가점검
    sec(5, '이런 경우 바로 점검');
    L.push('■ 이런 경우 바로 점검이 필요합니다');
    c.checklist.forEach((s) => L.push(`· ${s}`));

    // 사진 6 — 시기
    sec(6, '발견이 빠를수록');
    L.push('■ 발견이 빠를수록 공사는 작아집니다');
    L.push(`${c.whyIntroPre} ${c.whyIntroHi}${c.whyIntroPost}`);
    L.push(`· ${c.whyEarlyLabel} ${c.whyEarly}`);
    L.push(`· ${c.whyLateLabel} ${c.whyLate}`);

    // 사진 7 — 서비스
    sec(7, '주요 서비스');
    L.push('■ 건물부터 배관까지 모든 누수를 다룹니다');
    L.push(c.buildingTypes.join(' · ') + ' 누수탐지');
    L.push(c.leakTypes.join(' · '));
    L.push(`${c.serviceFooter}.`);

    // 사진 8 — FAQ
    sec(8, '자주 묻는 질문');
    L.push('■ 가장 많이 물어보시는 질문');
    c.faqs.forEach((f) => {
        L.push(`Q. ${f.q}`);
        L.push(`A. ${f.a}`);
    });

    // 사진 9 — 약속 + 연락처
    sec(9, '약속 + 연락처');
    L.push(`■ ${c.brand} ${c.branch}이 약속드립니다`);
    c.promises.forEach((p, i) => L.push(`${i + 1}. ${p}`));
    L.push('');
    L.push(c.promiseClose1);
    L.push(c.promiseClose2);
    L.push('');
    L.push(`▶ 24시간 상담문의: ${c.phone}`);

    return L.join('\n');
}

// 제목 기본값 — 지역 + 강조문구 기반(수정 가능).
export function defaultCafeTitle(c: CafeContent): string {
    return `${c.region} 누수탐지 | ${c.coverEmphasisPre} ${c.coverEmphasisHi} ${c.coverEmphasisPost}`;
}

// 생성 결과(부분 JSON)를 기본값과 병합 — 누락 필드는 기본값 유지(카드가 비지 않게).
export function mergeCafeContent(partial: Partial<CafeContent> | null | undefined): CafeContent {
    const base = DEFAULT_CAFE_CONTENT;
    if (!partial) return { ...base };
    const pick = <K extends keyof CafeContent>(k: K): CafeContent[K] => {
        const v = partial[k];
        if (v == null) return base[k];
        if (Array.isArray(v) && v.length === 0) return base[k];
        return v as CafeContent[K];
    };
    return {
        brand: pick('brand'),
        branch: pick('branch'),
        region: pick('region'),
        areaWide: pick('areaWide'),
        phone: pick('phone'),
        coverBadge: pick('coverBadge'),
        coverSub: pick('coverSub'),
        coverTitle: pick('coverTitle'),
        coverEmphasisPre: pick('coverEmphasisPre'),
        coverEmphasisHi: pick('coverEmphasisHi'),
        coverEmphasisPost: pick('coverEmphasisPost'),
        coverCta: pick('coverCta'),
        situations: pick('situations'),
        situationWarn: pick('situationWarn'),
        damages: pick('damages'),
        damagePunch1: pick('damagePunch1'),
        damagePunch2: pick('damagePunch2'),
        wayIntroPre: pick('wayIntroPre'),
        wayIntroHi: pick('wayIntroHi'),
        wayIntroPost: pick('wayIntroPost'),
        waySteps: pick('waySteps'),
        wayFooter: pick('wayFooter'),
        checklist: pick('checklist'),
        whyIntroPre: pick('whyIntroPre'),
        whyIntroHi: pick('whyIntroHi'),
        whyIntroPost: pick('whyIntroPost'),
        whyEarlyLabel: pick('whyEarlyLabel'),
        whyEarly: pick('whyEarly'),
        whyLateLabel: pick('whyLateLabel'),
        whyLate: pick('whyLate'),
        buildingTypes: pick('buildingTypes'),
        leakTypes: pick('leakTypes'),
        serviceFooter: pick('serviceFooter'),
        faqs: pick('faqs'),
        promises: pick('promises'),
        promiseClose1: pick('promiseClose1'),
        promiseClose2: pick('promiseClose2'),
    };
}
