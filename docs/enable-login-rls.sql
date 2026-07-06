-- ============================================================================
-- DDMKT_ERP 로그인 강제 + 백엔드 잠금(RLS)  —  Supabase SQL Editor에서 순서대로 실행
--   핵심 교정: 권한 판정은 profiles.user_id = auth.uid() 기준 (profiles.id 아님!).
--   프론트 anon 키가 공개돼 있으므로, 로그인한 실제 사용자만 데이터 접근하도록 서버가 강제.
--   크롤러(service_role 키)는 RLS 우회 → 영향 없음.
-- ============================================================================

-- ── 0) 첫 로그인 강제 비밀번호 변경 플래그 ───────────────────────────────
alter table public.profiles
  add column if not exists must_change_password boolean not null default true;

-- ── 1) 권한 함수 (user_id = auth.uid() 기준) ─────────────────────────────
create or replace function public.is_internal()
returns boolean language sql security definer set search_path = public as $$
  select coalesce(
    (select client_id from public.profiles where user_id = auth.uid() and is_active = true) is null,
    false  -- profiles에 없으면 내부 아님(차단)
  );
$$;

create or replace function public.my_client_id()
returns uuid language sql security definer set search_path = public as $$
  select client_id from public.profiles where user_id = auth.uid() and is_active = true limit 1;
$$;

-- 비밀번호 변경 완료 표시 — 프론트가 profiles를 직접 수정하지 못하게(권한상승 방지) RPC로만.
create or replace function public.mark_password_changed()
returns void language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where user_id = auth.uid();
$$;
grant execute on function public.mark_password_changed() to authenticated;

-- ── 2) profiles — 본인 행 읽기만(수정은 RPC로). 권한상승 차단 ────────────
alter table public.profiles enable row level security;
drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles
  for select to authenticated using (user_id = auth.uid());
-- (self-update 정책 없음 → 사원이 자기 role/duties 못 바꿈)

-- ── 3) clients — 내부 전체 read/write, 고객은 자기 업체만 read ────────────
alter table public.clients enable row level security;
drop policy if exists "본인 담당 조회" on public.clients;
drop policy if exists "관리자 전체 조회" on public.clients;
drop policy if exists "본인 담당 수정" on public.clients;
drop policy if exists "관리자 고객 수정" on public.clients;
drop policy if exists "로그인 사용자 등록" on public.clients;
drop policy if exists "clients all" on public.clients;
create policy "clients 내부 전체" on public.clients
  for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy "clients 고객 본인 읽기" on public.clients
  for select to authenticated using (id = public.my_client_id());

-- ── 4) client_contracts ──────────────────────────────────────────────────
alter table public.client_contracts enable row level security;
drop policy if exists "client_contracts all authenticated" on public.client_contracts;
create policy "client_contracts 내부 전체" on public.client_contracts
  for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy "client_contracts 고객 본인 읽기" on public.client_contracts
  for select to authenticated using (client_id = public.my_client_id());

-- ── 5) contract_data ─────────────────────────────────────────────────────
alter table public.contract_data enable row level security;
drop policy if exists "contract_data all" on public.contract_data;
create policy "contract_data 내부 전체" on public.contract_data
  for all to authenticated using (public.is_internal()) with check (public.is_internal());

-- ── 6) blog_accounts — 내부 전체, 고객 자기 업체만 read ───────────────────
alter table public.blog_accounts enable row level security;
drop policy if exists "blog_accounts auth" on public.blog_accounts;
create policy "blog_accounts 내부 전체" on public.blog_accounts
  for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy "blog_accounts 고객 본인 읽기" on public.blog_accounts
  for select to authenticated using (client_id = public.my_client_id());

-- ── 7) blog_posts / blog_keywords — 내부 전체, 고객은 자기 업체 글만 ──────
alter table public.blog_posts enable row level security;
drop policy if exists "blog_posts auth" on public.blog_posts;
create policy "blog_posts 내부 전체" on public.blog_posts
  for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy "blog_posts 고객 본인 읽기" on public.blog_posts
  for select to authenticated using (exists (
    select 1 from public.blog_accounts ba
    where ba.id = blog_posts.blog_account_id and ba.client_id = public.my_client_id()));

alter table public.blog_keywords enable row level security;
drop policy if exists "blog_keywords auth" on public.blog_keywords;
create policy "blog_keywords 내부 전체" on public.blog_keywords
  for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy "blog_keywords 고객 본인 읽기" on public.blog_keywords
  for select to authenticated using (exists (
    select 1 from public.blog_accounts ba
    where ba.id = blog_keywords.blog_account_id and ba.client_id = public.my_client_id()));

-- ── 8) 내부 전용 부가 테이블 — 로그인 사용자만(내부) ─────────────────────
do $$
declare t text;
begin
  foreach t in array array['sales_people','api_usage','banner_outputs','blog_outputs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s internal" on public.%I', t, t);
    execute format($p$create policy "%s internal" on public.%I for all to authenticated
      using (public.is_internal()) with check (public.is_internal())$p$, t, t);
  end loop;
end $$;

-- ============================================================================
-- 적용 순서(권장): 0~2 먼저 실행 → 내부계정 로그인해서 profiles 로드/비번변경 확인
--   → 3~8 실행 → 내부계정 데이터 전부 보이는지 확인 → 앱의 AUTH_DISABLED=false 배포
--   → (Supabase Auth) Anonymous sign-ins 끄기 → 고객계정 격리 확인 → 크롤러 test run
-- 롤백: 문제 시 각 테이블 `alter table ... disable row level security;` 로 즉시 해제.
-- ============================================================================
