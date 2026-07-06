// ⚠️ 임시: 로그인/OTP 게이트를 끄고 누구나 ERP 에 접근하게 한다.
// true 면: 로그인 화면을 건너뛰고 익명 세션으로 자동 로그인(데이터 RLS 통과) + 모두 관리자 권한.
// 원래대로 되돌리려면 이 값을 false 로 바꾸고 재배포하면 끝.
//
// 전제: Supabase 대시보드 > Authentication > Sign In / Providers > "Anonymous sign-ins" 를 켜야
//       익명 자동 로그인이 동작한다. (안 켜면 로그인 화면으로 폴백)
export const AUTH_DISABLED = false;
