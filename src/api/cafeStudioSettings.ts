import { supabase } from '../lib/supabase';
import { CAFE_BUCKET } from './cafePublishQueue';

// 카페 발행 스튜디오 업체별 저장 설정 — '값 저장하기'. 전제: docs/cafe-studio-settings.sql
//   업체명·업종·홈페이지·유형 + 실사/마지막배너(storage 경로). client_id 당 1행(upsert).
export type StudioSettings = {
    client_id: string;
    brand: string | null;
    business: string | null;
    homepage: string | null;
    deploy_type: string | null;
    photos: string[] | null;    // 실사 storage 경로
    banners: string[] | null;   // 마지막 배너 storage 경로
    naver_id?: string | null;   // 발행 네이버 아이디
    naver_pw?: string | null;   // 발행 네이버 비밀번호
    board_name?: string | null; // 발행 게시판 이름
    board_url?: string | null;  // 발행 게시판 주소
};

export async function getStudioSettings(clientId: string) {
    const { data, error } = await supabase
        .from('cafe_studio_settings').select('*').eq('client_id', clientId).maybeSingle();
    return { data: (data as StudioSettings | null) ?? null, error };
}

export async function saveStudioSettings(s: StudioSettings) {
    const { error } = await supabase.from('cafe_studio_settings')
        .upsert({ ...s, updated_at: new Date().toISOString() }, { onConflict: 'client_id' });
    return { error };
}

export async function clearStudioSettings(clientId: string) {
    const { error } = await supabase.from('cafe_studio_settings').delete().eq('client_id', clientId);
    return { error };
}

// dataURL/URL(이미지 소스) → cafe-images 버킷에 업로드 → 저장 경로 반환.
export async function uploadStudioImage(clientId: string, kind: 'photos' | 'banners', idx: number, src: string): Promise<string | null> {
    const blob = await (await fetch(src)).blob();
    const path = `studio-settings/${clientId}/${kind}_${idx}.jpg`;
    const { error } = await supabase.storage.from(CAFE_BUCKET)
        .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
    return error ? null : path;
}

// 저장 경로 → 표시·발행용 서명 URL(발행 toBlob 이 URL 도 처리).
export async function signedStudioUrls(paths: string[]): Promise<string[]> {
    if (!paths.length) return [];
    const { data } = await supabase.storage.from(CAFE_BUCKET).createSignedUrls(paths, 3600);
    return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => !!u);
}
