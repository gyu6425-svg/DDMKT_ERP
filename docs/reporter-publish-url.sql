-- =====================================================================
-- 발행 전환 시 실제 글 주소 저장 — mark_report_published RPC에 p_post_url 추가
-- 배경: 저장(초안) 보고는 링크를 받지 않는다(발행 전이라 실제 글 주소가 없음 → 대문 주소가 들어가면
--       순위 트래커가 최신글로 오배정됨). 기자단이 '발행' 버튼을 누를 때 개별 글 주소를 받아 저장한다.
--       그 뒤 크롤러가 공개된 글을 잡아 순위를 추적한다.
-- RLS: 기자단은 승인(confirmed)된 본인 보고를 직접 UPDATE 못 하므로 SECURITY DEFINER 로 처리.
-- 실행: Supabase SQL Editor. (구 1-인자 함수 → 2-인자로 교체)
-- =====================================================================

drop function if exists public.mark_report_published(uuid);

create or replace function public.mark_report_published(p_report_id uuid, p_post_url text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.blog_post_reports
     set report_type = 'publish',
         published_at = now(),
         -- 넘어온 글 주소가 있으면 저장(공백/미지정이면 기존 값 유지)
         post_url = coalesce(nullif(btrim(p_post_url), ''), post_url)
   where id = p_report_id
     and reporter_id = public.my_profile_id()  -- 본인 보고만
     and status <> 'rejected';                 -- 반려 건은 재보고로 처리
end;
$$;

grant execute on function public.mark_report_published(uuid, text) to authenticated;

notify pgrst, 'reload schema';
