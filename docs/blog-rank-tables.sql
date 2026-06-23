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

-- ── 웹사이트 순위 추적(통합검색 '웹사이트' 섹션, 회사 단위) ───────────────
-- 통합/블로그탭(ti/bl)은 글 단위(blog_posts)지만, 웹사이트(we)는 "회사 홈페이지 +
-- 대표키워드 1개" 지표라 account 단위로 둔다. 없는 업체는 NULL = "해당없음".
-- 기존 테이블에도 적용되도록 add column if not exists 로 작성(idempotent).
alter table public.blog_accounts add column if not exists website_url text;   -- 회사 홈페이지 '호스트만' 저장(예: momo-cleaning.com). blog_url(풀 URL)과 표기 다름. UNIQUE 두지 않음(대행사 특성상 공유 가능).
alter table public.blog_accounts add column if not exists rep_keyword text;    -- 웹사이트 순위 측정에 쓸 대표키워드 1개
alter table public.blog_accounts add column if not exists contact text;        -- 연락처
alter table public.blog_accounts add column if not exists contract_date text;  -- 계약일자
alter table public.blog_accounts add column if not exists reporter text;       -- 기자단
alter table public.blog_accounts add column if not exists amount text;         -- 금액
alter table public.blog_accounts add column if not exists login_id text;       -- 아이디(별도 '계정 보기'에서만 노출)
alter table public.blog_accounts add column if not exists login_pw text;       -- 비밀번호(별도 '계정 보기'에서만 노출)
alter table public.blog_accounts add column if not exists manage_sheet_url text; -- 발행 관리시트
-- 시계열 요소 = { "date":"YYYY-MM-DD", "we":순위, "status":"ok|out|fail|skip" }
--   ok=노출/측정성공, out=권외(MAX_RANK_SCAN 초과), fail=API/네트워크 실패, skip=url/키워드 미설정
alter table public.blog_accounts add column if not exists website_measurements jsonb not null default '[]'::jsonb;

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
-- 자동키워드 수동 수정값. 있으면 측정·표시에 이걸 우선 사용하고, 크롤은 이 컬럼을 건드리지 않아 계속 유지된다.
alter table public.blog_posts add column if not exists keyword_manual text;

-- ── 블로그 대표키워드 추적 (사용자가 직접 지정, 블로그당 복수) ───────────
-- 글 단위(blog_posts) 추적과 별개로, "이 블로그가 OO키워드로 통합탭/블로그탭 몇 위인지"를
-- 사용자가 고른 키워드로 추적한다. 측정은 크롤러가 measure_rank(키워드, blog_id) 로 수행.
create table if not exists public.blog_keywords (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    blog_account_id uuid not null references public.blog_accounts(id) on delete cascade,
    keyword text not null,
    -- 측정 누적: [{ "date":"YYYY-MM-DD", "ti":통합탭(인기글), "bl":블로그탭, "ti_status":..., "bl_status":... }]
    -- measurements 는 크롤러(service_role)만 기록한다. 프론트는 keyword 행 insert/delete 만.
    measurements jsonb not null default '[]'::jsonb,
    unique (blog_account_id, keyword)
);
create index if not exists blog_keywords_account_idx on public.blog_keywords (blog_account_id);

-- ── RLS (로그인 사용자만) ───────────────────────────────
alter table public.blog_accounts enable row level security;
alter table public.blog_posts enable row level security;
alter table public.blog_keywords enable row level security;

drop policy if exists "blog_accounts auth" on public.blog_accounts;
create policy "blog_accounts auth" on public.blog_accounts
    for all to authenticated using (true) with check (true);

drop policy if exists "blog_posts auth" on public.blog_posts;
create policy "blog_posts auth" on public.blog_posts
    for all to authenticated using (true) with check (true);

drop policy if exists "blog_keywords auth" on public.blog_keywords;
create policy "blog_keywords auth" on public.blog_keywords
    for all to authenticated using (true) with check (true);
