-- 배너 생성기 '작업 기록' 테이블
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.banner_outputs (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    operator_name text,          -- 만든 사람(작업자)
    category text,               -- 카테고리 id ('' = 미지정)
    category_label text,         -- 한글 라벨
    banner_size text,            -- square / bottom
    thumb_data_url text,         -- 갤러리용 작은 미리보기(JPEG data URL)
    image_data_url text          -- 원본(다운로드용 PNG data URL)
);

create index if not exists banner_outputs_created_at_idx on public.banner_outputs (created_at desc);
create index if not exists banner_outputs_category_idx on public.banner_outputs (category);
create index if not exists banner_outputs_operator_idx on public.banner_outputs (operator_name);

-- RLS: 공유 워크스페이스(앱 레벨 게이팅). 로그인/비로그인 모두 insert/select/delete 허용.
alter table public.banner_outputs enable row level security;

drop policy if exists "banner_outputs all" on public.banner_outputs;
create policy "banner_outputs all"
    on public.banner_outputs
    for all
    to anon, authenticated
    using (true)
    with check (true);
