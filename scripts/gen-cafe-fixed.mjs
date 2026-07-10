// 카페 고정 카드(2~8번) 생성 헬퍼
//   public/images/cafe-fixed/src/ 의 현장 사진을 레퍼런스로, dev API(/api/generate-cafe-card, mode:'fixed')를
//   호출해 지역·전화번호 없는 네이비 브랜드 무드 카드를 뽑아 public/images/cafe-fixed/card-0N.png 로 저장.
//
//   사전조건: npm run api:dev 실행 중(OPENAI_API_KEY 설정), 소스 사진을 src/ 에 넣어둘 것.
//   사용법:  node scripts/gen-cafe-fixed.mjs [장수]   (기본 7장 = 2~8번)

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'public', 'images', 'cafe-fixed');
const SRC = join(ROOT, 'src');
const API = 'http://127.0.0.1:8787/api/generate-cafe-card';
const COUNT = Number(process.argv[2]) || 7;

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function toDataUrl(file) {
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    const mime = MIME[ext];
    if (!mime) return null;
    const b64 = readFileSync(join(SRC, file)).toString('base64');
    return `data:${mime};base64,${b64}`;
}

const files = readdirSync(SRC)
    .filter((f) => MIME[f.slice(f.lastIndexOf('.')).toLowerCase()])
    .sort();

if (!files.length) {
    console.error(`소스 사진이 없습니다. ${SRC} 에 현장 사진을 넣어주세요.`);
    process.exit(1);
}

const refs = files.map(toDataUrl).filter(Boolean);
console.log(`소스 ${refs.length}장 → 고정 카드 ${COUNT}장 생성 시작...`);

const saved = [];
for (let i = 0; i < COUNT; i += 1) {
    // 카드마다 서로 다른 소스 1~2장을 레퍼런스로 순환 사용 → 무드 통일 + 내용 다양화.
    const a = refs[i % refs.length];
    const b = refs[(i + 1) % refs.length];
    const body = { mode: 'fixed', refs: refs.length > 1 ? [a, b] : [a] };
    process.stdout.write(`  [${i + 1}/${COUNT}] 생성중... `);
    try {
        const res = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok || !data.imageDataUrl) {
            console.log(`실패: ${data.message || res.status}`);
            continue;
        }
        const b64 = data.imageDataUrl.split(',')[1];
        const name = `card-${String(i + 1).padStart(2, '0')}.png`;
        writeFileSync(join(ROOT, name), Buffer.from(b64, 'base64'));
        saved.push(`/images/cafe-fixed/${name}`);
        console.log(`저장 ${name}`);
    } catch (err) {
        console.log(`오류: ${err.message}`);
    }
}
// 매니페스트 — 테스트 탭이 이 목록을 기본 고정 세트로 로드.
writeFileSync(join(ROOT, 'manifest.json'), JSON.stringify(saved, null, 2));
console.log(`완료. manifest.json 에 ${saved.length}장 기록.`);
