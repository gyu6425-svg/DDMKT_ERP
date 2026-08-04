import { supabase } from '../lib/supabase';
import { r2Upload, r2Urls } from './imageStore';

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

// dataURL/URL(이미지 소스) → R2(cafe-images) 업로드 → 저장 경로 반환. (Egress 회피)
export async function uploadStudioImage(clientId: string, kind: 'photos' | 'banners' | 'main_banner', idx: number, src: string): Promise<string | null> {
    const path = `studio-settings/${clientId}/${kind}_${idx}.jpg`;
    return r2Upload('cafe-images', path, src);
}

// 저장 경로 → 표시·발행용 URL(/api/img, CDN 캐시). 서명URL 불필요 → Supabase 트래픽 0.
export async function signedStudioUrls(paths: string[]): Promise<string[]> {
    return r2Urls('cafe-images', paths);
}
