-- 카페 순위 재검색(즉시 측정) 큐 — 블로그 measure_requests 와 동일 구조.
-- 웹의 '재검색' 버튼(브라우저)은 네이버를 PC IP로 못 재므로, 요청을 여기 쌓고
-- PC 리스너(crawler/run_listener.py)가 폴링해 measure_cafe_rank 로 측정한 뒤 결과를 채운다.
create table if not exists public.cafe_measure_requests (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    keyword text not null,
    cafe_name text,
    article_id text not null,
    club_id text,
    status text not null default 'pending',     -- pending | processing | done | fail
    ti int, ti_status text,                      -- 인기글 테마 섹션 내 순위 / ok·out·no_section·fail
    done_at timestamptz
);
alter table public.cafe_measure_requests enable row level security;
drop policy if exists "cmr insert" on public.cafe_measure_requests;
drop policy if exists "cmr select" on public.cafe_measure_requests;
create policy "cmr insert" on public.cafe_measure_requests for insert to authenticated with check (true);
create policy "cmr select" on public.cafe_measure_requests for select to authenticated using (true);
