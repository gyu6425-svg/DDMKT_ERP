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
