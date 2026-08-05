import { supabase } from '../lib/supabase';
import { r2Upload, r2Urls, type UploadResult } from './imageStore';

// 카페 발행 스튜디오 업체별 저장 설정 — '값 저장하기'. 전제: docs/cafe-studio-settings.sql
//   업체명·업종·홈페이지·유형 + 실사/마지막배너(storage 경로). client_id 당 1행(upsert).
export type StudioSettings = {
    client_id: string;
    brand: string | null;
    business: string | null;
    homepage: string | null;
    deploy_type: string | null;
    main_banner: string[] | null; // 상단 배너 storage 경로(맨 위 1장)
    photos: string[] | null;    // 실사 storage 경로
    banners: string[] | null;   // 마지막 배너 storage 경로
    keyword_pool?: string[] | null; // 계약 키워드 풀(모델B 일별 발행 — 미사용분 골라 insert)
    product_kw?: string | null;     // 제품키워드(region 분리용)
    naver_id?: string | null;   // 발행 네이버 아이디
    naver_pw?: string | null;   // 발행 네이버 비밀번호
    board_name?: string | null; // 발행 게시판 이름
    board_url?: string | null;  // 발행 게시판 주소
    kakao_url?: string | null;  // 카카오톡 상담 링크
    daily_cap?: number | null;       // 하루 최대 발행 수(1~10). SUB2 dep_ poller 소비. 전제: docs/cafe-publish-gap.sql
    publish_gap_min?: number | null; // 발행 최소 간격(분). 0=무제한. SUB2 dep_ poller 소비.
};

export async function getStudioSettings(clientId: string) {
    const { data, error } = await supabase
        .from('cafe_studio_settings').select('*').eq('client_id', clientId).maybeSingle();
    return { data: (data as StudioSettings | null) ?? null, error };
}

export async function saveStudioSettings(s: StudioSettings) {
    const payload = { ...s, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('cafe_studio_settings').upsert(payload, { onConflict: 'client_id' });
    // 발행텀·상한 컬럼(daily_cap/publish_gap_min)이 아직 없으면(SQL 미실행) 그 필드만 빼고 재시도 — 나머지 설정은 정상 저장.
    if (error && /daily_cap|publish_gap_min|column|schema cache/i.test(error.message || '')) {
        const { daily_cap: _dc, publish_gap_min: _pg, ...rest } = payload;
        const retry = await supabase.from('cafe_studio_settings').upsert(rest, { onConflict: 'client_id' });
        return { error: retry.error, gapColumnsMissing: !retry.error as boolean };
    }
    return { error };
}

export async function clearStudioSettings(clientId: string) {
    const { error } = await supabase.from('cafe_studio_settings').delete().eq('client_id', clientId);
    return { error };
}

// 네이버 로그인 이력 기록 — '네이버 로그인' 버튼 성공 시 시각 저장(버튼 색 표시용).
export async function markNaverLogin(clientId: string) {
    const { error } = await supabase.from('cafe_studio_settings')
        .upsert({ client_id: clientId, naver_login_at: new Date().toISOString() }, { onConflict: 'client_id' });
    return { error };
}

// 키워드 풀만 부분 업데이트(칩 삭제 등) — 즉시 반영.
export async function updateKeywordPool(clientId: string, pool: string[]) {
    const { error } = await supabase.from('cafe_studio_settings')
        .update({ keyword_pool: pool.length ? pool : null, updated_at: new Date().toISOString() })
        .eq('client_id', clientId);
    return { error };
}

// dataURL/URL(이미지 소스) → R2(cafe-images) 업로드 → {path, error}. (Egress 회피)
//   실패 사유(error)를 그대로 반환 — 호출부에서 반드시 노출(무음 손실 금지).
export async function uploadStudioImage(clientId: string, kind: 'photos' | 'banners' | 'main_banner', idx: number, src: string): Promise<UploadResult> {
    const path = `studio-settings/${clientId}/${kind}_${idx}.jpg`;
    return r2Upload('cafe-images', path, src);
}

// 이미 저장된 스튜디오 이미지 URL(/api/img/cafe-images/<path>)이면 그 저장 path 반환(재업로드 불필요), 아니면 null(새 이미지).
export function studioSavedPath(src: string): string | null {
    const prefix = '/api/img/cafe-images/';
    if (!src || !src.startsWith(prefix)) return null;
    return src.slice(prefix.length).split('/').map((s) => { try { return decodeURIComponent(s); } catch { return s; } }).join('/');
}

// 저장 경로 → 표시·발행용 URL(/api/img, CDN 캐시). 서명URL 불필요 → Supabase 트래픽 0.
export async function signedStudioUrls(paths: string[]): Promise<string[]> {
    return r2Urls('cafe-images', paths);
}
