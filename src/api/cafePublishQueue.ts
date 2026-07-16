import { supabase } from '../lib/supabase';

// 카페 자동발행 대기열 — 웹 '카페 발행' → cafe-images 업로드 + cafe_publish_queue 적재.
//   로컬 데몬(crawler/cafe_pub/publish_listener.py)이 폴링해 스마트에디터로 순서대로 발행.
export const CAFE_BUCKET = 'cafe-images';

export type PublishBlock = { type: 'image'; path: string } | { type: 'text'; text: string };

// dataURL 또는 URL(내장 이미지) → Blob.
async function toBlob(src: string): Promise<Blob> {
    if (src.startsWith('data:')) {
        const res = await fetch(src);
        return res.blob();
    }
    const res = await fetch(src);
    return res.blob();
}

// 카페 발행 등록 — 이미지(게시 순서)를 업로드하고, 본문을 맨 끝 블록으로 매니페스트 구성 → 큐 insert.
export async function createPublishJob(input: { title: string; body: string; images: string[] }) {
    const jobId = crypto.randomUUID();
    const blocks: PublishBlock[] = [];
    try {
        for (let i = 0; i < input.images.length; i += 1) {
            const blob = await toBlob(input.images[i]);
            const path = `${jobId}/${String(i).padStart(2, '0')}.jpg`;
            const { error } = await supabase.storage.from(CAFE_BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
            if (error) throw error;
            blocks.push({ type: 'image', path });
        }
        blocks.push({ type: 'text', text: input.body });
        const { error } = await supabase.from('cafe_publish_queue').insert({
            id: jobId,
            title: input.title,
            manifest: blocks,
            status: 'pending',
        });
        if (error) throw error;
        return { error: null, jobId };
    } catch (e) {
        // 실패 시 업로드된 이미지 정리
        const paths = blocks.filter((b): b is { type: 'image'; path: string } => b.type === 'image').map((b) => b.path);
        if (paths.length) await supabase.storage.from(CAFE_BUCKET).remove(paths);
        return { error: e as { message: string }, jobId: null };
    }
}

// 발행 큐 현황(내부) — 최근순.
export async function listPublishJobs(limit = 20) {
    const { data, error } = await supabase
        .from('cafe_publish_queue')
        .select('id,title,status,posted_url,reason,created_at,done_at')
        .order('created_at', { ascending: false })
        .limit(limit);
    return { data: data ?? [], error };
}
