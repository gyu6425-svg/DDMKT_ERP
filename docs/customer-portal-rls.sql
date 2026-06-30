-- =====================================================================
-- 고객 전용 ERP 보안 토대 (Customer Portal scoping) — Supabase SQL Editor에서 실행
-- 목적: 외부 고객(업체/기자단)이 '본인 업체' 데이터만 읽도록 격리.
--       내부 직원/관리자는 기존과 동일(전체 접근) — 동작 변화 없음.
-- 모델: 고객 1명이 여러 업체 담당 가능(업체고객 1~3개, 기자단 다수) → 매핑 테이블.
--
-- ⚠️ Section A 는 '추가만' 이라 지금 적용해도 내부 앱에 영향 없음.
-- ⚠️ Section B 는 기존 'using(true)' 정책을 교체 → 적용 전에 반드시:
--    (1) 모든 내부 직원이 public.users 에 행이 있는지 확인(is_internal 기준).
--    (2) 적용 후 내부 계정으로 로그인해 블로그 대시보드 데이터가 보이는지 확인.
-- =====================================================================


-- ========== Section A: 안전(추가만) — 지금 적용 가능 =====================

-- 고객 ↔ 업체 매핑 (한 고객 ↔ 여러 업체)
create table if not exists public.customer_companies (
    user_id    uuid not null references auth.users(id) on delete cascade,
    client_id  uuid not null references public.clients(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, client_id)
);
create index if not exists customer_companies_user_idx on public.customer_companies (user_id);
create index if not exists customer_companies_client_idx on public.customer_companies (client_id);
alter table public.customer_companies enable row level security;

-- 내부 직원 여부: public.users(직원·관리자 테이블)에 살아있는 행이 있으면 내부.
--   고객(외부)은 users 에 없고 customer_companies 에만 있음 → 둘을 깔끔히 구분.
create or replace function public.is_internal()
returns boolean language sql security definer set search_path = public as $$
    select exists (select 1 from public.users where id = auth.uid() and deleted_at is null);
$$;

-- 현재 고객이 볼 수 있는 업체 id 목록 (내부 직원은 빈 목록이지만 is_internal 로 전체 접근).
create or replace function public.my_customer_client_ids()
returns setof uuid language sql security definer set search_path = public as $$
    select client_id from public.customer_companies where user_id = auth.uid();
$$;

-- 매핑 테이블 RLS: 관리자=전체 관리 / 고객=본인 매핑만 조회
create policy "cc 관리자 전체" on public.customer_companies
    for all using (public.is_admin()) with check (public.is_admin());
create policy "cc 본인 조회" on public.customer_companies
    for select using (user_id = auth.uid());

-- 고객이 '본인 업체(clients)' 와 그 계약을 읽도록 추가(기존 내부 정책은 그대로 → 내부 영향 없음)
create policy "clients 고객 본인업체 조회" on public.clients
    for select using (id in (select public.my_customer_client_ids()) and deleted_at is null);
create policy "contracts 고객 본인업체 조회" on public.contracts
    for select using (
        exists (
            select 1 from public.clients c
            where c.id = contracts.customer_id
              and c.id in (select public.my_customer_client_ids())
              and c.deleted_at is null
        )
    );


-- ========== Section B: 정책 강화 — 고객 오픈 직전 + 내부 테스트 후 적용 ======
-- 기존 'for all to authenticated using(true)'(전원 전체 접근)를
--   (내부=전체 / 고객=본인 업체만, 읽기 전용) 으로 교체.

-- blog_accounts ----------------------------------------------------------
drop policy if exists "blog_accounts auth" on public.blog_accounts;
create policy "blog_accounts write 내부" on public.blog_accounts
    for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy "blog_accounts read 고객" on public.blog_accounts
    for select to authenticated
    using (client_id in (select public.my_customer_client_ids()));

-- blog_posts (글 → 계정 → 업체) -----------------------------------------
drop policy if exists "blog_posts auth" on public.blog_posts;
create policy "blog_posts write 내부" on public.blog_posts
    for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy "blog_posts read 고객" on public.blog_posts
    for select to authenticated
    using (
        exists (
            select 1 from public.blog_accounts a
            where a.id = blog_posts.blog_account_id
              and a.client_id in (select public.my_customer_client_ids())
        )
    );

-- blog_keywords (대표키워드 → 계정 → 업체) -------------------------------
drop policy if exists "blog_keywords auth" on public.blog_keywords;
create policy "blog_keywords write 내부" on public.blog_keywords
    for all to authenticated using (public.is_internal()) with check (public.is_internal());
create policy "blog_keywords read 고객" on public.blog_keywords
    for select to authenticated
    using (
        exists (
            select 1 from public.blog_accounts a
            where a.id = blog_keywords.blog_account_id
              and a.client_id in (select public.my_customer_client_ids())
        )
    );

-- 미래 카테고리(영상/인스타/카페/트래픽) 계정 테이블도 동일 패턴으로 추가:
--   write = is_internal(), read = client_id in (my_customer_client_ids()).
