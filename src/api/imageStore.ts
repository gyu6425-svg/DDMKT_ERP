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

// 업로드 결과 — 실패를 삼키지 않고 원인(error)을 그대로 반환한다.
//   성공: {path, error:null} / 실패: {path:null, error:'사람이 읽을 실패 사유'}
//   ⚠️ 실패해도 절대 성공처럼 보이면 안 됨 — 호출부는 error 를 반드시 화면에 노출해야 한다(무음 손실 = DB에 경로만 남고 파일 없음의 원인).
export type UploadResult = { path: string; error: null } | { path: null; error: string };

// 업로드 — 이미지 소스(dataURL/URL 문자열 또는 Blob) → R2. 성공 시 저장 path(버킷 접두 없는 원래 path) 반환.
export async function r2Upload(bucket: string, path: string, src: string | Blob, contentType = 'image/jpeg'): Promise<UploadResult> {
    // ① 소스 → Blob
    let blob: Blob;
    try {
        blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
    } catch (e) {
        return { path: null, error: `이미지 읽기 실패: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!blob.size) return { path: null, error: '이미지가 비어 있습니다(0바이트).' };
    // ② 인증 토큰 — 없거나 만료됐으면 세션 갱신 1회 시도(재업로드는 로그인 확실히가 핵심).
    let token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) token = (await supabase.auth.refreshSession()).data.session?.access_token;
    if (!token) return { path: null, error: '로그인이 만료되었습니다. 다시 로그인한 뒤 업로드하세요.' };
    // ③ PUT — 응답 상태를 그대로 사유로 전달(401=인증, 그 외=HTTP 코드).
    let r: Response;
    try {
        r = await fetch(r2Url(bucket, path), {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'x-content-type': blob.type || contentType },
            body: blob,
        });
    } catch (e) {
        return { path: null, error: `네트워크 오류로 업로드 실패: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!r.ok) {
        const body = await r.text().catch(() => '');
        const error = r.status === 401
            ? '로그인 인증 실패(토큰 만료) — 다시 로그인한 뒤 업로드하세요.'
            : `업로드 실패 (HTTP ${r.status}${body ? ` · ${body.slice(0, 120)}` : ''})`;
        return { path: null, error };
    }
    return { path, error: null };
}
