import { supabase } from '../lib/supabase';

// 셀프 회원가입 — Edge Function(create-customer=clever-processor)로 처리.
//   가입은 로그인 없이(공개) 호출, 목록/승인/거절은 관리자 세션으로 호출(함수가 admin 검증).

export type SignupRole = 'viewer' | 'reporter'; // 고객 / 기자단

export type PendingSignup = {
    id: string;
    name: string | null;
    email: string;
    role: SignupRole;
    phone: string | null;
    signup_company: string | null;
    signup_biz_no: string | null;
    created_at: string;
};

// invoke 결과에서 함수가 준 에러 본문을 최대한 뽑아낸다(non-2xx는 supabase-js가 generic 메시지만 줌).
async function detailError(error: { message?: string; context?: Response } | null): Promise<string | null> {
    if (!error) return null;
    let detail = error.message || '서버 오류';
    try {
        const ctx = error.context;
        const parsed = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
        if (parsed?.error) detail = parsed.error;
    } catch {
        /* 무시 */
    }
    return detail;
}

// 회원가입 신청(공개) — 비활성 계정 생성. 성공 시 { ok:true }.
export async function requestSignup(input: {
    login: string;
    password: string;
    name: string;
    role: SignupRole;
    company?: string;
    bizNo?: string;
    phone?: string;
}): Promise<{ ok: boolean; error: string | null }> {
    const { data, error } = await supabase.functions.invoke('clever-processor', {
        body: { action: 'signup', ...input },
    });
    const err = await detailError(error);
    if (err) return { ok: false, error: err };
    if (data?.error) return { ok: false, error: data.error };
    return { ok: !!data?.ok, error: data?.ok ? null : '알 수 없는 응답' };
}

// 승인 대기 목록(관리자).
export async function listPendingSignups(): Promise<{ data: PendingSignup[]; error: string | null }> {
    const { data, error } = await supabase.functions.invoke('clever-processor', {
        body: { action: 'list_pending' },
    });
    const err = await detailError(error);
    if (err) return { data: [], error: err };
    return { data: (data?.pending as PendingSignup[]) ?? [], error: null };
}

// 승인(관리자) — 고객이면 clientId 필수.
export async function approveSignup(
    profileId: string,
    clientId?: string,
): Promise<{ ok: boolean; error: string | null }> {
    const { data, error } = await supabase.functions.invoke('clever-processor', {
        body: { action: 'approve_signup', profileId, clientId: clientId ?? '' },
    });
    const err = await detailError(error);
    if (err) return { ok: false, error: err };
    if (data?.error) return { ok: false, error: data.error };
    return { ok: !!data?.ok, error: null };
}

// 거절(관리자) — 비활성 계정 삭제.
export async function rejectSignup(profileId: string): Promise<{ ok: boolean; error: string | null }> {
    const { data, error } = await supabase.functions.invoke('clever-processor', {
        body: { action: 'reject_signup', profileId },
    });
    const err = await detailError(error);
    if (err) return { ok: false, error: err };
    if (data?.error) return { ok: false, error: data.error };
    return { ok: !!data?.ok, error: null };
}
