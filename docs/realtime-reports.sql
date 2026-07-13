-- 기자단 글 보고 실시간 알림 — Supabase Realtime 활성화
--   목적: 기자단이 '글 보고'(blog_post_reports insert)하는 즉시 김종인·김다영·송민경·장규진 화면 상단 배너에 반영.
--   Supabase 대시보드 > SQL Editor 에서 1회 실행.
--
--   ⚠️ 이 SQL을 실행하지 않아도 배너는 10초 폴링 + 탭 복귀 갱신으로 '누락 없이' 뜹니다(최대 ~10초 지연).
--      이 SQL을 실행하면 '누르자마자(즉시)' 뜹니다.

-- 1) blog_post_reports 를 realtime 발행 목록에 추가(이미 있으면 무시).
do $$
begin
  begin
    alter publication supabase_realtime add table public.blog_post_reports;
  exception when duplicate_object then
    -- 이미 추가돼 있으면 통과
    null;
  end;
end $$;

-- 2) (선택) 변경 이벤트에 행 전체가 실리도록 — 우리는 이벤트를 '재조회 트리거'로만 쓰므로 default(변경 PK만)도 충분.
--    필요 시 아래 주석 해제.
-- alter table public.blog_post_reports replica identity full;

-- 참고: Realtime 은 구독자의 RLS SELECT 권한을 존중함. 내부 계정(is_internal)은 blog_post_reports 전체 조회 가능
--       (reporter-reports.sql 의 'bpr 내부 전체' 정책)하므로 insert/update 이벤트를 정상 수신한다.
