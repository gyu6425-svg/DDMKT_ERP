-- 기자단 글 보고 — 회차(n회차) 컬럼 추가.
--   Supabase > SQL Editor 에서 1회 실행. (미실행 시 회차 저장이 400)
--   기자단이 글 보고 시 블로그·제목 사이에 '회차'를 입력 → 저장/발행 이력·성과에 표시.

alter table public.blog_post_reports add column if not exists round int; -- 회차(n회차)
