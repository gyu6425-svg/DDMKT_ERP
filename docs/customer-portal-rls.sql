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

-- 내부 직원 여부 = '고객이 아님'(customer_companies 매핑이 없음).
--   ※ 2026-06-30 확인: public.users 테이블은 없고 권한 테이블은 public.profiles 임.
--     내부 계정은 모두 관리자가 생성(공개 회원가입 없음) 전제 → 매핑 없는 인증유저 = 내부.
--   (더 엄격히 하려면: exists(profiles where id=auth.uid()) 조건을 AND 로 추가.)
create or replace function public.is_internal()
returns boolean language sql security definer set search_path = public as $$
    select not exists (select 1 from public.customer_companies where user_id = auth.uid());
$$;

-- is_admin 정정: 기존 supabase-rls.sql 은 없는 public.users 를 참조 → profiles 기준으로 교체.
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and lower(coalesce(role,'')) in ('admin','관리자')
    );
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


-- =====================================================================
-- Section A2 (권장·단순형): 고객 1계정 = 1업체 — profiles.client_id 직접 매핑
--   프론트(BlogRankContext)가 이 컬럼으로 '본인 업체'만 로드한다(추가 쿼리 없음).
--   고객이 여러 업체를 봐야 하면 위의 customer_companies(다대다)를 쓰고,
--   대부분(1업체)은 아래 한 줄이면 충분하다.
-- =====================================================================

-- 1) 컬럼 추가(필수) — 이걸 실행해야 고객 계정이 본인 업체 데이터를 본다.
alter table public.profiles add column if not exists client_id uuid references public.clients(id) on delete set null;

-- 2) 각 고객 프로필에 담당 업체 연결(예시) — 관리자가 1회 지정.
--    update public.profiles set client_id = '<clients.id>' where email = '<고객 이메일>';

-- 3) (선택) 서버 강제: 블로그 계정/글 read 를 본인 업체로 제한하는 RLS.
--    내부 직원(client_id is null 인 profiles)은 영향 없음.
--    ※ 적용 전 내부 계정으로 데이터 보이는지 반드시 확인.
-- create policy "customer reads own accounts" on public.blog_accounts
--   for select to authenticated using (
--     client_id in (select p.client_id from public.profiles p where p.user_id = auth.uid())
--     or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.client_id is null)
--   );
