// 블로그 발행 스튜디오 업체별 저장 설정 — '값 저장하기'. (카페 cafeStudioSettings 미러)
//   전제: docs/blog-studio-settings.sql (blog_studio_settings, blog_accounts(id) 당 1행).
//   이미지는 카페와 동일하게 R2 'cafe-images' 버킷의 studio-settings/blogacct-<id>/… 경로에 저장(/api/img 로 조회).
//   ⚠️ 전부 additive — 카페 코드/테이블은 건드리지 않는다(복사·자립).
import { supabase } from '../lib/supabase';
import { r2Upload, r2Urls, type UploadResult } from './imageStore';

export type BlogStudioSettings = {
    blog_account_id: string;
    brand: string | null;
    business: string | null;
    homepage: string | null;
    kakao_url: string | null;
    naver_id: string | null;
    blog_name: string | null;
    write_url: string | null;
    main_banner: string[] | null; // 상단 배너 저장 경로(1장)
    photos: string[] | null;      // 중간 실사 저장 경로
    banners: string[] | null;     // 끝 배너 저장 경로(≤2)
    daily_cap?: number | null;
    publish_gap_min?: number | null;
    chrome_port?: number | null;    // 이 블로그 전용 로그인/발행 크롬 포트(업체마다 다른 크롬)
    keyword_pool?: string[] | null;
    naver_login_at?: string | null;
};

// /api/img 키 프리픽스(단일 R2 IMG_BUCKET 안). blog-studio 로 분리 → 카페 자산과 안 섞임.
//   ⚠️ functions/api/img 의 ALLOW 에 'blog-studio' 가 있어야 함(main 이 추가). 경로에 반드시
//      '/studio-settings/' 를 유지할 것 — 그래야 mutable(300s) 캐시가 걸려 배너 교체가 즉시 반영된다
//      (안 그러면 1년 immutable → 옛 배너가 계속 나옴).
const BUCKET = 'blog-studio';

export async function getBlogStudioSettings(blogAccountId: string) {
    const { data, error } = await supabase
        .from('blog_studio_settings').select('*').eq('blog_account_id', blogAccountId).maybeSingle();
    return { data: (data as BlogStudioSettings | null) ?? null, error };
}

export async function saveBlogStudioSettings(s: BlogStudioSettings) {
    const payload = { ...s, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('blog_studio_settings').upsert(payload, { onConflict: 'blog_account_id' });
    // 추가 컬럼이 아직 없으면(SQL 미실행) 그 필드만 빼고 재시도 — 나머지 설정은 정상 저장.
    if (error && /daily_cap|publish_gap_min|chrome_port|column|schema cache/i.test(error.message || '')) {
        const { daily_cap: _dc, publish_gap_min: _pg, chrome_port: _cp, ...rest } = payload;
        const retry = await supabase.from('blog_studio_settings').upsert(rest, { onConflict: 'blog_account_id' });
        return { error: retry.error, gapColumnsMissing: !retry.error as boolean };
    }
    return { error };
}

export async function markBlogNaverLogin(blogAccountId: string) {
    const { error } = await supabase.from('blog_studio_settings')
        .upsert({ blog_account_id: blogAccountId, naver_login_at: new Date().toISOString() }, { onConflict: 'blog_account_id' });
    return { error };
}

// dataURL/URL(이미지 소스) → R2 업로드 → {path, error}. 실패 사유 그대로 반환(무음 손실 금지).
export async function uploadBlogStudioImage(
    blogAccountId: string, kind: 'photos' | 'banners' | 'main_banner', idx: number, src: string,
): Promise<UploadResult> {
    const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    // 'studio-settings/' 를 포함해야 /api/img 가 mutable 캐시로 다룬다(교체 시 옛 이미지 안 남게).
    const path = `studio-settings/blogacct-${blogAccountId}/${kind}_${idx}_${stamp}.jpg`;
    return r2Upload(BUCKET, path, src);
}

// 이미 저장된 스튜디오 이미지 URL(/api/img/cafe-images/<path>)이면 그 저장 path 반환(재업로드 불필요), 아니면 null.
export function blogStudioSavedPath(src: string): string | null {
    const prefix = `/api/img/${BUCKET}/`;
    if (!src || !src.startsWith(prefix)) return null;
    return src.slice(prefix.length).split('/').map((s) => { try { return decodeURIComponent(s); } catch { return s; } }).join('/');
}

// 저장 경로 → 표시·발행용 URL(/api/img, CDN 캐시).
export function signedBlogStudioUrls(paths: string[]): string[] {
    return r2Urls(BUCKET, paths);
}
