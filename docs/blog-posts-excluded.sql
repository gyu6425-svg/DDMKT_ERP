-- 순위 트래커 '글 삭제'(소프트) — blog_posts.excluded 컬럼
--   우리 기자단이 안 쓴 글(다른 업체·블로그 주인이 쓴 글)을 추적에서 제외.
--   Supabase 대시보드 > SQL Editor 에서 1회 실행. (실행 전엔 삭제 버튼이 오류남 — 먼저 실행 필수)
--
--   동작: excluded=true 인 글은 (1) 순위 트래커에서 숨김 (2) 크롤러가 측정 안 함
--         (3) RSS 재수집 시 on_conflict upsert 라 행은 갱신되지만 excluded 값은 유지 → 재크롤 안 됨.

alter table public.blog_posts add column if not exists excluded boolean not null default false;
create index if not exists blog_posts_excluded_idx on public.blog_posts (excluded);
