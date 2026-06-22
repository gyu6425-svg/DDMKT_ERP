-- API 사용량 기록 테이블
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.api_usage (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    user_email text,
    operator_name text,
    provider text not null,
    model text,
    banner_size text,
    status text not null default 'success',
    elapsed_ms integer,
    error_message text,
    total_tokens integer,
    cost_usd numeric,
    usage_raw jsonb,        -- OpenAI usage 원본(토큰 유형별 분해 + 정확 비용 재계산용)
    image_quality text      -- low/medium/high (이미지 장당 단가 산정용)
);

-- 기존에 테이블을 이미 만들었다면 아래 줄만 실행해 컬럼을 추가하세요.
alter table public.api_usage add column if not exists total_tokens integer;
alter table public.api_usage add column if not exists cost_usd numeric;
alter table public.api_usage add column if not exists operator_name text;
alter table public.api_usage add column if not exists usage_raw jsonb;
alter table public.api_usage add column if not exists image_quality text;

-- 기존에 부정확한 단가로 기록되던 옛 기록을 모두 지우고 새로 시작하려면 아래 한 줄 실행:
-- delete from public.api_usage;

create index if not exists api_usage_created_at_idx on public.api_usage (created_at desc);
create index if not exists api_usage_provider_idx on public.api_usage (provider);
create index if not exists api_usage_status_idx on public.api_usage (status);

-- RLS: 앱에서 관리자 페이지로만 노출하므로(앱 레벨 게이팅) 로그인 사용자에게 insert/select 허용.
alter table public.api_usage enable row level security;

drop policy if exists "api_usage insert" on public.api_usage;
create policy "api_usage insert"
    on public.api_usage
    for insert
    to anon, authenticated
    with check (true);

drop policy if exists "api_usage select" on public.api_usage;
create policy "api_usage select"
    on public.api_usage
    for select
    to anon, authenticated
    using (true);
