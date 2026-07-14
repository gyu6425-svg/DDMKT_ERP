-- 고객 ERP 성과 탭 — 고객이 '저장,발행 성과'(글 보고 히스토리)를 보려면 본인 업체 블로그의 보고를 읽을 수 있어야 함.
--   Supabase > SQL Editor 에서 1회 실행. (미실행 시 고객 성과 모달의 저장/발행 히스토리가 항상 빈 목록)
--
--   기존 blog_post_reports 정책 = 'bpr 내부 전체'(내부) + 'bpr 기자단 조회'(본인) 뿐 → 고객은 못 읽음.
--   blog_posts '고객 본인 읽기' 정책과 동일 패턴(blog_accounts.client_id = my_client_id()).

drop policy if exists "bpr 고객 본인 읽기" on public.blog_post_reports;
create policy "bpr 고객 본인 읽기" on public.blog_post_reports
  for select to authenticated
  using (exists (
    select 1 from public.blog_accounts ba
    where ba.id = blog_post_reports.blog_account_id
      and ba.client_id = public.my_client_id()));
