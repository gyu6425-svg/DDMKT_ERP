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
    weekly: string | null;
    note: string | null; // 특이사항
    contract_date: string | null; // 계약일자
    reporter: string | null; // 기자단
    amount: string | null; // 금액(레거시 단일값 — amounts 없을 때만 폴백 표시)
    amounts: AmountEntry[] | null; // 누적 계약금액 내역(합산 표시). 추가 계약마다 한 건씩 쌓임.
    login_id: string | null; // 아이디
    login_pw: string | null; // 비밀번호
    manage_sheet_url: string | null; // 발행 관리시트
    is_active: boolean;
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
    first_seen_at: string | null;
    measurements: BlogMeasurement[];
};

// URL에서 네이버 블로그 아이디 추출 (https://blog.naver.com/puleenbe → puleenbe)
export function extractBlogId(url: string): string {
    const match = url.match(/blog\.naver\.com\/([^/?#]+)/i);
    return match ? match[1] : '';
}

// ── 관리 블로그 ─────────────────────────────────────────
export async function getBlogAccounts() {
    const { data, error } = await supabase
        .from('blog_accounts')
        .select('*')
        .order('created_at', { ascending: true })
        .returns<BlogAccount[]>();

    return { data: data ?? [], error };
}

export async function insertBlogAccounts(payloads: Array<Partial<BlogAccount>>) {
    const { data, error } = await supabase
        .from('blog_accounts')
        .insert(payloads)
        .select()
        .returns<BlogAccount[]>();

    return { data: data ?? [], error };
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
export async function getBlogPosts() {
    const { data, error } = await supabase
        .from('blog_posts')
        .select('*')
        .order('published_date', { ascending: false })
        .returns<BlogPost[]>();

    return { data: data ?? [], error };
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
