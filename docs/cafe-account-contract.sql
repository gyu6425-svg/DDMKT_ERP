-- 카페 업체(게시판)별 계약 정보 — 관리시트를 브랜드블로그 시트처럼 쓰기 위한 필드.
--   목표 발행 건수·완료·계약금액·계약일·담당. 진행률 = done/goal, 잔여 = goal - done.
alter table public.cafe_accounts add column if not exists goal_count int;      -- 계약 발행 목표 건수
alter table public.cafe_accounts add column if not exists done_count int not null default 0;  -- 발행 완료 건수
alter table public.cafe_accounts add column if not exists amount bigint;        -- 계약금액(원)
alter table public.cafe_accounts add column if not exists contract_date date;   -- 계약일
alter table public.cafe_accounts add column if not exists manager text;         -- 담당자
