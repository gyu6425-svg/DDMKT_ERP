// crawlLib 골든 회귀 — extractKeyword(파이썬과 동일)·parseRss. 실행: node functions/lib/crawlLib.test.mjs
import { deriveKeyword, extractKeyword, parseRss, pickMainHashtagKeyword, todayKST } from './crawlLib.mjs';

let failed = 0;
const eq = (desc, got, exp) => {
    const ok = got === exp;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${desc}: ${JSON.stringify(got)}${ok ? '' : ` (기대 ${JSON.stringify(exp)})`}`);
    if (!ok) failed++;
};

// extractKeyword — 지역(시>구>동) + 지역 뒤 첫 서비스. 파이썬 test_parsers.py 와 동일 골든.
// 실제 블로그(band14371) 케이스 — 사용자 확정값
eq('덕양구 집기폐기', extractKeyword('덕양구 사무실 집기폐기 삼송동 사무용 책상철거 사무실비우기 사무가구폐기'), '덕양구 집기폐기');
eq('김포시 이사폐기물', extractKeyword('김포시 사무실 이사폐기물 사우동 사무가구철거 빈사무실만들기'), '김포시 이사폐기물');
eq('춘천 유리교체', extractKeyword('춘천 아파트 유리교체 창문이 깨졌을 때 가장 먼저 확인해야 할 것'), '춘천 유리교체');
eq('진해 에어컨청소', extractKeyword('진해 스탠드에어컨 청소 왜 필요할까? 분해 후 확인한 오염 상태'), '진해 에어컨청소');
// 시/구/동 없는 지역(위례·송파) + 선두 설명어(여름/무더위) 제외
eq('위례 에어컨청소', extractKeyword('여름 위례 에어컨청소 왜 필요할까'), '위례 에어컨청소');
eq('위례 위치무관', extractKeyword('에어컨청소 위례 추천하는 이유'), '위례 에어컨청소');
eq('송파 에어컨청소', extractKeyword('무더위 송파 에어컨 청소 추천'), '송파 에어컨청소');
eq('일산서구 책장철거', extractKeyword('일산서구 거실 책장철거 가좌동 안쓰는 가구버리기 폐가구처리 집정리'), '일산서구 책장철거');
eq('송파 변기막힘', extractKeyword('송파 화장실 변기막힘 뚫는 법'), '송파 변기막힘');
eq('구리 오탐방지', extractKeyword('부산 구리 배관 누수탐지'), '부산 누수탐지');
// 광역시(인천)가 동 앞에 별도 토큰이면 함께(사용자 확정: '인천 논현동 간판' 류). 구가 있으면 구 우선.
eq('인천 석남동 누수탐지(광역시+동)', extractKeyword('인천 석남동 누수탐지 욕조 보수 믿을 수 있는 탐지 사례'), '인천 석남동 누수탐지');
eq('인천서구 누수탐지(구 우선)', extractKeyword('인천서구 누수탐지 석남동 가좌동 빌라누수'), '인천서구 누수탐지');
eq('남양주누수탐지 수동면', extractKeyword('남양주누수탐지, 수동면 세탁실 바닥 배수구 누수원인과 복구과정'), '남양주누수탐지');
eq('용인누수탐지 세탁실', extractKeyword('용인누수탐지 세탁실 바닥 배수구'), '용인누수탐지');
eq('남양주 누수탐지', extractKeyword('남양주 누수탐지 PPC관 교체 시공'), '남양주 누수탐지');
eq('가정동 누수탐지', extractKeyword('가정동 누수탐지 빌라'), '가정동 누수탐지');
// 간판=서비스 추가 + 공장/매장=업종수식어 + 광역시 접두. likesign 블로그 실측(주니퍼니/라이크사인).
eq('청라 간판(공장=수식어)', extractKeyword('청라 공장 간판 빠른 시안, 빠른 시공으로'), '청라 간판');
eq('인천 용현동 간판(광역시+동)', extractKeyword('인천 용현동 간판 인하대역 간판잘하는 업체'), '인천 용현동 간판');
eq('논현동 간판(상가=수식어)', extractKeyword('논현동 상가 간판 오피스텔 상가 간판 추천'), '논현동 간판');
eq('신중동 간판', extractKeyword('부천 신중동 간판 먹자골목에 딱 맞는 디자인'), '신중동 간판');
eq('가정동간판(글루형 유지, 뒷단어 제거)', extractKeyword('가정동간판 루원시티 간판은 라이크 사인이 가장 빨라요'), '가정동간판');
// 지역이 시/구/동/사전에 없을 때 '서비스 단어 바로 앞' 단어를 지역으로. puleenbe(에어컨청소) 실측.
eq('용원 에어컨청소(설명어 시작)', extractKeyword('에어컨 관리 시기를 놓치지 마세요 용원 에어컨청소'), '용원 에어컨청소');
eq('진영 에어컨청소(천장형 건너뜀)', extractKeyword('분해 후 오염을 제거해야하는 이유 진영 천장형 에어컨청소'), '진영 에어컨청소');
eq('장유 에어컨청소(냄새 시작)', extractKeyword('냄새 원인 찾으려 열어봤다가 놀란 장유 에어컨청소 현장'), '장유 에어컨청소');

// pickMainHashtagKeyword — 해시태그에서 메인키워드 선택
eq('해시태그 메인', pickMainHashtagKeyword(['춘천유리교체', '춘천아파트유리교체', '유리교체']), '춘천 유리교체');
eq('해시태그 #접두', pickMainHashtagKeyword(['#춘천유리교체', '#춘천아파트유리교체', '#유리교체']), '춘천 유리교체');
eq('해시태그 순서무관', pickMainHashtagKeyword(['유리교체', '춘천아파트유리교체', '춘천유리교체']), '춘천 유리교체');
eq('해시태그 순수서비스없음', pickMainHashtagKeyword(['진해아파트에어컨청소', '진해에어컨청소']), '진해 에어컨청소');
eq('해시태그 1개', pickMainHashtagKeyword(['마포구옥상쓰레기처리']), '마포구옥상쓰레기처리');
eq('해시태그 빈', pickMainHashtagKeyword([]), '');

// deriveKeyword — 깔끔한 해시태그면 우선, 일반 태그면 제목 폴백
eq('derive 해시태그우선', deriveKeyword('춘천 아파트 유리교체 창문이 깨졌을 때', ['춘천유리교체', '춘천아파트유리교체', '유리교체']), '춘천 유리교체');
eq('derive 제목폴백(치우다)', deriveKeyword('덕양구 사무실 집기폐기 삼송동 사무용 책상철거', ['빈사무실', '사무용가구', '대형책상버리는방법']), '덕양구 집기폐기');
eq('derive 태그없음→제목', deriveKeyword('김포시 사무실 이사폐기물 사우동 사무가구철거', []), '김포시 이사폐기물');

// parseRss — RSS 2.0 블록 파싱
const xml = `<rss><channel>
<item><title>인천 석남동 누수탐지 욕조 보수</title><link>https://blog.naver.com/st7al_i_byid-/224320636263</link><pubDate>Thu, 19 Jun 2026 09:00:00 +0900</pubDate></item>
<item><title><![CDATA[남양주누수탐지, 수동면 세탁실]]></title><link>https://blog.naver.com/st7al_i_byid-/111111111111</link><pubDate>Wed, 18 Jun 2026 10:00:00 +0900</pubDate><tag><![CDATA[ 춘천유리교체,춘천아파트유리교체,유리교체 ]]></tag></item>
</channel></rss>`;
const items = parseRss(xml, 5);
eq('parseRss 개수', items.length, 2);
eq('parseRss[1] tags', JSON.stringify(items[1].tags), JSON.stringify(['춘천유리교체', '춘천아파트유리교체', '유리교체']));
eq('parseRss[0] tags 빈', JSON.stringify(items[0].tags), JSON.stringify([]));
eq('parseRss[0] url', items[0].url, 'https://blog.naver.com/st7al_i_byid-/224320636263');
eq('parseRss[0] title', items[0].title, '인천 석남동 누수탐지 욕조 보수');
eq('parseRss[1] CDATA title', items[1].title, '남양주누수탐지, 수동면 세탁실');
eq('parseRss[0] date(KST)', items[0].published_date, '2026-06-19');
eq('parseRss[0] keyword', extractKeyword(items[0].title), '인천 석남동 누수탐지');

console.log('todayKST 예시:', todayKST(new Date('2026-06-19T20:00:00Z')), '(UTC 20시 → KST 다음날)');
if (failed) {
    console.log(`\n[FAIL] ${failed}건`);
    process.exit(1);
}
console.log('\n[OK] crawlLib 전체 통과');
