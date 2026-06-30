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
    note text
);
create index if not exists client_contracts_client_idx on public.client_contracts (client_id);
alter table public.client_contracts enable row level security;
drop policy if exists "client_contracts all authenticated" on public.client_contracts;
create policy "client_contracts all authenticated" on public.client_contracts
    for all to authenticated using (true) with check (true);
