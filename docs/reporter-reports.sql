-- =====================================================================
-- 기자단 글 보고(blog_post_reports) — Supabase SQL Editor에서 실행
-- 흐름: 기자단이 본인 담당 블로그에 글 URL 보고(insert) → 내부(김다영 등) 알림 →
--       '확인' 시 blog_posts 추적글로 등록(내부가 처리) + 보고 status=confirmed.
-- 전제: reporter-erp-rls.sql (is_reporter/my_profile_id/reporter_id) 이미 적용.
-- =====================================================================

create table if not exists public.blog_post_reports (
    id uuid primary key default gen_random_uuid(),
    blog_account_id uuid not null references public.blog_accounts(id) on delete cascade,
    reporter_id uuid references public.profiles(id) on delete set null,
    post_url text not null,
    title text,
    keyword text,
    status text not null default 'pending', -- pending | confirmed | rejected
    note text,
    created_at timestamptz not null default now(),
    reviewed_at timestamptz,
    reviewed_by uuid references public.profiles(id) on delete set null,
    blog_post_id uuid references public.blog_posts(id) on delete set null -- 확인 시 생성된 추적글
);
create index if not exists bpr_blog_idx on public.blog_post_reports (blog_account_id);
create index if not exists bpr_reporter_idx on public.blog_post_reports (reporter_id);
create index if not exists bpr_status_idx on public.blog_post_reports (status);
alter table public.blog_post_reports enable row level security;

-- 내부(직원/관리자): 전체 관리(조회·확인·반려).
drop policy if exists "bpr 내부 전체" on public.blog_post_reports;
create policy "bpr 내부 전체" on public.blog_post_reports
    for all to authenticated
    using (public.is_internal()) with check (public.is_internal());

-- 기자단: 본인 보고만 조회.
drop policy if exists "bpr 기자단 조회" on public.blog_post_reports;
create policy "bpr 기자단 조회" on public.blog_post_reports
    for select to authenticated
    using (public.is_reporter() and reporter_id = public.my_profile_id());

-- 기자단: 본인(reporter_id=본인) + 본인 담당 블로그(reporter_id 일치)에만 보고 등록.
drop policy if exists "bpr 기자단 등록" on public.blog_post_reports;
create policy "bpr 기자단 등록" on public.blog_post_reports
    for insert to authenticated
    with check (
        public.is_reporter()
        and reporter_id = public.my_profile_id()
        and exists (
            select 1 from public.blog_accounts a
            where a.id = blog_account_id and a.reporter_id = public.my_profile_id()
        )
    );

-- 기자단 재보고: 본인의 '반려(rejected)' 보고만 → '검토중(pending)'으로 되돌리기.
--   with check 로 결과 status 를 pending 으로 강제 → 기자단이 자기 글을 confirmed 로 self-승인 못 함.
drop policy if exists "bpr 기자단 재보고" on public.blog_post_reports;
create policy "bpr 기자단 재보고" on public.blog_post_reports
    for update to authenticated
    using (public.is_reporter() and reporter_id = public.my_profile_id() and status = 'rejected')
    with check (
        public.is_reporter()
        and reporter_id = public.my_profile_id()
        and status = 'pending'
        and exists (
            select 1 from public.blog_accounts a
            where a.id = blog_account_id and a.reporter_id = public.my_profile_id()
        )
    );
