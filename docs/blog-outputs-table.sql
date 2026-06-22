-- 블로그 작성기 '작업 기록' 테이블
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.blog_outputs (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    operator_name text,          -- 만든 사람(작업자)
    category text,               -- 카테고리 id ('' = 미지정)
    category_label text,         -- 한글 라벨
    title text,                  -- "제목: ..." 에서 파싱
    content text,                -- 생성된 본문 전체(텍스트라 가벼움)
    topic text,                  -- 입력한 주제/키워드
    tone text,
    length text
);

create index if not exists blog_outputs_created_at_idx on public.blog_outputs (created_at desc);
create index if not exists blog_outputs_category_idx on public.blog_outputs (category);
create index if not exists blog_outputs_operator_idx on public.blog_outputs (operator_name);

-- RLS: 공유 워크스페이스(앱 레벨 게이팅). 로그인/비로그인 모두 insert/select/delete 허용.
alter table public.blog_outputs enable row level security;

drop policy if exists "blog_outputs all" on public.blog_outputs;
create policy "blog_outputs all"
    on public.blog_outputs
    for all
    to anon, authenticated
    using (true)
    with check (true);
