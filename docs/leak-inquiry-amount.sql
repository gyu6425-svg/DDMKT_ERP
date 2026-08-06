-- 누수탐지 문의(상담)에 금액(견적·예상) 칸 추가.
-- Supabase SQL Editor 에서 1회 실행. 멱등(있어도 에러 안 남).
alter table public.leak_inquiries
    add column if not exists amount bigint;

comment on column public.leak_inquiries.amount is '문의 단계 견적/예상 금액(원). 작업(leak_jobs.gross_amount)과 별개.';
