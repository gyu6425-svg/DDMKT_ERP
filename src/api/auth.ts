import { hasSupabaseConfig, supabase } from '../lib/supabase';

const missingConfigError = new Error('Supabase environment variables are missing.');

export async function sendOtp(email: string) {
    if (!hasSupabaseConfig) {
        return { data: null, error: missingConfigError };
    }

    return supabase.auth.signInWithOtp({
        email,
        options: {
            shouldCreateUser: false,
        },
    });
}

export async function verifyEmailOtp(email: string, token: string) {
    if (!hasSupabaseConfig) {
        return { data: null, error: missingConfigError };
    }

    return supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
    });
}

// 이메일 + 비밀번호 로그인.
export async function signInWithPassword(email: string, password: string) {
    if (!hasSupabaseConfig) {
        return { data: null, error: missingConfigError };
    }
    return supabase.auth.signInWithPassword({ email: email.trim(), password });
}

// 비밀번호 변경 — 로그인 상태에서 새 비밀번호 저장(Supabase Auth에 영구 반영).
export async function updatePassword(password: string) {
    if (!hasSupabaseConfig) {
        return { data: null, error: missingConfigError };
    }
    return supabase.auth.updateUser({ password });
}

export async function signOut() {
    if (!hasSupabaseConfig) {
        return { error: null };
    }

    return supabase.auth.signOut();
}

export async function getSession() {
    if (!hasSupabaseConfig) {
        return { data: { session: null }, error: missingConfigError };
    }

    return supabase.auth.getSession();
}
