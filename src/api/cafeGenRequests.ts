import { supabase } from '../lib/supabase';

// 발행요청 큐(cafe_gen_requests) — main 웹이 finder 선택분을 적재 → 발행PC 폴러가 자기 양식으로 생성·발행.
//   전제: docs/cafe-gen-requests.sql. 라우팅·게시판은 SUB1/SUB2 답신 기준 확정값.
export type PublishTarget = { pc: 'SUB1' | 'SUB2'; company: string; board: string; businessFromProduct: boolean };

// 선택 업체(cafe_accounts.company_key) → 발행 라우팅. 더맨=사설경호만(회사보안은 마이클 옛 카페·소진).
export const PUBLISH_TARGET: Record<string, PublishTarget> = {
    theman:  { pc: 'SUB1', company: 'theman', board: '더맨시스템 시설경호업체', businessFromProduct: false },
    theman2: { pc: 'SUB1', company: 'theman', board: '더맨시스템 시설경호업체', businessFromProduct: false },
    seolgo:  { pc: 'SUB1', company: 'seolgo', board: '설고점 소방의 모든 것', businessFromProduct: false },
    seolgo2: { pc: 'SUB1', company: 'seolgo', board: '설고점 소방의 모든 것', businessFromProduct: false },
    theban:  { pc: 'SUB2', company: 'durban', board: '더반클린 입주청소', businessFromProduct: true },
    leak:    { pc: 'SUB2', company: 'leak3', board: '누수탐지 후기·시공사례', businessFromProduct: false },
    nusu:    { pc: 'SUB2', company: 'leak3', board: '누수탐지 후기·시공사례', businessFromProduct: false },
    // dirty: 네이버 아이디 세팅 후 추가
};

export function publishTargetFor(companyKey: string | null): PublishTarget | null {
    return companyKey ? PUBLISH_TARGET[companyKey] ?? null : null;
}

// 더반 업종 = 이 5개만(SUB2 답신). CAFE_BUSINESS 로 제목·태그·CTA배너 분기.
export const DURBAN_BUSINESS = ['입주청소', '이사청소', '상가청소', '청소업체', '사무실청소'];

// finder 선택 키워드들 → 발행요청 적재. region = 키워드에서 제품키워드 떼기(개포동 입주청소→개포동).
//   productKeyword: 지역형 제품키워드(입주청소/사설경호/소방업체/누수탐지). durban 은 이 값이 business.
// 키워드에서 '지역'을 떼어낸다 — 원고 제목이 "{region} {업종} …" 으로 시작하므로 이게 틀리면 글이 깨진다.
//   ⚠️ 옛 코드 결함(2026-08-06 QA): 제품어를 접미($)로 한 번만 치환하고, 안 맞으면 조용히
//      region = 키워드 전체로 폴백했다. UI 가 권장하는 쉼표 다중입력("입주청소, 상가청소")이면
//      접미가 영원히 안 맞아 모든 키워드의 region 이 통째가 되고
//      제목이 "강남구 입주청소업체 입주청소 …" 처럼 나갔다.
//   → 쉼표로 나눈 제품어를 각각 접미로 시도하고, 하나도 못 떼면 '조용한 폴백' 대신 오류로 알린다.
function deriveRegions(keywords: string[], productKeyword: string):
    { rows: { kw: string; region: string }[]; error?: string } {
    const kws = keywords.filter(Boolean);
    const pks = (productKeyword || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!pks.length) return { rows: kws.map((kw) => ({ kw, region: kw })) };   // 제품어 없음(키워드형) = 종전 동작
    const rows: { kw: string; region: string }[] = [];
    const bad: string[] = [];
    for (const kw of kws) {
        let region = '';
        for (const pk of pks) {
            const esc = pk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const cut = kw.replace(new RegExp(`\\s*${esc}\\s*$`), '').trim();
            if (cut && cut !== kw) { region = cut; break; }   // 실제로 접미가 잘렸을 때만 인정
        }
        if (region) rows.push({ kw, region }); else bad.push(kw);
    }
    if (bad.length) {
        return {
            rows: [],
            error: `제품키워드(${pks.join(' · ')})로 지역을 분리할 수 없는 키워드가 ${bad.length}건 있습니다: `
                + `${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ' 외' : ''}. `
                + `키워드가 "지역 + 제품키워드" 형태인지 확인하세요(예: 강남 입주청소).`,
        };
    }
    return { rows };
}

