-- =====================================================================
-- 기자단 대기(pending) 보고 수정 — 검토 중인 본인 보고를 상태 유지한 채 수정
-- 배경: 기존 RLS는 '반려(rejected)→대기' 재보고만 허용했다. 기자단 ERP '내 보고 내역'에서
--       검토 중인 보고를 '수정'할 수 있게, 대기 보고의 UPDATE를 허용한다.
--       상태는 그대로 pending 으로 강제(with check) → self-승인 불가. 본인 담당 블로그만.
-- 실행: Supabase SQL Editor.
-- =====================================================================

drop policy if exists "bpr 기자단 대기수정" on public.blog_post_reports;
create policy "bpr 기자단 대기수정" on public.blog_post_reports
    for update to authenticated
    using (public.is_reporter() and reporter_id = public.my_profile_id() and status = 'pending')
    with check (
        public.is_reporter()
        and reporter_id = public.my_profile_id()
        and status = 'pending'
        and exists (
            select 1 from public.blog_accounts a
            where a.id = blog_account_id and a.reporter_id = public.my_profile_id()
        )
    );

notify pgrst, 'reload schema';
