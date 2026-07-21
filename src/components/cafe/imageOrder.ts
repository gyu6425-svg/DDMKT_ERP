// 배너 N장 + 고정 M장 → 최종 이미지 순서. 첫·마지막은 배너, 중간 배너는 고정 사이 균등 삽입.
//   N=0 → 고정만. N=1 → [b, ...fixed, b](북엔드). N≥2 → [b0, …(고정에 중간배너 삽입)…, b_last].
//   CafeBanner2Tab 과 AutoPublishPanel 이 같은 로직을 쓰도록 공유(복제 방지).
export function buildImageOrder(banners: string[], fixed: string[]): string[] {
    if (!banners.length) return [...fixed];
    if (banners.length === 1) return [banners[0], ...fixed, banners[0]];
    const first = banners[0];
    const last = banners[banners.length - 1];
    const mids = banners.slice(1, -1);
    const groups = mids.length + 1;
    const chunks: string[][] = Array.from({ length: groups }, () => []);
    fixed.forEach((img, i) => chunks[i % groups].push(img));
    const middle: string[] = [];
    chunks.forEach((chunk, i) => {
        middle.push(...chunk);
        if (i < mids.length) middle.push(mids[i]);
    });
    return [first, ...middle, last];
}