export async function enqueueGenRequests(companyKey: string, keywords: string[], productKeyword: string) {
    const t = PUBLISH_TARGET[companyKey];
    if (!t) return { error: { message: `발행 라우팅 매핑 없음: ${companyKey}` }, count: 0 };
    const pk = (productKeyword || '').trim();
    // 더반은 업종이 CAFE_BUSINESS 로 발행 양식을 분기하므로 5개 중 하나여야 오발행이 없다.
    if (t.businessFromProduct && !DURBAN_BUSINESS.includes(pk)) {
        return { error: { message: `더반 업종은 [${DURBAN_BUSINESS.join(' · ')}] 중 하나여야 합니다. (제품키워드: ${pk || '없음'})` }, count: 0 };
    }
    const der = deriveRegions(keywords, pk);
    if (der.error) return { error: { message: der.error }, count: 0 };
    const rows = der.rows.map(({ kw, region }) => ({
        company: t.company, board: t.board,
        business: t.businessFromProduct ? (pk || null) : null,
        region, keyword: kw, popular_verified: true, status: 'pending',
    }));
    if (!rows.length) return { error: { message: '보낼 키워드가 없습니다.' }, count: 0 };
    const { error } = await supabase.from('cafe_gen_requests').insert(rows);
    return { error, count: rows.length };
}

// 신규 업체(모델B: 고객 자기 카페·자기 계정) 발행요청 — PUBLISH_TARGET 에 없는 접수 고객용.
//   SUB2 라우팅(SUB2 백엔드 확정): company = "dep_{style}_{client_id}" 접두사로 스타일 자동적용.
//     style='info'(정보성) / 'review'(후기성). 배너·실사·계정·clubid·daily 는 SUB2 가 cafe_studio_settings/접수에서 읽음.
//   전제: docs/cafe-gen-requests-client.sql (client_id 컬럼).
// 이 고객의 발행요청 상태(키워드별) — 칩 색상·중복방지용. 무공백 정규화 키.
//   done=발행됨 · pending/claimed/processing=진행중 · 그 외=미사용. 가장 진행된 상태 유지.
export async function getGenRequestStatus(clientId: string): Promise<Record<string, string>> {
    const { data } = await supabase.from('cafe_gen_requests')
        .select('keyword,status').eq('client_id', clientId)
        .neq('status', 'held');   // 중단(held)은 '발행 안 한 것'으로 간주 — 키워드가 미사용으로 되돌아간다
    const RANK: Record<string, number> = { done: 3, processing: 2, claimed: 2, pending: 1, fail: 0 };
    const m: Record<string, string> = {};
    for (const r of (data ?? []) as { keyword: string | null; status: string }[]) {
        const k = (r.keyword || '').replace(/\s/g, '');
        if (!k) continue;
        if (!m[k] || (RANK[r.status] ?? 0) > (RANK[m[k]] ?? 0)) m[k] = r.status;
    }
    return m;
}

// 발행 대기열 현황 — 하단 상태바("발행중 1 · 대기 3 · 오늘완료 2 · 실패 0")용.
//   ⚠️ pending(대기)과 claimed(실제 발행 중)을 반드시 구분한다 — 예전엔 둘을 합쳐 '진행중'으로 보여줘
//      대기 4건이 "발행중 4"로 오해됐다(SUB2 2026-08-05 핸드오프).
//   상태 전이는 전적으로 SUB2 poller 담당 · 여기는 읽기 전용.
//     pending = 큐 대기(발행텀·하루상한 대기 포함) / claimed = 지금 크롬에서 작성·게시 중
//     done(+done_at) = 완료 / fail(+reason) = 실패
export type GenQueueSummary = {
    publishing: { keyword: string; since: string | null }[];  // 지금 발행 중(claimed)
    pending: number;                                          // 대기
    doneToday: number;                                        // 오늘 완료
    failed: { keyword: string; reason: string | null }[];     // 실패(사유 포함)
};

