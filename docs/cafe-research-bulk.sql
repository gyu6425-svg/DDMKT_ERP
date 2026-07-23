-- 카페 '전체 재검색'(대량) 지원 — 리스너가 측정 결과를 글에 직접 반영할 수 있게 post_id 연결.
-- 브라우저를 닫아도 큐에 남은 요청을 PC 리스너가 계속 처리하고 순위까지 저장한다.
alter table public.cafe_measure_requests add column if not exists post_id uuid references public.cafe_rank_posts(id) on delete cascade;
create index if not exists cafe_measure_requests_status_idx on public.cafe_measure_requests(status, created_at);
