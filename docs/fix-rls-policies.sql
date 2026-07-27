-- ============================================================================
-- RLS 정책 교정 — 남아있던 '전원 허용' 잔여 정책 때문에 고객(viewer)이 전체 clients를 봄.
--   각 테이블의 기존 정책을 전부 삭제하고, 내부 전체 + 고객 본인만 정책을 재생성.
--   Supabase SQL Editor에서 실행. (함수 is_internal/my_client_id 는 이미 생성돼 있음)
--   ✅ 재실행 안전: 아래 do-블록이 대상 테이블의 '모든' 정책을 지운 뒤 재생성 → 몇 번 돌려도 됨.
--   ⚠️ begin/commit 로 감쌌다 — do-블록(전체 drop) 뒤 create 가 중간에 실패해도 통째 롤백되어
--      'RLS 켜짐·정책 0개(전체 차단)' 반쪽 상태를 안 남긴다. ❌ do-블록만 따로 실행 금지(그게 락아웃 원인).
-- ============================================================================

begin;

do $$
declare p record;
begin
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('clients','client_contracts','contract_data','blog_accounts','blog_posts','blog_keywords')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- clients ─────────────────────────────────────────────────────────────────
create policy "clients 내부 전체" on public.clients
  for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy "clients 고객 본인 읽기" on public.clients
  for select to authenticated using (id = public.my_client_id());

-- client_contracts ────────────────────────────────────────────────────────
create policy "client_contracts 내부 전체" on public.client_contracts
  for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy "client_contracts 고객 본인 읽기" on public.client_contracts
  for select to authenticated using (client_id = public.my_client_id());

-- contract_data ───────────────────────────────────────────────────────────
create policy "contract_data 내부 전체" on public.contract_data
  for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy "contract_data 고객 본인 읽기" on public.contract_data
  for select to authenticated using (client_id = public.my_client_id());

-- blog_accounts ───────────────────────────────────────────────────────────
create policy "blog_accounts 내부 전체" on public.blog_accounts
  for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy "blog_accounts 고객 본인 읽기" on public.blog_accounts
  for select to authenticated using (client_id = public.my_client_id());

-- blog_posts ──────────────────────────────────────────────────────────────
create policy "blog_posts 내부 전체" on public.blog_posts
  for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy "blog_posts 고객 본인 읽기" on public.blog_posts
  for select to authenticated using (exists (
    select 1 from public.blog_accounts ba
    where ba.id = blog_posts.blog_account_id and ba.client_id = public.my_client_id()));

-- blog_keywords ───────────────────────────────────────────────────────────
create policy "blog_keywords 내부 전체" on public.blog_keywords
  for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy "blog_keywords 고객 본인 읽기" on public.blog_keywords
  for select to authenticated using (exists (
    select 1 from public.blog_accounts ba
    where ba.id = blog_keywords.blog_account_id and ba.client_id = public.my_client_id()));

commit;   -- 전부 통과해야 반영. 중간 에러 시 begin 이후 롤백(반쪽 RLS 상태 방지).
