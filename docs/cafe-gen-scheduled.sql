-- 예약 발행 — cafe_gen_requests 에 발행 예정 시각 추가.
-- Supabase SQL Editor 에서 1회 실행(멱등). 추가 즉시 예약 발행이 동작(sub2 소비 로직은 배포 완료).
-- ⚠️ 반드시 'timestamp'(WITHOUT time zone). sub2 는 KST 벽시계 숫자를 그대로 비교(타임존 변환 없음)하므로
--    timestamptz 로 만들면 UTC 변환돼 9시간 어긋난다.
alter table public.cafe_gen_requests
    add column if not exists scheduled_at timestamp;

comment on column public.cafe_gen_requests.scheduled_at is
    '예약 발행 — 이 시각(KST 벽시계) 이후에 발행. NULL=즉시 대상. sub2 poller 소비.';
