import { supabase } from '../lib/supabase';

// 브랜드 블로그 자료 — 우리가 전달하는 자료(업체명·대표키워드·서브키워드·카테고리·사진 1~9장).
//   사진은 Storage(private 'blog-materials'), 메타는 blog_materials 테이블. RLS로 기자단은 본인 블로그만 조회.

export const MATERIAL_BUCKET = 'blog-materials';
export const MATERIAL_CATEGORIES = ['정보성', '사례성'] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

export type MaterialPhoto = { path: string; name: string; size: number };
export type BlogMaterial = {
    id: string;
    blog_account_id: string;
    round: number | null;
    category: string;
    company_name: string | null;
    main_keyword: string | null;
    sub_keywords: string[];
    photos: MaterialPhoto[];
    uploaded_by: string | null;
    created_at: string;
};

// 파일명 안전화(경로용) — 한글/공백 유지 대신 표시명은 DB에 따로 보관.
const safeName = (n: string) => (n || 'file').replace(/[^\w.\-]+/g, '_').slice(-60);

// 브라우저에서 이미지 리사이즈/압축(참고용이라 1280px·JPEG) → 업로드 용량 6~7배 절감.
export async function compressImage(file: File, maxDim = 1280, quality = 0.8): Promise<Blob> {
    if (!file.type.startsWith('image/')) return file; // 이미지 아니면 원본
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) return file;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : file;
}

// 자료 목록 — RLS가 스코프 강제(기자단은 본인 담당 블로그만). 최신순.
export async function listMaterials(blogAccountId: string) {
    const { data, error } = await supabase
        .from('blog_materials')
        .select('*')
        .eq('blog_account_id', blogAccountId)
        .order('created_at', { ascending: false })
        .returns<BlogMaterial[]>();
    return { data: data ?? [], error };
}

// 자료 등록(내부) — 사진 압축 → Storage 업로드 → 행 insert. 경로 첫 폴더=blog_account_id(스토리지 RLS 기준).
export async function createMaterial(input: {
    blogAccountId: string;
    round: number | null;
    category: string;
    companyName: string;
    mainKeyword: string;
    subKeywords: string[];
    files: File[];
    uploadedBy: string | null;
}) {
    const materialId = crypto.randomUUID();
    const photos: MaterialPhoto[] = [];
    const uploaded: string[] = [];
    try {
        const files = input.files.slice(0, 9); // 최대 9장
        for (let i = 0; i < files.length; i += 1) {
            const f = files[i];
            const blob = await compressImage(f);
            const path = `${input.blogAccountId}/${materialId}/${i}__${safeName(f.name)}`;
            const { error: upErr } = await supabase.storage
                .from(MATERIAL_BUCKET)
                .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
            if (upErr) throw upErr;
            uploaded.push(path);
            photos.push({ name: f.name, path, size: blob.size });
        }
        const { error } = await supabase.from('blog_materials').insert({
            id: materialId,
            blog_account_id: input.blogAccountId,
            round: input.round,
            category: input.category,
            company_name: input.companyName || null,
            main_keyword: input.mainKeyword || null,
            sub_keywords: input.subKeywords.filter(Boolean).slice(0, 3),
            photos,
            uploaded_by: input.uploadedBy,
        });
        if (error) throw error;
        return { error: null };
    } catch (e) {
        // 실패 시 업로드된 고아 객체 정리
        if (uploaded.length) await supabase.storage.from(MATERIAL_BUCKET).remove(uploaded);
        return { error: e as { message: string } };
    }
}

// 다운로드 URL — private 버킷이라 signed URL(기본 120초). SELECT RLS 통과해야 발급 → 남 블로그 못 받음.
export async function getPhotoUrl(path: string, expires = 120) {
    const { data, error } = await supabase.storage.from(MATERIAL_BUCKET).createSignedUrl(path, expires);
    return { url: data?.signedUrl ?? null, error };
}

// 여러 장 signed URL 일괄 발급.
export async function getPhotoUrls(paths: string[], expires = 300) {
    const { data, error } = await supabase.storage.from(MATERIAL_BUCKET).createSignedUrls(paths, expires);
    const map: Record<string, string> = {};
    for (const d of data ?? []) if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
    return { map, error };
}

// 자료 삭제(내부) — Storage 사진 제거 + 행 삭제.
export async function deleteMaterial(m: BlogMaterial) {
    const paths = (m.photos || []).map((p) => p.path);
    if (paths.length) await supabase.storage.from(MATERIAL_BUCKET).remove(paths);
    const { error } = await supabase.from('blog_materials').delete().eq('id', m.id);
    return { error };
}
