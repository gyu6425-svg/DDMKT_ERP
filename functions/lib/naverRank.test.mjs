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
    // 통합탭 = 광고/web섹션 제외, 보이는 결과(당근/사이트 포함) '카드 단위'로 전부 카운트(섹션내).
    //   2026-06-25 카드단위 전환: 1블록에 카드 2장(당근 등)도 각각 셈 → 5/5/7(기존 블록단위 4/3/5보다↑).
    ['석남동 통합탭', (h) => rankInPopular(h, OUR), '통합탭_석남동_누수탐지_2026_06_19.html', 5, 'ok'],
    ['인천석남동 통합탭', (h) => rankInPopular(h, OUR), '통합탭_2026_06_19.html', 5, 'ok'],
    ['인천연희동 통합탭(사이트 포함)', (h) => rankInPopular(h, 'rlawhddls125'), '통합탭_인천_연희동_누수탐지_2026_06_19.html', 7, 'ok'],
    // 유리교체: 상단 섹션 블로그(windoorplus=3)와 '하위 섹션' 블로그(ist3ist3=9, kimdo3040=13) 모두 잡혀야 함.
    // (구버전 urB_coR-only 였다면 하위 섹션 블로그는 권외로 잘못 나옴 = '트래커 다 안맞아' 버그.)
    ['유리교체 통합탭(상단 블로그)', (h) => rankInPopular(h, 'windoorplus'), '통합탭_유리교체_2026_06_23.html', 3, 'ok'],
    // 섹션내 순위: ist3ist3·kimdo3040 은 urB_boR(블로그) 섹션이라 그 섹션 안에서 1·5위(누적 9·13 아님).
    ['유리교체 통합탭(블로그섹션 1위)', (h) => rankInPopular(h, 'ist3ist3'), '통합탭_유리교체_2026_06_23.html', 1, 'ok'],
    ['유리교체 통합탭(블로그섹션 5위)', (h) => rankInPopular(h, 'kimdo3040'), '통합탭_유리교체_2026_06_23.html', 5, 'ok'],
    // 통합탭 글 단위(logNo) 매칭 — 같은 블로그 다른 글에 순위 오인 방지. likesign(간판) 실측:
    //   #1=224066671070 은 web*(웹사이트/문서) 섹션에만 → 통합탭 권외(웹사이트탭=있음).
    //   #2=224258926265 는 ugB_bsR(인기글) → web 제외 후 1위. 224291228962 는 미노출(권외).
    ['통합탭 blogId(아무 글이나)', (h) => rankInPopular(h, 'likesign'), '통합탭_likesign_글단위_2026_06_24.html', 1, 'ok'],
    ['통합탭 글단위 #1글(web섹션,권외)', (h) => rankInPopular(h, 'likesign', '224066671070'), '통합탭_likesign_글단위_2026_06_24.html', 99, 'out'],
    ['통합탭 글단위 #2글', (h) => rankInPopular(h, 'likesign', '224258926265'), '통합탭_likesign_글단위_2026_06_24.html', 1, 'ok'],
    ['통합탭 글단위 추적글(권외)', (h) => rankInPopular(h, 'likesign', '224291228962'), '통합탭_likesign_글단위_2026_06_24.html', 99, 'out'],
    // 칠곡 업소용가구(pjyysh) — 카드 대표글 5/15글=7위(위쪽 사이트 4개 다 셈), 6/11글은 같은 카드의
    //   afterArticles(관련글) 안에만 등장 → 권외(발행일 다른 글에 순위 전염 금지).
    ['통합탭 글단위 카드대표글(5/15)', (h) => rankInPopular(h, 'pjyysh', '224286383537'), '통합탭_칠곡업소용가구_글단위_2026_06_24.html', 7, 'ok'],
    ['통합탭 글단위 관련글(6/11,권외)', (h) => rankInPopular(h, 'pjyysh', '224312956224'), '통합탭_칠곡업소용가구_글단위_2026_06_24.html', 99, 'out'],
    ['통합탭 blogId(칠곡 pjyysh)', (h) => rankInPopular(h, 'pjyysh'), '통합탭_칠곡업소용가구_글단위_2026_06_24.html', 7, 'ok'],
    // 김포 경호업체(themansystem-) 실측 — web_gen(sks303040 문서) 제외 → ugB_bsR 인기글 1위.
    //   웹사이트(문서)탭엔 우리 글 없음(sks303040 임) → 웹사이트탭=없음.
    ['통합탭 더맨시스템(web제외 1위)', (h) => rankInPopular(h, 'themansystem-', '224299201732'), '통합탭_김포경호업체_2026_06_24.html', 1, 'ok'],
    // ugB_bsR(한 블록=여러 카드) 멀티카드 카운트 — 같은 블록 안 r=2/r=5 글이 1로 뭉개지지 않고 제 순위로.
    //   (서천 출장뷔페 limebuffet 5위 같은 케이스의 회귀 방지.)
    ['통합탭 ugB 멀티카드 2위', (h) => rankInPopular(h, 'jhbillfallma', '224316244666'), '통합탭_김포경호업체_2026_06_24.html', 2, 'ok'],
    ['통합탭 ugB 멀티카드 5위', (h) => rankInPopular(h, 'gkstjeo97', '224317276845'), '통합탭_김포경호업체_2026_06_24.html', 5, 'ok'],
    // 안산 푸르지오9차인테리어(design_do_) 실측 — 위 urB_coR(오늘의집/부동산=웹사이트/문서) 섹션 다음
    //   urB_boR(블로그) 섹션의 첫 카드 → 섹션내 1위(누적이면 6위로 오인).
    ['통합탭 안산 design_do_(섹션내 1위)', (h) => rankInPopular(h, 'design_do_', '224266735547'), '통합탭_안산푸르지오9차_2026_06_24.html', 1, 'ok'],
    // 웹사이트(문서)탭 존재 여부 — likesign #1글은 web 섹션에 있음, 더맨시스템은 web 섹션에 없음.
    ['웹사이트탭 likesign #1글(있음)', (h) => ({ rank: websitePresent(h, 'likesign', '224066671070') === '있음' ? 1 : 99, status: websitePresent(h, 'likesign', '224066671070') }), '통합탭_likesign_글단위_2026_06_24.html', 1, '있음'],
    ['웹사이트탭 더맨시스템(없음)', (h) => ({ rank: websitePresent(h, 'themansystem-', '224299201732') === '있음' ? 1 : 99, status: websitePresent(h, 'themansystem-', '224299201732') }), '통합탭_김포경호업체_2026_06_24.html', 99, '없음'],
    ['석남동 블로그탭(순위밖)', (h) => rankInBlogtab(h, OUR), '블로그탭B_석남동_누수탐지_2026_06_19.html', 99, 'out'],
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
