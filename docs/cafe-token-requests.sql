-- ============================================================================
-- 카페 발행 토큰 '충전 요청' — 고객이 입금 후 충전 요청 → 관리자가 확인·지급.
--   요청 자체는 토큰 아님(원장 cafe_tokens 와 별개). 관리자가 요청 보고 충전하면 원장에 +N.
-- ⚠️ main 에서 1회 실행. 재실행 안전.
-- 전제: enable-login-rls.sql(is_internal/my_client_id), cafe-tokens.sql.
-- ============================================================================
begin;

create table if not exists public.cafe_token_requests (
    id              uuid primary key default gen_random_uuid(),
    created_at      timestamptz not null default now(),
    client_id       uuid,
    requested_count int,                         -- 희망 충전 건수
    note            text,                        -- 입금자명·일자 등
    status          text not null default 'pending',  -- pending | done | rejected
    handled_at      timestamptz
);

alter table public.cafe_token_requests enable row level security;

drop policy if exists "ctr 고객 insert" on public.cafe_token_requests;
drop policy if exists "ctr 조회" on public.cafe_token_requests;
drop policy if exists "ctr 내부" on public.cafe_token_requests;

create policy "ctr 고객 insert" on public.cafe_token_requests
    for insert to authenticated with check (client_id = public.my_client_id());
create policy "ctr 조회" on public.cafe_token_requests
    for select to authenticated using (client_id = public.my_client_id() or public.is_internal());
create policy "ctr 내부" on public.cafe_token_requests
    for all to authenticated using (public.is_internal()) with check (public.is_internal());

create index if not exists idx_ctr_status on public.cafe_token_requests (status, created_at);

commit;
-- 롤백: begin; drop table if exists public.cafe_token_requests; commit;
