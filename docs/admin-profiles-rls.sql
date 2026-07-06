-- ============================================================================
-- 계정 권한 관리(사원 관리) — 김종인(대표) 계정만 profiles 전체 읽기/수정 가능.
--   다른 계정은 기존대로 본인 행만 읽기(권한 상승 불가). Supabase SQL Editor에서 실행.
-- ============================================================================

-- 김종인(대표) 여부 — 보안 정의(RLS 재귀 방지).
create or replace function public.is_owner_admin()
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and is_active = true
      and lower(email) = 'rlawhddls@ddmkt.com'
  );
$$;

-- 대표만 모든 계정 조회/수정(역할·담당·활성 변경).
drop policy if exists "profiles owner manage" on public.profiles;
create policy "profiles owner manage" on public.profiles
  for all to authenticated
  using (public.is_owner_admin())
  with check (public.is_owner_admin());
-- (기존 "profiles self read"는 유지 — 각자 본인 행 읽기)
