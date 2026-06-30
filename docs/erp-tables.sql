-- ERP 이식용 테이블 (고객 DB / 영업자 / 계약 상세)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

-- ── 고객 DB ──────────────────────────────────────────────
create table if not exists public.clients (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    manager text,
    source text,
    company text,
    contact text,
    phone text,
    email text,
    product text,
    budget text,
    amount numeric default 0,
    next_contact date,
    contract_start date,
    contract_end date,
    status text default '신규문의',
    notes text,
    history jsonb default '[]'::jsonb,
    business_number text,
    invoice_email text,
    address text,
    industry text,
    url text
);
-- 기존 DB 마이그레이션(이미 clients 가 있으면): URL 칸 추가
alter table public.clients add column if not exists url text;
create index if not exists clients_created_at_idx on public.clients (created_at desc);
create index if not exists clients_manager_idx on public.clients (manager);
create index if not exists clients_status_idx on public.clients (status);

-- ※ 영업자 명단은 기존 sales_people 테이블을 재사용하므로 새로 만들지 않습니다.
--   (역할/인증 테이블 profiles, sales_people 은 그대로 유지)

-- ── 계약 상세(고객 1:1) ──────────────────────────────────
create table if not exists public.contract_data (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    billing_day int,
    billing_amount numeric default 0,
    billing_records jsonb default '[]'::jsonb,
    monthly_work jsonb default '{}'::jsonb,
    schedule jsonb default '[]'::jsonb,
    outsource_cost numeric default 0,
    pay_method text default 'cash',
    vat_included boolean default false,
    contract_type text default '신규',
    manual_revenue numeric default 0,
    manual_outsource numeric default 0,
    contract_products jsonb default '[]'::jsonb,
    updated_at timestamptz default now(),
    unique (client_id)
);

-- ── RLS (로그인 사용자 접근 허용, 역할별 제한은 앱에서 처리) ──
alter table public.clients enable row level security;
alter table public.contract_data enable row level security;

drop policy if exists "clients all" on public.clients;
create policy "clients all" on public.clients for all to anon, authenticated using (true) with check (true);

drop policy if exists "contract_data all" on public.contract_data;
create policy "contract_data all" on public.contract_data for all to anon, authenticated using (true) with check (true);
