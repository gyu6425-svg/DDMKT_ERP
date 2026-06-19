// crawlLib 골든 회귀 — extractKeyword(파이썬과 동일)·parseRss. 실행: node functions/lib/crawlLib.test.mjs
import { extractKeyword, parseRss, todayKST } from './crawlLib.mjs';

let failed = 0;
const eq = (desc, got, exp) => {
    const ok = got === exp;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${desc}: ${JSON.stringify(got)}${ok ? '' : ` (기대 ${JSON.stringify(exp)})`}`);
    if (!ok) failed++;
};

// extractKeyword — 파이썬 골든과 동일 결과
eq('인천 석남동 누수탐지', extractKeyword('인천 석남동 누수탐지 욕조 보수 믿을 수 있는 탐지 사례'), '석남동 누수탐지');
eq('인천서구 누수탐지 석남동', extractKeyword('인천서구 누수탐지 석남동 가좌동 빌라누수'), '석남동 누수탐지');
eq('남양주누수탐지 수동면', extractKeyword('남양주누수탐지, 수동면 세탁실 바닥 배수구 누수원인과 복구과정'), '남양주누수탐지');
eq('용인누수탐지 세탁실', extractKeyword('용인누수탐지 세탁실 바닥 배수구'), '용인누수탐지');
eq('남양주 누수탐지', extractKeyword('남양주 누수탐지 PPC관 교체 시공'), '남양주 누수탐지');
eq('가정동 누수탐지', extractKeyword('가정동 누수탐지 빌라'), '가정동 누수탐지');

// parseRss — RSS 2.0 블록 파싱
const xml = `<rss><channel>
<item><title>인천 석남동 누수탐지 욕조 보수</title><link>https://blog.naver.com/st7al_i_byid-/224320636263</link><pubDate>Thu, 19 Jun 2026 09:00:00 +0900</pubDate></item>
<item><title><![CDATA[남양주누수탐지, 수동면 세탁실]]></title><link>https://blog.naver.com/st7al_i_byid-/111111111111</link><pubDate>Wed, 18 Jun 2026 10:00:00 +0900</pubDate></item>
</channel></rss>`;
const items = parseRss(xml, 5);
eq('parseRss 개수', items.length, 2);
eq('parseRss[0] url', items[0].url, 'https://blog.naver.com/st7al_i_byid-/224320636263');
eq('parseRss[0] title', items[0].title, '인천 석남동 누수탐지 욕조 보수');
eq('parseRss[1] CDATA title', items[1].title, '남양주누수탐지, 수동면 세탁실');
eq('parseRss[0] date(KST)', items[0].published_date, '2026-06-19');
eq('parseRss[0] keyword', extractKeyword(items[0].title), '석남동 누수탐지');

console.log('todayKST 예시:', todayKST(new Date('2026-06-19T20:00:00Z')), '(UTC 20시 → KST 다음날)');
if (failed) {
    console.log(`\n[FAIL] ${failed}건`);
    process.exit(1);
}
console.log('\n[OK] crawlLib 전체 통과');