export async function getGenQueueSummary(clientId: string): Promise<GenQueueSummary> {
    const { data } = await supabase.from('cafe_gen_requests')
        .select('keyword,status,claimed_at,done_at,reason')
        .eq('client_id', clientId)
        .neq('status', 'held');   // 중단분은 대기·발행중·완료·실패 어디에도 안 보인다(SUB2 규약)
    const rows = (data ?? []) as { keyword: string | null; status: string; claimed_at: string | null; done_at: string | null; reason: string | null }[];
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const out: GenQueueSummary = { publishing: [], pending: 0, doneToday: 0, failed: [] };
    for (const r of rows) {
        const kw = r.keyword || '—';
        if (r.status === 'claimed' || r.status === 'processing' || r.status === 'posted') {
            out.publishing.push({ keyword: kw, since: r.claimed_at });
        } else if (r.status === 'pending') {
            out.pending += 1;
        } else if (r.status === 'done') {
            if (r.done_at && new Date(r.done_at) >= midnight) out.doneToday += 1;
        } else if (r.status === 'fail') {
            out.failed.push({ keyword: kw, reason: r.reason });
        }
    }
    return out;
}

// 발행 중단 — 그 업체의 '대기(pending)' 요청만 held 로. 반환=중단된 건수.
//   ⚠️ 이미 claimed(크롬에서 작성 중)인 건은 대상 아님 — 그 1건은 끝까지 진행된다.
//      즉 "이후 대기건을 멈춘다" 개념(중간 강제중단은 크롬 프로세스를 죽여야 해서 미지원).
//   held 는 발행 안 한 것으로 간주 → 모든 목록·카운트에서 제외되고 키워드는 미사용으로 되돌아간다.
export async function holdGenRequests(clientId: string): Promise<{ count: number; error: string | null }> {
    const { data, error } = await supabase.from('cafe_gen_requests')
        .update({ status: 'held', reason: '사용자 중단' })
        .eq('client_id', clientId).eq('status', 'pending')
        .select('id');
    return { count: (data ?? []).length, error: error?.message ?? null };
}

// 중단 재개 — held 를 pending 으로 되돌린다.
export async function resumeGenRequests(clientId: string): Promise<{ count: number; error: string | null }> {
    const { data, error } = await supabase.from('cafe_gen_requests')
        .update({ status: 'pending', reason: null })
        .eq('client_id', clientId).eq('status', 'held')
        .select('id');
    return { count: (data ?? []).length, error: error?.message ?? null };
}

// 중단 보관분 건수 — 재개 버튼 노출용(메인 발행 목록엔 절대 안 넣는다).
export async function countHeldGenRequests(clientId: string): Promise<number> {
    const { data } = await supabase.from('cafe_gen_requests')
        .select('id').eq('client_id', clientId).eq('status', 'held');
    return (data ?? []).length;
}

// 아직 발행 안 된(예약) 요청 — 잔여 토큰 즉시 차감용. pending/claimed/processing = 토큰 예약.
export async function getPendingGenRequests(): Promise<{ client_id: string | null; company: string }[]> {
    const { data } = await supabase.from('cafe_gen_requests')
        .select('client_id,company').in('status', ['pending', 'claimed', 'processing']);
    return (data ?? []) as { client_id: string | null; company: string }[];
}

export type SelfStyle = 'info' | 'review';
export async function enqueueGenRequestsSelf(
    clientId: string, keywords: string[], productKeyword: string, style: SelfStyle, manual = false,
) {
    // manual=true: 업체가 인기탭 없이 직접 넣은 키워드(popular_verified=false → SUB2가 manual 도어로 발행).
    const pk = (productKeyword || '').trim();
    const company = `dep_${style}_${clientId}`;
    const der = deriveRegions(keywords, pk);
    if (der.error) return { error: { message: der.error }, count: 0 };
    const rows = der.rows.map(({ kw, region }) => ({
        company, client_id: clientId,
        region, keyword: kw, popular_verified: !manual, status: 'pending',
    }));
    if (!rows.length) return { error: { message: '보낼 키워드가 없습니다.' }, count: 0 };
    const { error } = await supabase.from('cafe_gen_requests').insert(rows);
    return { error, count: rows.length };
}
