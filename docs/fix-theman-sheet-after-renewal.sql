-- 더맨시스템 — 이미 끝낸 재계약(100건)을 카페 관리시트에 반영 (2026-08-12)
--
-- 왜 화면이 그대로였나: 카페 관리시트 행(목표·계약일·진행률)은 client_contracts 가 아니라
--   **cafe_accounts 의 계약 필드**(goal_count·done_count·amount·contract_date)를 읽는다.
--   재계약은 client_contracts 만 새로 만들어서 시트는 옛 값(50건·2026-07-10·done 15)에 머물렀다.
--   진행률 '54/50건 (+39)' = 베이스라인 15 + 자동달성 39.
--
-- 코드는 고쳐서 다음 재계약부터는 자동 반영된다. 이 SQL 은 이미 해 버린 이번 건만 맞춘다.
-- 실행: Supabase > SQL Editor. 재실행해도 안전.

-- 0) 실행 전 확인
select company_key, board_short, goal_count, done_count, amount, contract_date
  from public.cafe_accounts
 where client_id = 'deb9d873-34f8-4a54-a207-58480ff18c02';

-- 1) 관리시트 계약 필드를 새 계약(100건 · 2026-08-12)으로
update public.cafe_accounts
   set goal_count = 100,
       done_count = 0,              -- 이전 계약 베이스라인 15 초기화
       amount = 1500000,
       contract_date = '2026-08-12'
 where client_id = 'deb9d873-34f8-4a54-a207-58480ff18c02'
   and goal_count is not null;      -- 계약 필드를 갖고 있는 행(theman)만

-- 2) 이전 계약에서 달성(5위 24h)한 39글을 '기준선'으로 이월 → 새 계약 진행률 0부터
--    (기준선 글은 관리시트·대시보드·계약 sync 의 자동 카운트에서 빠진다. 글 자체는 그대로 추적됨)
update public.cafe_rank_posts
   set top5_seeded = true
 where board in ('더맨시스템', '더맨자체')
   and top5_achieved_at is not null
   and coalesce(top5_seeded, false) = false;

-- 3) 확인 — 목표 100 · done 0 · 계약일 2026-08-12 / 기준선 39글
select company_key, board_short, goal_count, done_count, amount, contract_date
  from public.cafe_accounts
 where client_id = 'deb9d873-34f8-4a54-a207-58480ff18c02';
select count(*) filter (where top5_seeded) as 기준선,
       count(*) filter (where top5_achieved_at is not null and not coalesce(top5_seeded,false)) as 새계약달성
  from public.cafe_rank_posts
 where board in ('더맨시스템', '더맨자체');
