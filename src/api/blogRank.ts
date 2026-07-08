import { supabase } from '../lib/supabase';

// ── 타입 ────────────────────────────────────────────────
export type RankStatus = 'ok' | 'out' | 'fail';

export type BlogMeasurement = {
    date: string; // YYYY-MM-DD
    ti: number; // 통합탭(인기글) 순위
    bl: number; // 블로그탭 순위
    // 크롤러가 기록. fail=구조 파싱 실패(차단/구조변경)를 권외(out)와 구분. (구버전 레코드엔 없음)
    ti_status?: RankStatus;
    bl_status?: RankStatus;
    // 웹사이트(문서)탭 존재 여부 — 통합검색 web* 섹션에 이 글/블로그가 보이면 '있음', 아니면 '없음'.
    //   순위가 아니라 존재만 표기(사용자 요청). 'fail'=차단/파싱실패. (구버전 레코드엔 없음)
    ws?: '있음' | '없음' | 'fail';
};

// 블로그 대표키워드(사용자 지정) — "이 블로그가 이 키워드로 통합탭/블로그탭 몇 위인지".
export type BlogKeyword = {
    id: string;
    created_at: string;
    blog_account_id: string;
    keyword: string;
    // measurements 는 크롤러(service_role)만 기록. 프론트 payload 에 절대 포함 말 것(그래서 optional).
    measurements?: BlogMeasurement[];
};

// 웹사이트(통합검색 '웹사이트' 섹션) 순위 — 회사 단위 측정값.
// status: ok=노출/측정성공, out=권외, fail=API/네트워크 실패, skip=url·키워드 미설정
export type WebMeasurement = {
    date: string; // YYYY-MM-DD
    we: number; // 웹사이트 섹션 순위 (out/fail/skip 이면 99)
    status: 'ok' | 'out' | 'fail' | 'skip';
};

// 누적 계약금액 1건. amount=원 단위 숫자, date=계약일(선택), note=메모(선택).
export type AmountEntry = {
    amount: number;
    date?: string;
    note?: string;
};

// 계약 기간 1건(시작일~종료일). contracts 배열에 누적 — 마지막 항목 = 현재 계약, 종료일 = 재계약 예정일.
export type ContractPeriod = {
    start: string;
    count?: number; // 계약 건수(건 단위 계약 — 일수/종료일 대신). 레거시 end 는 유지만.
    end?: string; // (레거시) 종료일
    note?: string;
};

// 값+날짜 변경 이력 1건(주 발행·기자단처럼 '바뀐 값'을 날짜와 함께 누적). 마지막 항목 = 현재값.
export type HistoryEntry = {
    value: string;
    date?: string;
};

export type BlogAccount = {
    id: string;
    created_at: string;
    name: string;
    manager: string | null;
    contact: string | null; // 연락처
    blog_url: string;
    blog_id: string | null;
    goal_count: number | null;
    remain_count: number | null;
    weekly: string | null; // 주 발행(현재값 = weekly_history 마지막)
    weekly_history: HistoryEntry[] | null; // 주 발행 변경 이력(값+날짜)
    note: string | null; // 특이사항
    contract_date: string | null; // 최초 계약 시작일(레거시 — contracts 없을 때 시드)
    contracts: ContractPeriod[] | null; // 계약 기간 이력 [{start,end}] · 마지막=현재 계약
    reporter: string | null; // 기자단(현재값 = reporter_history 마지막) — 표시용 텍스트
    reporter_history: HistoryEntry[] | null; // 기자단 변경 이력(값+날짜)
    reporter_id: string | null; // 담당 기자단(개인) profiles.id — 기자단 ERP 스코프 기준
    reporter_name?: string | null; // 조인 편의(표시용, 저장 안 함)
    amount: string | null; // 금액(레거시 단일값 — amounts 없을 때만 폴백 표시)
    amounts: AmountEntry[] | null; // 누적 계약금액 내역(합산 표시). 추가 계약마다 한 건씩 쌓임.
    login_id: string | null; // 아이디
    login_pw: string | null; // 비밀번호
    manage_sheet_url: string | null; // 발행 관리시트
    is_active: boolean;
    contract_ended_at?: string | null; // 계약 종료 시각(KST). 있으면 '계약 종료' 업체 → 별도 탭에 보관.
    client_id: string | null;
    // 웹사이트 순위 추적 (회사 단위). 없는 업체는 NULL = "해당없음".
    website_url: string | null; // 호스트만 저장(예: momo-cleaning.com)
    rep_keyword: string | null; // 대표키워드 1개
    // website_measurements 는 크롤러(service_role)만 patch 한다.
    // 프론트의 insert/update payload 에는 절대 포함하지 말 것(optional 인 이유).
    website_measurements?: WebMeasurement[];
};

