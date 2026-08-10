-- ============================================================================
-- 카페 배포 '접수' — 고객 셀프 접수 큐 (고객ERP '카페 배포' 탭)
--   고객이 로그인 후 접수 폼 작성 → 내부가 검토·세팅. 금액/정산은 계약관리에서 별도(여기 없음).
--   cafe_publish_requests(승인요청) 와 동일한 고객 스코프 패턴.
-- ⚠️ 공유 DB — main 에서 검토 후 1회 실행. 재실행 안전(begin/commit + drop→create 한 묶음).
--    ❌ 정책 DROP 만 따로 돌리지 말 것(RLS-on·정책0 = 전체차단 락아웃).
-- 전제: enable-login-rls.sql(is_internal/my_client_id) 적용됨.
-- ============================================================================
begin;

create table if not exists public.cafe_deploy_requests (
    id             uuid primary key default gen_random_uuid(),
    created_at     timestamptz not null default now(),   -- 작성일
    client_id      uuid,                                   -- 접수 고객(profiles.client_id)
    company_name   text not null,                          -- 업체명
    url            text,                                   -- 플레이스 URL 또는 홈페이지
    keyword        text,                                   -- 키워드(업종)
    mission_start  date,                                   -- 미션 시작일 (종료일은 건수계약이라 없음)
    daily_count    int,                                    -- 일 발행건수
    total_count    int,                                    -- 총 발행건수
    photo_provided text,                                   -- 사진 전달(제공/미제공/일부)
    product_type   text,                                   -- 상품종류(카페 배포/맘카페 등)
    note           text,                                   -- 비고
    status         text not null default '접수'            -- 접수 → 세팅중 → 완료 (담당자 갱신)
    -- 금액/금액(부가세)/정산유무 는 계약관리에서 별도 등록 → 여기 컬럼 없음.
);

alter table public.cafe_deploy_requests enable row level security;

drop policy if exists "cdr 고객 insert" on public.cafe_deploy_requests;
drop policy if exists "cdr 고객 select" on public.cafe_deploy_requests;
drop policy if exists "cdr 내부 전체"  on public.cafe_deploy_requests;

-- 고객: 본인 client_id 로만 접수 등록 + 본인 접수만 조회.
create policy "cdr 고객 insert" on public.cafe_deploy_requests
    for insert to authenticated with check (client_id = public.my_client_id());
create policy "cdr 고객 select" on public.cafe_deploy_requests
    for select to authenticated using (client_id = public.my_client_id());
-- 내부(관리자/담당자): 전체 조회·상태 변경.
create policy "cdr 내부 전체" on public.cafe_deploy_requests
    for all to authenticated using (public.is_internal()) with check (public.is_internal());

create index if not exists idx_cdr_client_created
    on public.cafe_deploy_requests (client_id, created_at desc);

commit;

-- 롤백:
-- begin;
--   drop policy if exists "cdr 고객 insert" on public.cafe_deploy_requests;
--   drop policy if exists "cdr 고객 select" on public.cafe_deploy_requests;
--   drop policy if exists "cdr 내부 전체"  on public.cafe_deploy_requests;
--   drop table if exists public.cafe_deploy_requests;
-- commit;
