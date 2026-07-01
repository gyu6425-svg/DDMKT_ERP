-- 고객사 계약 내역 (카테고리/세부유형별 건수 계약) — Supabase SQL Editor에서 실행
-- 부모 6: 플레이스/인스타/카페/쇼핑/파워링크/블로그. 세부유형별 건수·금액.
create table if not exists public.client_contracts (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    created_at timestamptz not null default now(),
    category text not null,        -- 플레이스|인스타|카페|쇼핑|파워링크|블로그
    subtype text not null,         -- 영수증 리뷰|플레이스 리워드|...|준최적화 블로그 배포
    goal_count int,                -- 계약 건수
    remain_count int,              -- 잔여 건수(기본=건수)
    amount numeric default 0,      -- 금액
    contract_date date,
    note text,
    history jsonb not null default '[]'::jsonb  -- 재계약 시 기존 계약 스냅샷 보관
);
-- 기존 테이블 마이그레이션: 계약 이력 컬럼 추가
alter table public.client_contracts add column if not exists history jsonb not null default '[]'::jsonb;
-- 금액 상세: 단가·외주단가·외주비 (매출=amount=단가×수량, 순매출=매출-외주비)
alter table public.client_contracts add column if not exists unit_price numeric;
alter table public.client_contracts add column if not exists unit_outsource numeric;
alter table public.client_contracts add column if not exists outsource numeric;
-- 리워드(일 단위) 상품: 일일 타수 보존 + 주간 진행 로그(감사기록). 진실의 원천은 remain_count.
alter table public.client_contracts add column if not exists per_day int;
alter table public.client_contracts add column if not exists weekly_logs jsonb not null default '[]'::jsonb;
create index if not exists client_contracts_client_idx on public.client_contracts (client_id);
alter table public.client_contracts enable row level security;
drop policy if exists "client_contracts all authenticated" on public.client_contracts;
create policy "client_contracts all authenticated" on public.client_contracts
    for all to authenticated using (true) with check (true);
