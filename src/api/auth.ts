import { supabase } from '../lib/supabase';

export async function sendOtp(email: string) {
    return supabase.auth.signInWithOtp({
        email,
        options: {
            shouldCreateUser: false,
        },
    });
}

export async function verifyEmailOtp(email: string, token: string) {
    return supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
    });
}

export async function signOut() {
    return supabase.auth.signOut();
}

export async function getSession() {
    return supabase.auth.getSession();
}
