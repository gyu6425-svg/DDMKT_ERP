// JS 파서 골든 회귀 — crawler/dumps 픽스처로 파이썬(test_parsers.py)과 동일 결과인지 검증.
// 실행:  node functions/lib/naverRank.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { rankInBlogtab, rankInPopular } from './naverRank.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DUMPS = join(HERE, '..', '..', 'crawler', 'dumps');
const OUR = 'st7al_i_byid-';
const read = (name) => readFileSync(join(DUMPS, name), 'utf8');

const CASES = [
    // 통합탭 = 당근/광고만 제외, 사이트+카페+블로그 전부 r순(화면 실측 일치)
    ['석남동 통합탭', (h) => rankInPopular(h, OUR), '통합탭_석남동_누수탐지_2026_06_19.html', 3, 'ok'],
    ['인천석남동 통합탭', (h) => rankInPopular(h, OUR), '통합탭_2026_06_19.html', 2, 'ok'],
    ['인천연희동 통합탭(사이트 포함)', (h) => rankInPopular(h, 'rlawhddls125'), '통합탭_인천_연희동_누수탐지_2026_06_19.html', 5, 'ok'],
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
