import { hasSupabaseConfig, supabase } from '../lib/supabase';
import { varyImage } from '../components/cafe/cafeExport';
import { r2Upload } from './imageStore';

// 블로그 자동 '임시저장' 대기열 — 웹 작성기 '블로그에 저장 요청' → blog-save-images 업로드 +
//   blog_save_queue 적재. SUB1 데몬(crawler/blog_pub/blog_save_listener.py)이 폴링해
//   네이버 블로그 스마트에디터에 채우고 **'저장'까지만** 한다. 발행은 사람이 직접.
//
// ⚠️ 카페(cafePublishQueue.ts)와 큐/버킷을 절대 공유하지 않는다.
//    cafe_publish_queue 는 board 가 NULL 인 행을 CAFE_CLAIM_NULL_BOARD=1 인 PC 가 집어가므로,
//    블로그 원고를 거기 넣으면 카페에 발행되는 사고 경로가 된다.
// /api/img 키 프리픽스(단일 R2 IMG_BUCKET 안). Supabase Storage 가 아니라 **R2** 다.
//   ⚠️ 2026-08-12 전환: Supabase 용량/Egress 초과로 이미지를 전부 R2 로 옮겼다.
//      웹 업로드(여기)와 리스너 다운로드(crawler/blog_pub/blog_common.storage_download)는
//      **반드시 같이** 바뀌어야 한다 — 한쪽만 바뀌면 그 사이 작업의 이미지가 깨진다.
//   ⚠️ functions/api/img 의 ALLOW 에 이 프리픽스가 있어야 한다.
//   ⚠️ 경로에 '/studio-settings/' 를 넣지 않는다 — 발행용 이미지는 매번 새 jobId 라 내용이
//      안 바뀌므로 immutable(1년) 캐시가 맞다.
export const BLOG_SAVE_BUCKET = 'blog-save';

// 저장기(crawler/blog_pub/blog_common.download_manifest)가 해석하는 블록.
//   ⚠️ 카페의 link/tags/board 는 없다. 네이버 블로그는 카테고리·태그·공개설정이 '발행' 레이어
//      안에서만 설정되므로 저장 단계에서 건드릴 수 없다(태그는 본문 말미 해시태그로 대체).
export type BlogSaveBlock =
    | { type: 'image'; path: string }
    | { type: 'text'; text: string };

export type BlogJobMode = 'save' | 'publish';

export type BlogSaveJob = {
    mode?: BlogJobMode;
    posted_url?: string | null;
    id: string;
    created_at: string;
    blog_id: string;
    title: string;
    status: 'pending' | 'processing' | 'saved' | 'posted' | 'fail';
    reason: string | null;
    attempts: number;
    saved_at: string | null;
    draft_seq: number | null;
    keyword: string | null;
    region: string | null;
};

async function toBlob(src: string): Promise<Blob> {
    const res = await fetch(src);
    return res.blob();
}

// 본문에 「사진 N」 마커를 문단 사이에 균등 배치. 저장기가 마커 위치에 images[N-1] 을 넣는다.
//   cafePublishQueue.interleaveMarkers 와 같은 규약(마커 문법이 파이썬 IMG_MARK 와 1:1).
export function interleaveMarkers(body: string, top: number, mid: number, tail: number): string {
    if (top + mid + tail <= 0) return body;
    let paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (paras.length < 3) paras = body.split('\n').map((p) => p.trim()).filter(Boolean);
    if (!paras.length) paras = [body.trim()];
    const out: string[] = [];
    let marker = 1;
    for (let i = 0; i < top; i += 1) { out.push(`「사진 ${marker}」`, ''); marker += 1; }
    let placed = 0;
    paras.forEach((para, idx) => {
        out.push(para, '');
        const upto = Math.round((mid * (idx + 1)) / paras.length);
        while (placed < upto) { out.push(`「사진 ${marker}」`, ''); marker += 1; placed += 1; }
    });
    while (placed < mid) { out.push(`「사진 ${marker}」`, ''); marker += 1; placed += 1; }
    for (let i = 0; i < tail; i += 1) { out.push(`「사진 ${marker}」`, ''); marker += 1; }
    return out.join('\n').trim();
}

// 저장 대상으로 고를 수 있는 블로그 목록(활성 + blog_id 있는 것만).
//   blog_id 가 없으면 저장기가 어느 블로그인지 특정할 수 없어 제외한다.
export async function listSavableBlogs() {
    if (!hasSupabaseConfig) return { data: [], error: null };
    const { data, error } = await supabase
        .from('blog_accounts')
        .select('id,name,blog_id,blog_url,is_active')
        .eq('is_active', true)
        .not('blog_id', 'is', null)
        .order('name', { ascending: true });
    const rows = (data ?? []).filter((r) => (r.blog_id || '').trim()) as Array<{
        id: string; name: string; blog_id: string; blog_url: string;
    }>;
    return { data: rows, error };
}

