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

// 본문에 「사진 N」 마커를 배치 — 더반·누수 방식: [상단 배너] + [실사 문단 사이] + [끝 배너].
//   이미지 배열 순서 = top(상단배너) → mid(실사) → tail(끝배너)와 1:1. 에이전트(parse_body_to_blocks)가
//   「사진 N」 위치에 images[N-1] 을 넣는다. 배너를 균등분산하지 않고 top/끝에만 둬 '배너 끝 몰빵'을 없앤다.
//   top=상단배너 장수(보통 1) · mid=실사 장수(문단 사이 균등) · tail=끝배너 장수(보통 1, 맨 끝).
function interleaveMarkers(body: string, top: number, mid: number, tail: number): string {
    if (top + mid + tail <= 0) return body;
    let paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (paras.length < 3) paras = body.split('\n').map((p) => p.trim()).filter(Boolean);
    if (!paras.length) paras = [body.trim()];
    const out: string[] = [];
    let marker = 1;
    for (let i = 0; i < top; i += 1) { out.push(`「사진 ${marker}」`, ''); marker += 1; }   // 상단 배너(맨 위)
    // 실사(mid) 마커를 문단 진행률에 맞춰 균등 분산(실사가 문단보다 많으면 한 문단에 여러 장도 허용).
    let placed = 0;
    paras.forEach((para, idx) => {
        out.push(para, '');
        const upto = Math.round((mid * (idx + 1)) / paras.length);
        while (placed < upto) { out.push(`「사진 ${marker}」`, ''); marker += 1; placed += 1; }
    });
    while (placed < mid) { out.push(`「사진 ${marker}」`, ''); marker += 1; placed += 1; }
    for (let i = 0; i < tail; i += 1) { out.push(`「사진 ${marker}」`, ''); marker += 1; }   // 끝 배너(맨 끝)
    return out.join('\n').trim();
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

// 고객 셀프 발행 — 고객(client_id) 계정이 '본인 업체'로만 큐 적재.
//   company/board 는 클라이언트가 못 정한다 → 내 cafe_accounts(RLS 로 본인 것만 조회)에서 서버 진실값을 강제.
//   전제: docs/cafe-customer-publish-rls.sql 적용(publish_enabled 승인 + 큐/스토리지 고객 정책).
//   내부 createPublishJob 과 분리 — 내부 경로(company 폴더 없음)는 무변경.
export async function createCustomerPublishJob(input: {
    title: string;
    body: string;
    images: string[];   // 순서 = 상단배너 → 실사 → 끝배너 (layout 과 1:1).
    layout?: { top: number; mid: number; tail: number };  // 이미지 배치. 없으면 사진1 top + 나머지 실사로.
    links?: string[];
    tags?: string[];
}) {
    // 내 카페 계정(RLS: client_id = my_client_id 인 행만). 승인 = active + publish_enabled.
    //   ⚠️ publish_enabled 컬럼이 아직 없을 수 있어 select('*') 로 받는다(없으면 undefined).
    //      게이트: active && publish_enabled!==false → 컬럼 없으면 active 로 폴백, 있으면 false 면 차단.
    //      (권장: publish_enabled 기본 false 컬럼 추가 — active 는 기본 true 라 승인 게이트로 부적합.)
    const { data: accts, error: aerr } = await supabase
        .from('cafe_accounts')
        .select('*');
    if (aerr) return { error: aerr as { message: string }, jobId: null };
    const acct = (accts ?? []).find(
        (a) => a.active && (a as { publish_enabled?: boolean }).publish_enabled !== false,
    ) as { company_key: string; board_name: string } | undefined;
    if (!acct) {
        return { error: { message: '카페 자동발행이 아직 승인되지 않았습니다. 담당자에게 문의해 주세요.' }, jobId: null };
    }

    const jobId = crypto.randomUUID();
    const blocks: PublishBlock[] = [];
    const seedBase = Math.floor(Math.random() * 1e9);
    try {
        for (let i = 0; i < input.images.length; i += 1) {
            const varied = await varyImage(input.images[i], seedBase + i * 7919 + 1);
            const blob = await toBlob(varied);
            // ★ 스토리지 RLS 스코프: company_key 를 최상위 폴더로(내부 '<jobId>/..' 경로와 구분·격리).
            const path = `${acct.company_key}/${jobId}/${String(i).padStart(2, '0')}.jpg`;
            const { error } = await supabase.storage.from(CAFE_BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
            if (error) throw error;
            blocks.push({ type: 'image', path });
        }
        // 더반·누수 방식 이미지 배치 — 상단배너 + 실사(문단 사이) + 끝배너. 본문에 이미 마커 있으면 그대로.
        const lay = input.layout ?? { top: input.images.length ? 1 : 0, mid: Math.max(0, input.images.length - 1), tail: 0 };
        const bodyOut = (input.images.length && !/「사진\s*\d+」/.test(input.body))
            ? interleaveMarkers(input.body, lay.top, lay.mid, lay.tail)
            : input.body;
        blocks.push({ type: 'text', text: bodyOut });
        for (const url of input.links || []) if (url) blocks.push({ type: 'link', url });
        if (input.tags?.length) blocks.push({ tags: input.tags.slice(0, 10), type: 'tags' });
        blocks.push({ name: acct.board_name, type: 'board' });   // 게시판 = 서버 진실값(위조 불가)
        const { error } = await supabase.from('cafe_publish_queue').insert({
            id: jobId,
            title: input.title,
            manifest: blocks,
            status: 'pending',
            company: acct.company_key,   // RLS WITH CHECK 가 my_publish_companies + board 일치 검증
            board: acct.board_name,
        });
        if (error) throw error;
        return { error: null, jobId };
    } catch (e) {
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

// 고객 발행 현황 — RLS 가 본인 company(my_publish_companies) 행만 돌려준다. 최근순.
export async function listMyCafeJobs(limit = 10) {
    const { data, error } = await supabase
        .from('cafe_publish_queue')
        .select('id,title,status,posted_url,reason,created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
    return { data: data ?? [], error };
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
