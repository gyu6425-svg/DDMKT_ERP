import { zipSync, strToU8 } from 'fflate';

// 카페 이미지 '모든 속성' 미세 변형 + ZIP 다운로드 — 테스트/저장 탭 공용.

// mulberry32 시드 난수.
function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = src;
    });
}

// 육안 무변 '모든 속성' 미세 변형 — 해상도(크롭+리사이즈)·전역 밝기/대비/채도·희소 노이즈·JPEG 품질.
//   매 호출 시드가 달라 콘텐츠/지각 해시·해상도·바이트가 전부 달라짐(네이버 중복 업로드 차단 회피).
export async function varyImage(dataUrl: string, seed: number): Promise<string> {
    const img = await loadImage(dataUrl);
    const r = rng(seed);
    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    const crop = Math.floor(r() * 4);
    const outW = Math.max(16, sw - crop * 2 + Math.round((r() - 0.5) * 6));
    const outH = Math.max(16, sh - crop * 2 + Math.round((r() - 0.5) * 6));
    const c = document.createElement('canvas');
    c.width = outW;
    c.height = outH;
    const ctx = c.getContext('2d');
    if (!ctx) return dataUrl;
    const b = (100 + (r() - 0.5) * 2).toFixed(2);
    const ctr = (100 + (r() - 0.5) * 2).toFixed(2);
    const sat = (100 + (r() - 0.5) * 2).toFixed(2);
    try {
        ctx.filter = `brightness(${b}%) contrast(${ctr}%) saturate(${sat}%)`;
    } catch {
        /* filter 미지원 브라우저면 무시 */
    }
    ctx.drawImage(img, crop, crop, sw - crop * 2, sh - crop * 2, 0, 0, outW, outH);
    ctx.filter = 'none';
    for (let k = 0; k < 60; k += 1) {
        const x = Math.floor(r() * outW);
        const y = Math.floor(r() * outH);
        const px = ctx.getImageData(x, y, 1, 1);
        const ch = Math.floor(r() * 3);
        px.data[ch] = Math.max(0, Math.min(255, px.data[ch] + (r() < 0.5 ? -1 : 1)));
        ctx.putImageData(px, x, y);
    }
    return c.toDataURL('image/jpeg', 0.9 + r() * 0.07);
}

function dataUrlToU8(dataUrl: string): Uint8Array {
    const b64 = dataUrl.split(',')[1] || '';
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) u[i] = bin.charCodeAt(i);
    return u;
}

// 원고 txt + 사진1~N(각 미세 변형)을 ZIP 하나로 다운로드.
export async function downloadCafeZip(opts: {
    region: string;
    title: string;
    bodyText: string;
    images: string[]; // 순서대로(1..N)
}): Promise<number> {
    const files: Record<string, Uint8Array> = {};
    files['원고.txt'] = strToU8(`${opts.title}\n\n${opts.bodyText}`);
    const base = Math.floor(Math.random() * 1e9);
    for (let i = 0; i < opts.images.length; i += 1) {
        const varied = await varyImage(opts.images[i], base + i * 7919 + 1);
        files[`사진${i + 1}.jpg`] = dataUrlToU8(varied);
    }
    const zipped = zipSync(files, { level: 0 });
    const url = URL.createObjectURL(new Blob([zipped], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${opts.region || '카페'}_카페세트.zip`;
    a.click();
    URL.revokeObjectURL(url);
    return opts.images.length;
}
