-- 브랜드 블로그 자료 전달 — 우리가 각 블로그(회차)에 전달하는 자료를 등록 → 기자단 ERP에서 받아 글 작성.
--   자료 1건 = 업체명 + 대표키워드(1) + 서브키워드(≤3) + 카테고리(정보성/사례성) + 사진 1~9장.
--   사진 = Supabase Storage(private 버킷 'blog-materials'), 메타·사진목록 = 이 테이블.
--   용량 전략: 클라우드엔 블로그당 최신 5건만 유지, 초과분은 로컬 데몬이 PC로 아카이브(무료 티어 유지).
-- 전제: reporter-erp-rls.sql (is_reporter/my_profile_id/is_internal 강화판) 이미 적용.

-- ── 테이블 ──────────────────────────────────────────────
create table if not exists public.blog_materials (
    id uuid primary key default gen_random_uuid(),
    blog_account_id uuid not null references public.blog_accounts(id) on delete cascade,
    round integer,                              -- 회차(선택). null=공통 자료
    category text not null default '정보성',    -- 정보성 | 사례성
    company_name text,                          -- 업체명(표시용)
    main_keyword text,                          -- 대표키워드 1개
    sub_keywords text[] not null default '{}',  -- 서브키워드 최대 3개
    photos jsonb not null default '[]',         -- [{path,name,size}] 1~9장 (path=Storage 경로)
    uploaded_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now()
);
create index if not exists bm_blog_idx on public.blog_materials (blog_account_id, created_at desc);
alter table public.blog_materials enable row level security;

-- 내부: 전체(조회·등록·수정·삭제)
drop policy if exists "bm 내부 전체" on public.blog_materials;
create policy "bm 내부 전체" on public.blog_materials
    for all to authenticated
    using (public.is_internal()) with check (public.is_internal());

-- 기자단: 본인 담당 블로그의 자료만 조회(읽기 전용)
drop policy if exists "bm 기자단 조회" on public.blog_materials;
create policy "bm 기자단 조회" on public.blog_materials
    for select to authenticated
    using (
        public.is_reporter() and exists (
            select 1 from public.blog_accounts a
            where a.id = blog_materials.blog_account_id
              and a.reporter_id = public.my_profile_id()
        )
    );

-- ── Storage 버킷 (private) ──────────────────────────────
insert into storage.buckets (id, name, public)
values ('blog-materials', 'blog-materials', false)
on conflict (id) do nothing;

-- 내부: blog-materials 버킷 전체(업로드·삭제·조회)
drop policy if exists "storage bm 내부" on storage.objects;
create policy "storage bm 내부" on storage.objects
    for all to authenticated
    using (bucket_id = 'blog-materials' and public.is_internal())
    with check (bucket_id = 'blog-materials' and public.is_internal());

-- 기자단: SELECT만 + 경로 첫 폴더(=blog_account_id)가 본인 담당 블로그인 객체만.
--   경로 규칙: {blog_account_id}/{material_id}/{파일}. 첫 세그먼트 UUID 가드(캐스트 예외 방지).
drop policy if exists "storage bm 기자단 조회" on storage.objects;
create policy "storage bm 기자단 조회" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'blog-materials'
        and public.is_reporter()
        and name ~ '^[0-9a-fA-F-]{36}/'
        and exists (
            select 1 from public.blog_accounts a
            where a.id = ((storage.foldername(name))[1])::uuid
              and a.reporter_id = public.my_profile_id()
        )
    );

-- 검증 순서(대시보드): (1)내부 로그인 → 업로드/조회 OK, (2)고객(viewer) → 0행, (3)기자단 → 본인 블로그만.