export type BlogPost = {
    id: string;
    created_at: string;
    blog_account_id: string;
    post_url: string | null;
    title: string | null;
    keyword: string | null;
    keyword_manual: string | null; // 사용자가 직접 입력한 키워드. 있으면 자동 측정도 이 값으로 측정(크롤이 덮어쓰지 않음).
    published_date: string | null;
    published_at: string | null; // 업로드 시각(KST). 누락 건(18~24시 업로드분) 판정용.
    first_seen_at: string | null;
    report_sent_at: string | null; // 발행보고 자동발송 완료 시각(KST). 카톡 자동발송(auto_report)이 기록 → '발송 리스트'.
    report_send_fail?: string | null; // 자동발송 실패 사유(이름불일치/세션만료 등). 있고 report_sent_at 없으면 '누락 건'. 성공 시 비움.
    rank_sent_at?: string | null; // 전날 '순위 성과보고' 발송 완료 시각(발행보고와 별개) → 전날 모달 '발송 리스트' + KPI.
    measurements: BlogMeasurement[];
};

// URL에서 네이버 블로그 아이디 추출 (https://blog.naver.com/puleenbe → puleenbe)
export function extractBlogId(url: string): string {
    const match = url.match(/blog\.naver\.com\/([^/?#]+)/i);
    return match ? match[1] : '';
}

// ── 관리 블로그 ─────────────────────────────────────────
// clientId 를 주면 그 고객사(업체)만 로드 — 고객 모드용(데이터 격리 + 대역폭 절감). 없으면 전체.
export async function getBlogAccounts(clientId?: string) {
    let query = supabase.from('blog_accounts').select('*').order('created_at', { ascending: true });
    if (clientId) {
        query = query.eq('client_id', clientId);
    }
    const { data, error } = await query.returns<BlogAccount[]>();

    return { data: data ?? [], error };
}

// 기자단(개인) 계정 목록 — 블로그 시트 '담당 기자단 지정' 드롭다운용. RLS: 내부만 reporter 행 조회.
export type ReporterProfile = { id: string; name: string | null; email: string };
export async function getReporters() {
    const { data, error } = await supabase
        .from('profiles')
        .select('id,name,email')
        .eq('role', 'reporter')
        .eq('is_active', true)
        .order('name', { ascending: true })
        .returns<ReporterProfile[]>();
    return { data: data ?? [], error };
}

// 기자단 계정 삭제(admin) — Edge Function이 auth 유저+profiles 삭제 → 로그인 불가 + 담당 블로그 자동 해제.
export async function deleteReporter(profileId: string): Promise<{ error: { message: string } | null }> {
    const { data, error } = await supabase.functions.invoke('clever-processor', {
        body: { action: 'delete_reporter', profileId },
    });
    if (error) {
        let msg = error.message || '삭제 실패';
        try {
            const ctx = (error as { context?: Response }).context;
            const parsed = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
            if (parsed?.error) msg = parsed.error;
        } catch {
            /* 무시 */
        }
        return { error: { message: msg } };
    }
    if (data?.error) return { error: { message: data.error } };
    return { error: null };
}

export async function insertBlogAccounts(payloads: Array<Partial<BlogAccount>>) {
    const { data, error } = await supabase
        .from('blog_accounts')
        .insert(payloads)
        .select()
        .returns<BlogAccount[]>();

    return { data: data ?? [], error };
}

// 계약 등록 시 블로그 관리 시트에도 자동 등록 — 그 고객사에 블로그 계정이 아직 없으면 생성(있으면 skip).
//   URL은 비워두고 시트에 노출 → 사용자가 시트에서 URL 채우면 크롤 대상이 됨.
export async function ensureClientBlogAccount(
    clientId: string,
    name: string,
    fields: {
        manager?: string | null;
        goal_count?: number | null;
        remain_count?: number | null;
        contract_date?: string | null;
        amount?: number | null;
        blog_url?: string | null; // 계약 추가 시 입력한 발행 URL → 크롤 대상으로 바로 연동
    },
) {
    const url = (fields.blog_url || '').trim();
    const { data } = await getBlogAccounts(clientId);
    // 같은 이름(관리시트 업체명)의 계정이 이미 있으면 기본 skip. 다중 블로그(A/B/C)는 이름이 달라 각각 생성됨.
    const existing = data.find((a) => a.name === name);
    if (existing) {
        // 이미 있는데 URL이 비었/placeholder이고 새 URL이 들어오면 채워서 연동(크롤 대상화).
        if (url && !/^https?:\/\//.test((existing.blog_url || '').trim())) {
            const { error } = await updateBlogAccount(existing.id, {
                blog_url: url,
                blog_id: extractBlogId(url) || existing.blog_id,
            });
            return { created: false, error };
        }
        return { created: false };
    }
    const { error } = await insertBlogAccounts([
        {
            amounts: fields.amount ? [{ amount: fields.amount }] : [],
            blog_url: url,
            blog_id: url ? extractBlogId(url) : null,
            client_id: clientId,
            contract_date: fields.contract_date ?? null,
            goal_count: fields.goal_count ?? null,
            is_active: true,
            manager: fields.manager ?? null,
            name,
            remain_count: fields.remain_count ?? null,
        } as Partial<BlogAccount>,
    ]);
    return { created: !error, error };
}

// 계약 관리(client_contracts)의 블로그 계약 → 블로그 관리 시트(blog_accounts) 반영.
//   블로그 대시보드 = 브랜드 블로그 계약 1:1(그 고객사 blog_account 1건). 계약 관리가 단일 출처이므로
//   금액·계약일·건수·잔여(진행률)를 이쪽으로 미러링. 계정이 없으면 무시(아직 시드 안 됨).
export async function syncBlogAccountFromContract(
    clientId: string | null | undefined,
    fields: {
        goal_count?: number | null;
        remain_count?: number | null;
        contract_date?: string | null;
        amount?: number | null;
        name?: string | null;
        manager?: string | null;
        contact?: string | null;
    },
    blogName?: string | null,
) {
    if (!clientId) return { synced: false };
    const { data } = await getBlogAccounts(clientId);
    if (!data.length) return { synced: false };
    // 다중 블로그면 blog_name(관리시트 업체명)으로 정확 매칭, 없으면 첫 계정.
    const acc = (blogName && data.find((a) => a.name === blogName)) || data[0];
    const payload: Partial<BlogAccount> = {};
    if (fields.goal_count !== undefined) payload.goal_count = fields.goal_count;
    if (fields.remain_count !== undefined) payload.remain_count = fields.remain_count;
    if (fields.contract_date !== undefined) payload.contract_date = fields.contract_date;
    if (fields.amount != null) payload.amounts = [{ amount: fields.amount }];
    if (fields.name) payload.name = fields.name;
    if (fields.manager !== undefined) payload.manager = fields.manager ?? null;
    if (fields.contact !== undefined) payload.contact = fields.contact ?? null;
    if (!Object.keys(payload).length) return { synced: false };
    const { error } = await updateBlogAccount(acc.id, payload);
    return { synced: !error, error };
}

export async function updateBlogAccount(id: string, payload: Partial<BlogAccount>) {
    const { data, error } = await supabase
        .from('blog_accounts')
        .update(payload)
        .eq('id', id)
        .select()
        .returns<BlogAccount[]>();

    return { data: data ?? [], error };
}

export async function deleteBlogAccount(id: string) {
    const { error } = await supabase.from('blog_accounts').delete().eq('id', id);
    return { error };
}

// ── 추적 글 ─────────────────────────────────────────────
// accountIds 를 주면 그 블로그 계정들의 글만 로드 — 고객 모드용. 빈 배열이면 결과 없음. 없으면 전체.
export async function getBlogPosts(accountIds?: string[]) {
    if (accountIds && accountIds.length === 0) {
        return { data: [] as BlogPost[], error: null };
    }
    // published_date desc + id — 동일 발행일 글의 순서를 고정(재조회해도 순위 트래커 행 위치 안 바뀌게).
    let query = supabase
        .from('blog_posts')
        .select('*')
        .order('published_date', { ascending: false })
        .order('id', { ascending: true });
    if (accountIds) {
        query = query.in('blog_account_id', accountIds);
    }
    const { data, error } = await query.returns<BlogPost[]>();

    return { data: data ?? [], error };
}

// 카톡 발송 요청을 큐(report_send_requests)에 넣는다 → PC 리스너(send_listener.py)가 카톡 비즈 웹으로 발송.
//   company=상담방 이름(=업체명/kakao_room), message=보낼 양식, kind=publish|rank|missed.
export async function queueReportSend(input: {
    post_id: string;
    company: string;
    message: string;
    kind: 'publish' | 'rank' | 'missed';
}) {
    return supabase.from('report_send_requests').insert(input);
}

// 자동키워드 수동 수정 — keyword_manual 만 갱신(자동 keyword/측정은 크롤이 유지). 빈 문자열이면 수동값 해제.
export async function updatePostKeyword(postId: string, keywordManual: string) {
    const value = keywordManual.trim();
    const { error } = await supabase
        .from('blog_posts')
        .update({ keyword_manual: value || null })
        .eq('id', postId);
    return { error };
}

// 측정 이력(measurements) 직접 갱신 — 키워드 수정 후 즉시 재측정 결과 반영용. (크롤은 service_role 로 별도 기록)
export async function updatePostMeasurements(postId: string, measurements: BlogMeasurement[]) {
    const { error } = await supabase
        .from('blog_posts')
        .update({ measurements })
        .eq('id', postId);
    return { error };
}

// KST(UTC+9) YYYY-MM-DD — 크롤러 todayKST(crawlLib.mjs)와 동일해야 같은 날짜 레코드가 깔끔히 교체됨.
export function todayKST(): string {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// blog.naver.com/{id}/{logNo} → logNo. 글 단위 블로그탭 측정에 사용(없으면 빈 문자열).
export function extractLogNo(url: string): string {
    const m = String(url || '').match(/(?:m\.)?blog\.naver\.com\/[^/?#]+\/(\d{6,})/);
    return m ? m[1] : '';
}

// ── 대표키워드 ──────────────────────────────────────────
// measurements 는 크롤러만 기록하므로 프론트는 행 insert/delete 만 한다(update 경로 없음).
export async function getBlogKeywords() {
    const { data, error } = await supabase
        .from('blog_keywords')
        .select('*')
        .order('created_at', { ascending: true })
        .returns<BlogKeyword[]>();

    return { data: data ?? [], error };
}

export async function insertBlogKeyword(blogAccountId: string, keyword: string) {
    const { data, error } = await supabase
        .from('blog_keywords')
        .insert({ blog_account_id: blogAccountId, keyword })
        .select()
        .returns<BlogKeyword[]>();

    return { data: data ?? [], error };
}

export async function deleteBlogKeyword(id: string) {
    const { error } = await supabase.from('blog_keywords').delete().eq('id', id);
    return { error };
}
