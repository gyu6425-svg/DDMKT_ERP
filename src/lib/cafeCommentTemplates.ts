// 카페 댓글 자동화 — 고정 템플릿 풀 + 랜덤 생성.
//   {지역}·{키워드} 치환 + 매번 다른 문구(오프너·템플릿·클로저 조합 + 직전 중복 회피). AI 없음·비용 0.
//   sub 전용 신규 파일 — 발행/원고 생성 코드(cafeWriter 등)를 건드리지 않아 병합 안전.

// 도입 감탄사(오프너) — 모든 템플릿 앞에 붙어 변형 수를 크게 늘림('' 포함=안 붙음).
const OPENERS: string[] = ['', '', '오, ', '와, ', '우와 ', '오호, ', '아, ', '헐 '];

// 본문 템플릿 — 사장님 제공 원본 5개 기준(모두 '{지역} {키워드}' 포함) + 동일 스타일 변형 3개.
//   ★모든 템플릿에 지역+키워드가 반드시 들어감(예: 안양 누수탐지).
export const COMMENT_TEMPLATES: string[] = [
    '{지역} {키워드}의 좋은 후기 잘 보고갑니다.',
    '{지역} {키워드} 알아보려고 하다가 보니까 큰 도움되는 정보였어요.',
    '아래층 젖으면 진짜 멘붕인데 원인 깔끔하게 잡아주나 봐요. {지역} {키워드}에 대한 정보 공유 감사합니다!',
    '안그래도 {지역} 이사와서 {키워드} 알아보고 있었는데! 기억하고 있다가 꼭 써먹어야겠어요.',
    '필요한 정보였는데 {지역} {키워드}에 대해서 깔끔하게 정리해주셔서 잘 읽었습니다. 감사합니다!',
    '이런 정보 찾고 있었는데 잘 보고 갑니다. {지역} {키워드} 참고할게요!',
    '{지역} {키워드} 후기 잘 봤습니다. 깔끔하게 잘 해주시나 봐요!',
    '정리 깔끔하게 잘 해주셨네요. {지역} {키워드} 필요하면 참고하겠습니다.',
];

// 선택적 마무리 문구 — 붙이거나 안 붙여 조합 수를 늘림.
const CLOSERS: string[] = ['', '', ' 감사합니다!', ' 좋은 정보 감사해요.', ' 도움 많이 됐어요!'];

function pick<T>(arr: T[], rnd: () => number): T {
    return arr[Math.floor(rnd() * arr.length)];
}

function fill(tpl: string, region: string, keyword: string): string {
    // 치환값을 함수로 넣어 '$&'·'$1' 같은 특수 치환 패턴 오작동 방지.
    return tpl
        .replaceAll('{지역}', () => region.trim())
        .replaceAll('{키워드}', () => keyword.trim())
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function compose(input: { region: string; keyword: string }, rnd: () => number): string {
    const opener = pick(OPENERS, rnd);
    const base = fill(pick(COMMENT_TEMPLATES, rnd), input.region, input.keyword);
    let closer = pick(CLOSERS, rnd);
    // 이미 '!'/'~'/'감사'로 끝나거나, 클로저와 겹치는 말('보고', '도움')이 본문에 있으면 클로저 생략(어색함 방지).
    if (/[!~]$|감사/.test(base)) closer = '';
    else if (closer.includes('도움') && base.includes('도움')) closer = '';
    else if (closer.includes('보고') && base.includes('보고')) closer = '';
    const out = (opener + base + closer).replace(/\s{2,}/g, ' ').trim();
    // 오프너가 붙었는데 본문 첫 글자가 이미 감탄이면 자연스럽게 그대로 둔다(추가 처리 불필요).
    return out;
}

// 랜덤 댓글 1건 생성 — 직전 문구(avoid)와 같으면 몇 번 다시 뽑아 중복 회피.
export function buildComment(
    input: { region: string; keyword: string },
    opts: { avoid?: string; rnd?: () => number } = {},
): string {
    const rnd = opts.rnd ?? Math.random;
    let out = compose(input, rnd);
    for (let i = 0; i < 6 && opts.avoid && out === opts.avoid.trim(); i += 1) {
        out = compose(input, rnd);
    }
    return out;
}
