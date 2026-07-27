-- 카페 인기글 '5위 24시간 유지' 실적 자동 집계용 글별 상태.
--   top5_since: 연속으로 ≤5위에 진입한 시각(≤5 아니면 null).
--   top5_achieved_at: 관측하에 24시간 유지를 처음 만족한 시각(한 번 set되면 유지=실적).
--   top5_seeded: 수동 베이스라인(done_count)에 이미 포함된 글 → 자동 카운트에서 제외(중복 방지).
-- 실적(표시) = cafe_accounts.done_count(수동 베이스라인) + (top5_achieved_at 있고 top5_seeded=false 인 글 수).
--   ※ 트래커는 done_count 를 절대 건드리지 않는다(UI 수동편집과 충돌 방지).
alter table public.cafe_rank_posts add column if not exists top5_since timestamptz;
alter table public.cafe_rank_posts add column if not exists top5_achieved_at timestamptz;
alter table public.cafe_rank_posts add column if not exists top5_seeded boolean not null default false;
