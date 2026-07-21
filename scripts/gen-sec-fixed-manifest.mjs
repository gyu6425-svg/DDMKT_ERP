// 더맨시스템3 전용 중간 이미지(2~7) 매니페스트 생성.
//   public/images/theman/ 에 사진을 넣고 이 스크립트를 돌리면 manifest.json 을 파일명 순으로 다시 쓴다.
//   ※ 누수탐지·더맨2·배너/테스트 탭이 쓰는 cafe-fixed 세트는 건드리지 않는다(공유 세트).
//
//   사용법:  node scripts/gen-sec-fixed-manifest.mjs
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'theman';
const ROOT = join(process.cwd(), 'public', 'images', DIR);
const EXT = /\.(png|jpe?g|webp)$/i;

const files = readdirSync(ROOT).filter((f) => EXT.test(f)).sort();
if (!files.length) {
    console.error(`[gen-sec-fixed] ${ROOT} 에 이미지가 없습니다 — 사진을 먼저 넣으세요.`);
    process.exit(1);
}
const list = files.map((f) => `/images/${DIR}/${f}`);
writeFileSync(join(ROOT, 'manifest.json'), `${JSON.stringify(list, null, 2)}\n`, 'utf8');
console.log(`[gen-sec-fixed] ${list.length}장 → public/images/${DIR}/manifest.json`);
for (const p of list) console.log(`  ${p}`);
