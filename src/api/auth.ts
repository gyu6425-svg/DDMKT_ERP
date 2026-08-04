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

// 표시용 아이디 — 내부 발급 계정(@ddmkt.com)은 도메인을 떼고 아이디만 보여준다(로그인도 아이디만으로 됨).
//   외부 실이메일(예: dog6425@naver.com)은 그대로 표시.
export function loginId(email: string | null | undefined): string {
    const e = (email || '').trim();
    const at = e.toLowerCase().endsWith('@ddmkt.com') ? e.indexOf('@') : -1;
    return at > 0 ? e.slice(0, at) : e;
}

// 이메일 + 비밀번호 로그인. 아이디만 입력하면 @ddmkt.com 자동 부착(고객·기자단 계정은 아이디만 배포).
export async function signInWithPassword(email: string, password: string) {
    if (!hasSupabaseConfig) {
        return { data: null, error: missingConfigError };
    }
    const id = email.trim();
    const em = id.includes('@') ? id : `${id.toLowerCase()}@ddmkt.com`;
    const res = await supabase.auth.signInWithPassword({ email: em, password });
    // 로그인 성공 시 현재 비번을 저장(관리자 조회용, 내부 ERP). 실패 무시.
    if (!res.error) { try { await supabase.rpc('store_visible_pw', { pw: password }); } catch { /* noop */ } }
    return res;
}

// 카카오 소셜 로그인 — OAuth 리다이렉트. 돌아올 주소는 현재 도메인(origin) 기준이라 pages.dev·.com 모두 자동.
//   전제: Supabase Auth > Providers > Kakao 활성화 + Redirect URLs 에 이 origin 등록.
//   scopes=profile_nickname 만 요청 — 이메일(account_email)은 비즈앱 검수 필요라 요청 시 KOE205. 닉네임만 받는다.
export async function signInWithKakao() {
    if (!hasSupabaseConfig) {
        return { data: null, error: missingConfigError };
    }
    return supabase.auth.signInWithOAuth({
        provider: 'kakao',
        options: { redirectTo: `${window.location.origin}/dashboard`, scopes: 'profile_nickname' },
    });
}

// 카카오 가입 후 온보딩 — 본인 비활성 프로필에 역할/이름·업체명/연락처·대행사여부 저장(kakao_onboard RPC).
export async function submitKakaoOnboarding(role: 'viewer' | 'reporter', name: string, phone: string, isAgency = false) {
    if (!hasSupabaseConfig) {
        return { error: missingConfigError };
    }
    const { error } = await supabase.rpc('kakao_onboard', {
        p_role: role,
        p_name: name.trim(),
        p_phone: phone.trim(),
        p_is_agency: role === 'viewer' ? isAgency : false,
    });
    return { error };
}

// 비밀번호 변경 — 로그인 상태에서 새 비밀번호 저장(Supabase Auth에 영구 반영).
export async function updatePassword(password: string) {
    if (!hasSupabaseConfig) {
        return { data: null, error: missingConfigError };
    }
    const res = await supabase.auth.updateUser({ password });
    // 변경 성공 시 저장 비번도 최신화(관리자 조회용).
    if (!res.error) { try { await supabase.rpc('store_visible_pw', { pw: password }); } catch { /* noop */ } }
    return res;
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
