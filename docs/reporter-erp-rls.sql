-- =====================================================================
-- 기자단 전용 ERP 보안 토대 (Reporter Portal scoping) — Supabase SQL Editor에서 실행
-- 목적: 기자단(개인)이 '본인이 담당하는 블로그'만 읽도록 격리.
--       내부 직원/관리자는 기존과 동일(전체 접근). 고객(viewer) 정책도 그대로.
--
-- 모델(확정): 블로그 : 기자단 = N : 1
--   · 기자단 1명이 여러 블로그 담당(한 블로그의 담당 기자단은 정확히 1명).
--   · 그래서 조인 테이블 없이 blog_accounts.reporter_id 단일 컬럼이면 충분.
--   · 발급/배정은 '블로그 통합 관리 시트'(SheetTab)에서(고객=계약 관리, 기자단=블로그 시트).
--
-- ⚠️ 실행 순서대로. Section B(정책)는 customer-portal-rls.sql 을 이미 적용한 전제.
--    적용 후 (1) 내부 계정, (2) 고객 계정, (3) 기자단 계정 순으로 데이터 노출을 검증할 것.
-- =====================================================================


-- ========== Section A: 추가만(안전) — 지금 적용 가능 =====================

-- 1) 담당 기자단 컬럼 — 이 블로그를 담당하는 기자단(개인)의 profiles.id.
--    (기존 blog_accounts.reporter 텍스트는 표시/백필용으로 유지)
alter table public.blog_accounts
    add column if not exists reporter_id uuid references public.profiles(id) on delete set null;
create index if not exists blog_accounts_reporter_idx on public.blog_accounts (reporter_id);

-- 2) 로그인한 사용자의 profiles.id (기자단 스코프 기준값).
create or replace function public.my_profile_id()
returns uuid language sql security definer set search_path = public as $$
    select id from public.profiles where user_id = auth.uid() limit 1;
$$;

-- 3) 기자단 여부(역할 = reporter).
create or replace function public.is_reporter()
returns boolean language sql security definer set search_path = public as $$
    select exists (
        select 1 from public.profiles
        where user_id = auth.uid() and lower(coalesce(role,'')) = 'reporter'
    );
$$;


-- ========== Section B: is_internal 강화 — 기자단/고객을 '내부'에서 제외 =====
-- 기존 is_internal 은 'customer_companies 매핑 없는 인증유저 = 내부'라,
--   신규 reporter(및 profiles.client_id 로만 매핑한 고객)가 내부로 오인되어
--   'write 내부' 정책으로 전체 쓰기 권한이 샐 수 있음 → 역할로 명시 차단.
-- ⚠️ 적용 후 내부 계정(admin/manager/sales)으로 블로그/고객 데이터 편집이 되는지 확인.
create or replace function public.is_internal()
returns boolean language sql security definer set search_path = public as $$
    select not exists (select 1 from public.customer_companies where user_id = auth.uid())
       and not exists (
           select 1 from public.profiles
           where user_id = auth.uid()
             and lower(coalesce(role,'')) in ('reporter','viewer','고객')
       );
$$;


-- ========== Section C: 기자단 read 정책 — 본인 담당 블로그만 =============
-- write 는 is_internal()(내부)만 가능(위에서 reporter 제외됨) → 기자단은 읽기 전용.

-- blog_accounts: 담당(reporter_id = 내 profiles.id) 만 조회
drop policy if exists "blog_accounts read 기자단" on public.blog_accounts;
create policy "blog_accounts read 기자단" on public.blog_accounts
    for select to authenticated
    using (public.is_reporter() and reporter_id = public.my_profile_id());

-- blog_posts: 글 → 계정 → 담당 기자단
drop policy if exists "blog_posts read 기자단" on public.blog_posts;
create policy "blog_posts read 기자단" on public.blog_posts
    for select to authenticated
    using (
        public.is_reporter() and exists (
            select 1 from public.blog_accounts a
            where a.id = blog_posts.blog_account_id
              and a.reporter_id = public.my_profile_id()
        )
    );

-- blog_keywords: 대표키워드 → 계정 → 담당 기자단
drop policy if exists "blog_keywords read 기자단" on public.blog_keywords;
create policy "blog_keywords read 기자단" on public.blog_keywords
    for select to authenticated
    using (
        public.is_reporter() and exists (
            select 1 from public.blog_accounts a
            where a.id = blog_keywords.blog_account_id
              and a.reporter_id = public.my_profile_id()
        )
    );


-- ========== 배정(관리자 1회, 예시) ======================================
--   실제 배정은 앱의 '블로그 통합 관리 시트'에서 드롭다운으로 처리(Phase 2).
--   수동 예시:
--   update public.blog_accounts set reporter_id = '<기자단 profiles.id>' where id = '<blog_accounts.id>';
