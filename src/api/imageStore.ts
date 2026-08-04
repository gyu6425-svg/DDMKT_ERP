// 이미지 스토어 클라이언트 — Cloudflare R2(/api/img)로 업로드/조회. Supabase Egress 회피.
//   R2 키 = "<bucket>/<path>" (bucket=cafe-images|deploy-intake). 조회 URL=/api/img/<bucket>/<path>(상대·CDN 캐시).
//   업로드는 로그인 사용자 토큰으로 인증(PUT). 서명URL 불필요 → createSignedUrls 호출 제거로 Supabase 트래픽 0.
import { supabase } from '../lib/supabase';

// 조회 URL — 상대경로(같은 도메인, CF CDN이 캐시 → 재조회 egress 0). path 는 Supabase 저장경로와 동일.
export function r2Url(bucket: string, path: string): string {
    return `/api/img/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function r2Urls(bucket: string, paths: string[]): string[] {
    return paths.filter(Boolean).map((p) => r2Url(bucket, p));
}

// 업로드 — 이미지 소스(dataURL/URL) → R2. 성공 시 저장 path(버킷 접두 없는 원래 path) 반환.
export async function r2Upload(bucket: string, path: string, src: string, contentType = 'image/jpeg'): Promise<string | null> {
    try {
        const blob = await (await fetch(src)).blob();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return null;
        const r = await fetch(r2Url(bucket, path), {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'x-content-type': blob.type || contentType },
            body: blob,
        });
        return r.ok ? path : null;
    } catch {
        return null;
    }
}
