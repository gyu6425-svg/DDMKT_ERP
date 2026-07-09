// JS 파서 골든 회귀 — crawler/dumps 픽스처로 파이썬(test_parsers.py)과 동일 결과인지 검증.
// 실행:  node functions/lib/naverRank.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { rankInBlogtab, rankInPopular, websitePresent } from './naverRank.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DUMPS = join(HERE, '..', '..', 'crawler', 'dumps');
const OUR = 'st7al_i_byid-';
const read = (name) => readFileSync(join(DUMPS, name), 'utf8');

const CASES = [
    // 2026-07-09 규칙 재정의(하이브리드 카운트) — 사용자 확정: 통합탭 = 광고·이미지/동영상·플레이스만 빼고
    //   위에서부터 화면 칸을 센다. 웹사이트(문서)도 순위 칸 포함(백석동 실측: 당근·구글 뒤 블로그=3위).
    //   · 웹사이트 블록 = 한 칸(같은 사이트 하위 링크 여러 개여도) · 블로그/카페 인기글 = 카드(r)마다 한 칸.
    //   아래 기대값은 이 규칙으로 재기준화(이전 '웹사이트 제외'·'섹션내 순위' 값 폐기). 파이썬 test_parsers.py 와 동일.
    ['석남동 통합탭', (h) => rankInPopular(h, OUR), '통합탭_석남동_누수탐지_2026_06_19.html', 4, 'ok'],
    ['인천석남동 통합탭', (h) => rankInPopular(h, OUR), '통합탭_2026_06_19.html', 3, 'ok'],
    ['인천연희동 통합탭', (h) => rankInPopular(h, 'rlawhddls125'), '통합탭_인천_연희동_누수탐지_2026_06_19.html', 5, 'ok'],
    // 유리교체: 웹사이트 포함 화면순 — windoorplus=3, ist3ist3=9, kimdo3040=13(전역 카운트).
    ['유리교체 통합탭(상단 블로그)', (h) => rankInPopular(h, 'windoorplus'), '통합탭_유리교체_2026_06_23.html', 3, 'ok'],
    ['유리교체 통합탭(블로그 1)', (h) => rankInPopular(h, 'ist3ist3'), '통합탭_유리교체_2026_06_23.html', 9, 'ok'],
    ['유리교체 통합탭(블로그 2)', (h) => rankInPopular(h, 'kimdo3040'), '통합탭_유리교체_2026_06_23.html', 13, 'ok'],
    // likesign(간판) 글단위 — 웹사이트 포함 화면순. #1=web섹션 첫칸=1위(이전 규칙 권외였음), #2=2위, 추적글=권외.
    ['통합탭 blogId(아무 글이나)', (h) => rankInPopular(h, 'likesign'), '통합탭_likesign_글단위_2026_06_24.html', 1, 'ok'],
    ['통합탭 글단위 #1글(web섹션)', (h) => rankInPopular(h, 'likesign', '224066671070'), '통합탭_likesign_글단위_2026_06_24.html', 1, 'ok'],
    ['통합탭 글단위 #2글', (h) => rankInPopular(h, 'likesign', '224258926265'), '통합탭_likesign_글단위_2026_06_24.html', 2, 'ok'],
    ['통합탭 글단위 추적글(권외)', (h) => rankInPopular(h, 'likesign', '224291228962'), '통합탭_likesign_글단위_2026_06_24.html', 99, 'out'],
    // 칠곡 업소용가구(pjyysh) — 웹사이트 포함 화면순 카드 대표글=5위. 6/11글은 관련글에만 → 권외(규칙 무관).
    ['통합탭 글단위 카드대표글(5/15)', (h) => rankInPopular(h, 'pjyysh', '224286383537'), '통합탭_칠곡업소용가구_글단위_2026_06_24.html', 5, 'ok'],
    ['통합탭 글단위 관련글(6/11,권외)', (h) => rankInPopular(h, 'pjyysh', '224312956224'), '통합탭_칠곡업소용가구_글단위_2026_06_24.html', 99, 'out'],
    ['통합탭 blogId(칠곡 pjyysh)', (h) => rankInPopular(h, 'pjyysh'), '통합탭_칠곡업소용가구_글단위_2026_06_24.html', 5, 'ok'],
    // 김포 경호업체 — web(sks303040 문서) 포함 → 그 뒤 인기글 2위. 웹사이트탭 존재는 별개(아래 유지).
    ['통합탭 더맨시스템', (h) => rankInPopular(h, 'themansystem-', '224299201732'), '통합탭_김포경호업체_2026_06_24.html', 2, 'ok'],
    // 멀티카드 회귀방지 — 인기글 블록 안 서로 다른 블로그(r=2·r=5)는 각자 순위. web 1칸 포함해 3·6위.
    ['통합탭 ugB 멀티카드 2위', (h) => rankInPopular(h, 'jhbillfallma', '224316244666'), '통합탭_김포경호업체_2026_06_24.html', 3, 'ok'],
    ['통합탭 ugB 멀티카드 5위', (h) => rankInPopular(h, 'gkstjeo97', '224317276845'), '통합탭_김포경호업체_2026_06_24.html', 6, 'ok'],
    // 안산 푸르지오9차 — 위 웹사이트/문서 섹션 포함 화면순 → 6위.
    ['통합탭 안산 design_do_', (h) => rankInPopular(h, 'design_do_', '224266735547'), '통합탭_안산푸르지오9차_2026_06_24.html', 6, 'ok'],
    // 경기광주 인테리어필름(vision1803) — 당근/Moons(웹사이트) 포함 화면순: 6/22글=6, 6/11글=8, 5/11글=권외.
    ['통합탭 경기광주 6/22글', (h) => rankInPopular(h, 'vision1803', '224323414074'), '통합탭_경기광주인테리어필름_2026_06_25.html', 6, 'ok'],
    ['통합탭 경기광주 6/11글', (h) => rankInPopular(h, 'vision1803', '224313044691'), '통합탭_경기광주인테리어필름_2026_06_25.html', 8, 'ok'],
    ['통합탭 경기광주 5/11글(권외)', (h) => rankInPopular(h, 'vision1803', '224281526330'), '통합탭_경기광주인테리어필름_2026_06_25.html', 99, 'out'],
    ['통합탭 경기광주 blogId(첫글)', (h) => rankInPopular(h, 'vision1803'), '통합탭_경기광주인테리어필름_2026_06_25.html', 6, 'ok'],
    // 웹사이트(문서)탭 존재 여부 — likesign #1글은 web 섹션에 있음, 더맨시스템은 web 섹션에 없음.
    ['웹사이트탭 likesign #1글(있음)', (h) => ({ rank: websitePresent(h, 'likesign', '224066671070') === '있음' ? 1 : 99, status: websitePresent(h, 'likesign', '224066671070') }), '통합탭_likesign_글단위_2026_06_24.html', 1, '있음'],
    ['웹사이트탭 더맨시스템(없음)', (h) => ({ rank: websitePresent(h, 'themansystem-', '224299201732') === '있음' ? 1 : 99, status: websitePresent(h, 'themansystem-', '224299201732') }), '통합탭_김포경호업체_2026_06_24.html', 99, '없음'],
    ['석남동 블로그탭(순위밖)', (h) => rankInBlogtab(h, OUR), '블로그탭B_석남동_누수탐지_2026_06_19.html', 99, 'out'],
    // 블로그탭 순위 = 그 글의 clickLog r(화면순위). 미유외과 7월진료 글 r=12(실제 12위) — position(4) 아님.
    ['미유외과 블로그탭(r=12)', (h) => rankInBlogtab(h, 'meuclinic', '224325467804'), '블로그탭_미유외과7월진료_2026_06_25.html', 12, 'ok'],
];

let failed = 0;
for (const [desc, fn, dump, expRank, expStatus] of CASES) {
    const { rank, status } = fn(read(dump));
    const ok = rank === expRank && status === expStatus;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${desc}: rank=${rank} status=${status} (기대 ${expRank}/${expStatus})`);
    if (!ok) failed++;
}
if (failed) {
    console.log(`\n[FAIL] ${failed}건 — 파이썬 골든과 불일치. 포팅 점검 필요.`);
    process.exit(1);
}
console.log('\n[OK] JS 파서 = 파이썬 골든 일치');
