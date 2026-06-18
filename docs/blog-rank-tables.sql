-- 블로그 순위 관리(저스트 블로그 이식)용 테이블
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

-- ── 관리 블로그(업체) ────────────────────────────────────
create table if not exists public.blog_accounts (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    name text not null,                 -- 업체명
    manager text,                       -- 담당
    blog_url text not null,             -- 네이버 블로그 URL
    blog_id text,                       -- URL에서 추출한 아이디(예: puleenbe)
    goal_count int,                     -- 계약 건수
    remain_count int,                   -- 잔여 건수
    weekly text,                        -- 주 발행(예: 주 5회)
    note text,                          -- 비고
    is_active boolean not null default true,
    client_id uuid references public.clients(id) on delete set null, -- (선택) 고객 연결
    unique (blog_url)
);
create index if not exists blog_accounts_manager_idx on public.blog_accounts (manager);
create index if not exists blog_accounts_active_idx on public.blog_accounts (is_active);

-- ── 추적 글(+ 일별 순위 측정값) ─────────────────────────
create table if not exists public.blog_posts (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    blog_account_id uuid not null references public.blog_accounts(id) on delete cascade,
    post_url text,                      -- 실제 글 URL(크롤러가 글 식별)
    title text,
    keyword text,                       -- 제목에서 추출한 핵심 키워드
    published_date date,
    first_seen_at timestamptz default now(),
    -- 측정 누적: [{ "date":"2026-06-11", "ti":통합검색순위, "bl":블로그탭순위 }, ...]
    measurements jsonb not null default '[]'::jsonb,
    unique (blog_account_id, post_url)
);
create index if not exists blog_posts_account_idx on public.blog_posts (blog_account_id);
create index if not exists blog_posts_published_idx on public.blog_posts (published_date desc);

-- ── RLS (로그인 사용자만) ───────────────────────────────
alter table public.blog_accounts enable row level security;
alter table public.blog_posts enable row level security;

drop policy if exists "blog_accounts auth" on public.blog_accounts;
create policy "blog_accounts auth" on public.blog_accounts
    for all to authenticated using (true) with check (true);

drop policy if exists "blog_posts auth" on public.blog_posts;
create policy "blog_posts auth" on public.blog_posts
    for all to authenticated using (true) with check (true);
