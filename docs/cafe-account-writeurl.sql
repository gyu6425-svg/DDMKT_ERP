-- ============================================================================
-- 카페 계정 발행 세팅 — 글쓰기 주소(write_url) 저장 (모델 B: 우리가 대신 발행).
--   담당자가 접수 확인 후 write_url 입력 → agent.env 생성·발행에 사용.
-- ⚠️ 공유 DB — main 에서 1회 실행. 재실행 안전(add column if not exists).
-- 전제: cafe-accounts.sql.
-- ============================================================================
begin;
alter table public.cafe_accounts
  add column if not exists write_url text;   -- 글쓰기 주소(club_id·게시판 menu 포함)
commit;
-- 롤백: alter table public.cafe_accounts drop column if exists write_url;
