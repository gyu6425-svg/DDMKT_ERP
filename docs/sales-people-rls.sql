-- ============================================================================
-- 보안 수정(2026-07-09): sales_people(내부 영업사원)이 고객(viewer)·기자단(reporter)
--   계정에도 전체 노출되던 문제 — 이름·이메일·역할·커미션율이 외부에 읽혔음.
--   → 내부(is_internal) 사용자만 조회/수정 가능하도록 RLS 적용. Supabase SQL Editor에서 실행.
--   is_internal(): 활성 profile + client_id IS NULL = 내부 직원. (reporter-erp-rls.sql 등에서 사용중)
-- ============================================================================

alter table public.sales_people enable row level security;

-- 기존 광범위(전체 허용) 정책이 있으면 제거(이름 다양 → 자주 쓰는 이름들 시도, 없으면 무시).
drop policy if exists "sales_people all" on public.sales_people;
drop policy if exists "sales_people select" on public.sales_people;
drop policy if exists "Enable read access for all users" on public.sales_people;
drop policy if exists "Enable read access to all users" on public.sales_people;
drop policy if exists "Allow authenticated read" on public.sales_people;

-- 내부만 조회.
drop policy if exists "sales_people 내부 조회" on public.sales_people;
create policy "sales_people 내부 조회" on public.sales_people
    for select to authenticated
    using (public.is_internal());

-- 내부만 쓰기(사원 관리는 내부 관리자 UI에서). 외부는 완전 차단.
drop policy if exists "sales_people 내부 쓰기" on public.sales_people;
create policy "sales_people 내부 쓰기" on public.sales_people
    for all to authenticated
    using (public.is_internal())
    with check (public.is_internal());

-- 확인: 아래를 고객 토큰으로 실행하면 0행이어야 함.
--   select count(*) from public.sales_people;
