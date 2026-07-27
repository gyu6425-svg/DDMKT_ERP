-- 계약관리 빈 화면 즉시 복구 — clients/client_contracts/contract_data 의 RLS 정책 재생성.
--   원인: 정책 DROP 은 됐는데 CREATE 가 안 돌아, RLS 켜짐 + 정책 0개 = 전부 차단(데이터는 그대로).
--   Supabase > SQL Editor 에 통째로 붙여넣고 실행(재실행 안전 · 멱등). 실행 후 웹 새로고침.

-- 1) 판정 함수 보장(내부계정 = profiles.is_active=true AND client_id IS NULL)
create or replace function public.is_internal()
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and is_active = true and client_id is null
  );
$$;
create or replace function public.my_client_id()
returns uuid language sql security definer set search_path = public as $$
  select client_id from public.profiles where user_id = auth.uid() and is_active = true limit 1;
$$;

-- 2) clients
alter table public.clients enable row level security;
drop policy if exists "clients 내부 전체" on public.clients;
drop policy if exists "clients 고객 본인 읽기" on public.clients;
create policy "clients 내부 전체" on public.clients
  for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy "clients 고객 본인 읽기" on public.clients
  for select to authenticated using (id = public.my_client_id());

-- 3) client_contracts
alter table public.client_contracts enable row level security;
drop policy if exists "client_contracts 내부 전체" on public.client_contracts;
drop policy if exists "client_contracts 고객 본인 읽기" on public.client_contracts;
create policy "client_contracts 내부 전체" on public.client_contracts
  for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy "client_contracts 고객 본인 읽기" on public.client_contracts
  for select to authenticated using (client_id = public.my_client_id());

-- 4) contract_data
alter table public.contract_data enable row level security;
drop policy if exists "contract_data 내부 전체" on public.contract_data;
create policy "contract_data 내부 전체" on public.contract_data
  for all to authenticated using (public.is_internal()) with check (public.is_internal());

-- 5) 진단 — 아래 3개 테이블에 정책 행이 보이면 복구 완료
select tablename, policyname from pg_policies
where tablename in ('clients','client_contracts','contract_data')
order by tablename, policyname;
