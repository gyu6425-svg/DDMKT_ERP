-- ============================================================================
-- 기자단/고객이 남의 업체 데이터까지 보는 문제 수정
--   원인: rls-recover-all.sql 이 is_internal() 을 'reporter 제외' 조항 없는 옛 버전으로 덮어씀.
--         기자단은 client_id 가 NULL 이라 내부로 오인 → 내부정책으로 전체(75블로그) 열람.
--         + 락아웃 때 날아간 기자단 전용 read 정책이 복구에 빠져 있었음.
--   Supabase > SQL Editor 에 통째로 실행(멱등). 공유 DB라 main 에서 1회만. 이후 각자 재로그인/새로고침.
-- ============================================================================

-- 1) is_internal() 교정 — 내부 = 활성 + client_id NULL + role 이 reporter/viewer 아님
--    (기자단·고객을 내부에서 제외. 내부직원 admin/manager/sales 는 영향 없음)
create or replace function public.is_internal()
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid()
      and is_active = true
      and client_id is null
      and lower(coalesce(role,'')) not in ('reporter','viewer')
  );
$$;

-- 2) 기자단 스코프 함수
create or replace function public.my_profile_id()
returns uuid language sql security definer set search_path = public as $$
  select id from public.profiles where user_id = auth.uid() and is_active = true limit 1;
$$;
create or replace function public.is_reporter()
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.profiles
    where user_id = auth.uid() and lower(coalesce(role,'')) = 'reporter');
$$;

-- 3) 기자단 read 정책 — 본인 담당(reporter_id = 내 profiles.id) 블로그만
drop policy if exists "blog_accounts read 기자단" on public.blog_accounts;
create policy "blog_accounts read 기자단" on public.blog_accounts
  for select to authenticated
  using (public.is_reporter() and reporter_id = public.my_profile_id());

drop policy if exists "blog_posts read 기자단" on public.blog_posts;
create policy "blog_posts read 기자단" on public.blog_posts
  for select to authenticated
  using (public.is_reporter() and exists (
    select 1 from public.blog_accounts a
    where a.id = blog_posts.blog_account_id and a.reporter_id = public.my_profile_id()));

drop policy if exists "blog_keywords read 기자단" on public.blog_keywords;
create policy "blog_keywords read 기자단" on public.blog_keywords
  for select to authenticated
  using (public.is_reporter() and exists (
    select 1 from public.blog_accounts a
    where a.id = blog_keywords.blog_account_id and a.reporter_id = public.my_profile_id()));

-- 4) 내부 직원이 기자단 프로필만 조회(배정 드롭다운용)
drop policy if exists "profiles 내부 기자단 조회" on public.profiles;
create policy "profiles 내부 기자단 조회" on public.profiles
  for select to authenticated
  using (public.is_internal() and lower(coalesce(role,'')) = 'reporter');

-- 5) 진단 — 기자단 계정으로 로그인 시 blog_accounts 는 본인 담당만 보여야 함.
--    (내부계정 admin/manager/sales 는 여전히 전체. 고객은 본인 업체만.)
select 'is_internal 교정 완료 — 기자단/고객 재로그인 후 확인' as note;
