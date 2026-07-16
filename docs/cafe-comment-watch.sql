-- 카페 댓글 자동화 — 감시 카페 등록. 워처(watch_new_posts.py)가 이 목록의 카페를 크롤링해
--   새 글이 올라오면 cafe_comment_queue 에 댓글을 자동 예약한다. 내부 전용.
-- ⚠️ 이 블록은 docs/_RUN_ALL.sql 끝에도 동일하게 들어가야 함(운영자는 _RUN_ALL.sql 만 실행).

create table if not exists public.cafe_comment_watch (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    account text,                              -- 댓글 달 계정(멀티계정 대비; null=기본 계정)
    cafe_url text not null,                    -- 카페 홈 주소(예: https://cafe.naver.com/ddmkt2)
    club_id text,                              -- 카페 clubid(정규화 저장)
    region text not null default '',           -- 댓글 템플릿 {지역}
    keyword text not null default '',          -- 댓글 템플릿 {키워드}
    enabled boolean not null default true,     -- 감시 on/off
    last_seen_article_id bigint,               -- 마지막으로 본 최대 글번호(첫 실행=기준선, 이후 이보다 큰 글만 댓글)
    updated_at timestamptz
);
create index if not exists ccw_enabled_idx on public.cafe_comment_watch (enabled);
alter table public.cafe_comment_watch enable row level security;

drop policy if exists "ccw 내부 전체" on public.cafe_comment_watch;
create policy "ccw 내부 전체" on public.cafe_comment_watch
    for all to authenticated
    using (public.is_internal()) with check (public.is_internal());
