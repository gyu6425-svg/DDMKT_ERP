-- ============================================================================
-- 긴급 복구: 모든 대시보드 빈칸 → RLS 켜짐 + 정책 0개 테이블 전부 내부정책 복구
--   원인: 정책 DROP 만 되고 CREATE 미실행. 데이터는 무손실, RLS 가 가린 것뿐.
--   Supabase > SQL Editor 에 통째로 붙여넣고 실행(멱등 · 재실행 안전). 이후 웹 새로고침.
-- ============================================================================

-- 0) 판정 함수 보장 (내부 = profiles.is_active=true AND client_id IS NULL)
create or replace function public.is_internal()
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.profiles
    where user_id = auth.uid() and is_active = true and client_id is null);
$$;
create or replace function public.my_client_id()
returns uuid language sql security definer set search_path = public as $$
  select client_id from public.profiles where user_id = auth.uid() and is_active = true limit 1;
$$;

-- 1) 'RLS 켜짐 + 정책 0개'인 모든 public 테이블에 내부 전체 정책 복구
--    (정책이 이미 있는 테이블은 건드리지 않음 → 정상 테이블 안전)
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname)
  loop
    execute format(
      'create policy "복구 내부 전체" on public.%I for all to authenticated '
      'using (public.is_internal()) with check (public.is_internal())', r.relname);
    raise notice '복구: %', r.relname;
  end loop;
end $$;

-- 2) profiles 본인 읽기(로그인/권한 로드에 필수) — 멱등
alter table public.profiles enable row level security;
drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles
  for select to authenticated using (user_id = auth.uid());

-- 3) 고객/포털 read 정책 복구(고객 로그인도 자기 데이터 보이게) — 멱등
drop policy if exists "clients 고객 본인 읽기" on public.clients;
create policy "clients 고객 본인 읽기" on public.clients
  for select to authenticated using (id = public.my_client_id());

drop policy if exists "client_contracts 고객 본인 읽기" on public.client_contracts;
create policy "client_contracts 고객 본인 읽기" on public.client_contracts
  for select to authenticated using (client_id = public.my_client_id());

drop policy if exists "blog_accounts 고객 본인 읽기" on public.blog_accounts;
create policy "blog_accounts 고객 본인 읽기" on public.blog_accounts
  for select to authenticated using (client_id = public.my_client_id());

drop policy if exists "blog_posts 고객 본인 읽기" on public.blog_posts;
create policy "blog_posts 고객 본인 읽기" on public.blog_posts
  for select to authenticated using (exists (
    select 1 from public.blog_accounts ba
    where ba.id = blog_posts.blog_account_id and ba.client_id = public.my_client_id()));

drop policy if exists "blog_keywords 고객 본인 읽기" on public.blog_keywords;
create policy "blog_keywords 고객 본인 읽기" on public.blog_keywords
  for select to authenticated using (exists (
    select 1 from public.blog_accounts ba
    where ba.id = blog_keywords.blog_account_id and ba.client_id = public.my_client_id()));

drop policy if exists "cafe_accounts 고객 본인 읽기" on public.cafe_accounts;
create policy "cafe_accounts 고객 본인 읽기" on public.cafe_accounts
  for select to authenticated using (client_id = public.my_client_id());

drop policy if exists "crp 고객 본인 읽기" on public.cafe_rank_posts;
create policy "crp 고객 본인 읽기" on public.cafe_rank_posts
  for select to authenticated using (exists (
    select 1 from public.cafe_accounts ca
    where ca.id = public.cafe_rank_posts.cafe_account_id and ca.client_id = public.my_client_id()));

-- 4) 진단 — 테이블별 정책 수(각 테이블에 1개 이상 있으면 복구됨)
select tablename, count(*) as policies
from pg_policies where schemaname = 'public'
group by tablename order by tablename;
