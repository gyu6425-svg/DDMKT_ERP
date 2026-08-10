-- ============================================================================
-- 카페 발행 토큰(건수) 원장 — 발행 1건 = 1토큰.
--   입금 확인 후 관리자가 건수로 충전(+N). 발행 시 소비(-1). 잔액 = delta 합계.
--   충전/사용 내역이 그대로 남아 고객 '충전내역'·관리자 '토큰 충전 내역'에 표시.
-- ⚠️ 공유 DB — main 에서 1회 실행. 재실행 안전(begin/commit + drop→create).
-- 전제: enable-login-rls.sql(is_internal/my_client_id).
-- ============================================================================
begin;

create table if not exists public.cafe_tokens (
    id         uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    client_id  uuid not null,
    delta      int  not null,                 -- +N 충전, -1 발행
    kind       text not null default '충전',  -- 충전 | 발행 | 조정
    note       text,
    created_by uuid                            -- 지급한 관리자(선택)
);

alter table public.cafe_tokens enable row level security;

drop policy if exists "ct 고객 조회" on public.cafe_tokens;
drop policy if exists "ct 고객 소비" on public.cafe_tokens;
drop policy if exists "ct 내부 전체" on public.cafe_tokens;

-- 고객: 본인 내역 조회.
create policy "ct 고객 조회" on public.cafe_tokens
    for select to authenticated using (client_id = public.my_client_id());
-- 고객: 본인 '발행 소비'(음수·kind=발행)만 기록 가능. 충전(양수)은 불가(관리자만).
create policy "ct 고객 소비" on public.cafe_tokens
    for insert to authenticated
    with check (client_id = public.my_client_id() and delta < 0 and kind = '발행');
-- 내부(관리자/담당자): 전체 조회 + 충전/조정.
create policy "ct 내부 전체" on public.cafe_tokens
    for all to authenticated using (public.is_internal()) with check (public.is_internal());

create index if not exists idx_ct_client on public.cafe_tokens (client_id, created_at desc);

commit;

-- 롤백:
-- begin; drop table if exists public.cafe_tokens; commit;
