import { supabase } from '../lib/supabase';
import { varyImage } from '../components/cafe/cafeExport';

// 카페 자동발행 대기열 — 웹 '카페 발행' → cafe-images 업로드 + cafe_publish_queue 적재.
//   로컬 데몬(crawler/cafe_pub/publish_listener.py)이 폴링해 스마트에디터로 순서대로 발행.
export const CAFE_BUCKET = 'cafe-images';

// 발행기(crawler/cafe_pub/publish_cafe.py _download_manifest)가 해석하는 블록 전부.
//   link/tags/board 가 빠져 있어 웹에서 발행한 글만 링크카드·태그가 없고 기본 게시판으로 나갔다.
export type PublishBlock =
    | { type: 'image'; path: string }
    | { type: 'text'; text: string }
    | { type: 'link'; url: string }     // 본문 끝 OG 썸네일 카드(여러 개 가능, 순서대로)
    | { type: 'tags'; tags: string[] }  // 에디터 하단 태그칩(최대 10개)
    | { type: 'board'; name: string };  // 게시판(메뉴) 이름 — 업체마다 다름

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
export async function createPublishJob(input: {
    title: string;
    body: string;
    images: string[];
    links?: string[];  // 본문 끝 썸네일 카드(카카오톡·홈페이지 등)
    tags?: string[];   // 하단 태그칩
    board?: string;    // 게시판(메뉴) 이름. 없으면 발행기의 CAFE_BOARD 기본값
    company?: string;  // 업체 키(theman/seolgo/leak) — 중복방지·업체별 히스토리
    region?: string;   // 지역
    keyword?: string;  // 키워드(원고 주제)
}) {
    const jobId = crypto.randomUUID();
    const blocks: PublishBlock[] = [];
    // ZIP 다운로드와 동일한 '모든 속성 미세변형'(varyImage) 적용 — 매 발행 이미지 바이트/지각해시가 달라져
    //   네이버 중복 이미지 감지 회피(2~7 고정이미지 포함 전부). 시드는 이미지별로 분산.
    const seedBase = Math.floor(Math.random() * 1e9);
    try {
        for (let i = 0; i < input.images.length; i += 1) {
            const varied = await varyImage(input.images[i], seedBase + i * 7919 + 1);
            const blob = await toBlob(varied);
            const path = `${jobId}/${String(i).padStart(2, '0')}.jpg`;
            const { error } = await supabase.storage.from(CAFE_BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
            if (error) throw error;
            blocks.push({ type: 'image', path });
        }
        blocks.push({ type: 'text', text: input.body });
        // 본문 뒤: 링크 카드 → 태그 → 게시판. 파이썬 자동발행 경로와 같은 구성.
        for (const url of input.links || []) if (url) blocks.push({ type: 'link', url });
        if (input.tags?.length) blocks.push({ tags: input.tags.slice(0, 10), type: 'tags' });
        if (input.board) blocks.push({ name: input.board, type: 'board' });
        const { error } = await supabase.from('cafe_publish_queue').insert({
            id: jobId,
            title: input.title,
            manifest: blocks,
            status: 'pending',
            company: input.company ?? null,
            region: input.region ?? null,
            keyword: input.keyword ?? null,
            board: input.board ?? null,   // 게시판 파티션 키(멀티PC 라우팅). 비면 DB 트리거가 manifest 에서 채움.
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

// 이미 발행(또는 대기)한 지역+키워드 쌍 — 중복 발행 방지용. { error } 가 있으면 호출부가 발행을 중단해야 한다(fail-closed).
export async function listPublishedPairs(company: string) {
    const { data, error } = await supabase
        .from('cafe_publish_queue')
        .select('region,keyword')
        .eq('company', company)
        .not('region', 'is', null);
    const pairs = new Set<string>();
    for (const r of data ?? []) {
        if (r.region) pairs.add(`${r.region}|${r.keyword ?? ''}`);
    }
    return { pairs, error };
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
