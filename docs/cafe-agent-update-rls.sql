-- 카페 발행 에이전트(고객 viewer 계정)가 자기 company 큐 job 을 claim·상태변경 하도록 UPDATE 허용.
--   기존 cafe-customer-publish-rls.sql 은 고객 INSERT/SELECT 만 열고 UPDATE 는 내부 전용이었음
--   (에이전트=내부 JWT 전제). 이제 에이전트가 고객 계정으로 돌므로 UPDATE 정책 추가.
--   위조 차단: 자기 publish_enabled company 의 job 만, board 는 그 company 의 board 로 고정.
--   Supabase > SQL Editor 1회 실행. (전제: my_publish_companies()/cafe_board_for() 이미 배포)

drop policy if exists "cpq 고객 발행 update" on public.cafe_publish_queue;
create policy "cpq 고객 발행 update" on public.cafe_publish_queue
  for update to authenticated
  using (company in (select public.my_publish_companies()))
  with check (
    company in (select public.my_publish_companies())
    and board = public.cafe_board_for(company)
  );