// 저장 요청 적재 — 이미지 업로드 후 매니페스트 구성 → blog_save_queue insert.
export async function createSaveJob(input: {
    blogAccountId: string;
    blogId: string;
    title: string;
    body: string;
    images?: string[];        // dataURL 또는 URL. 순서 = 「사진 1」,「사진 2」…
    keyword?: string;
    region?: string;
    sourceOutputId?: string;  // 원고 출처(blog_outputs)
    // 🔴 'publish' 면 SUB1 이 **실제로 공개 발행**한다(되돌릴 수 없다).
    //    생략하면 'save' — 어디선가 빠뜨려도 저장으로 떨어지게 기본값을 그쪽에 둔다.
    mode?: BlogJobMode;
}) {
    if (!hasSupabaseConfig) return { error: { message: 'Supabase 미설정' }, jobId: null };
    if (!input.title.trim()) return { error: { message: '제목이 비어 있습니다.' }, jobId: null };
    if (!input.body.trim()) return { error: { message: '본문이 비어 있습니다.' }, jobId: null };
    if (!input.blogId.trim()) return { error: { message: '저장할 블로그를 선택하세요.' }, jobId: null };

    const jobId = crypto.randomUUID();
    const images = input.images ?? [];
    const blocks: BlogSaveBlock[] = [];
    // 카페와 동일하게 이미지 미세변형 — 같은 이미지를 반복 업로드할 때 중복 감지 회피.
    const seedBase = Math.floor(Math.random() * 1e9);
    try {
        for (let i = 0; i < images.length; i += 1) {
            const varied = await varyImage(images[i], seedBase + i * 7919 + 1);
            const blob = await toBlob(varied);
            const path = `${jobId}/${String(i).padStart(2, '0')}.jpg`;
            // R2 업로드 — r2Upload 는 200 만 믿지 않고 저장된 바이트 수까지 대조한다
            //   ('DB엔 경로가 남았는데 파일은 없음' 사고 방지).
            const { error } = await r2Upload(BLOG_SAVE_BUCKET, path, blob);
            if (error) throw new Error(error);
            blocks.push({ path, type: 'image' });
        }
        // 본문에 이미 마커가 있으면 그대로, 없으면 사진1=상단 + 나머지는 문단 사이로.
        const bodyOut = (images.length && !/「사진\s*\d+」/.test(input.body))
            ? interleaveMarkers(input.body, 1, Math.max(0, images.length - 1), 0)
            : input.body;
        blocks.push({ text: bodyOut, type: 'text' });

        const { error } = await supabase.from('blog_save_queue').insert({
            blog_account_id: input.blogAccountId,
            blog_id: input.blogId,
            id: jobId,
            keyword: input.keyword ?? null,
            manifest: blocks,
            region: input.region ?? null,
            source_output_id: input.sourceOutputId ?? null,
            mode: input.mode ?? 'save',
            status: 'pending',
            title: input.title,
        });
        if (error) throw error;
        return { error: null, jobId };
    } catch (e) {
        // ⚠️ R2 에는 삭제 API 가 없다(/api/img 는 GET/PUT 만). 실패해도 올라간 이미지는 남는데,
        //    경로가 jobId 기준이라 다른 작업과 충돌하지 않고 참조되지도 않는다(고아 객체).
        //    R2 는 저장비만 들고 egress 가 없어 실무상 무해하다. 필요하면 나중에 일괄 정리.
        return { error: e as { message: string }, jobId: null };
    }
}

// 저장 큐 현황(내부) — 최근순.
export async function listSaveJobs(limit = 20) {
    if (!hasSupabaseConfig) return { data: [] as BlogSaveJob[], error: null };
    const { data, error } = await supabase
        .from('blog_save_queue')
        .select('id,created_at,blog_id,title,status,reason,attempts,saved_at,draft_seq,keyword,region,mode,posted_url')
        .order('created_at', { ascending: false })
        .limit(limit)
        .returns<BlogSaveJob[]>();
    return { data: data ?? [], error };
}

// 검수 완료 처리 — 사람이 임시저장함에서 확인/발행한 뒤 행을 정리한다.
//   ⚠️ 발행 여부를 기록하지 않는다(스키마에 그 자리가 없는 것이 안전장치다). 단순 삭제.
//   리스너의 '미검수 저장분 상한' 카운트가 이 정리로 줄어든다.
export async function clearSaveJob(id: string) {
    if (!hasSupabaseConfig) return { error: null };
    const { error } = await supabase.from('blog_save_queue').delete().eq('id', id);
    return { error };
}

// 실패 건 재시도 — fail → pending 으로 되돌린다.
export async function retrySaveJob(id: string) {
    if (!hasSupabaseConfig) return { error: null };
    const { error } = await supabase
        .from('blog_save_queue')
        .update({ attempts: 0, reason: null, status: 'pending' })
        .eq('id', id)
        .eq('status', 'fail');
    return { error };
}
