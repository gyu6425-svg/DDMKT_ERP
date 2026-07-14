-- 기자단 글 보고 — 저장/발행 구분 컬럼 추가 (2026-07 개편)
--   Supabase 대시보드 > SQL Editor 에서 1회 실행. (실행 전엔 저장/발행 보고가 400 남 — 먼저 실행 필수)
--
--   report_type: 'save'(저장) | 'publish'(발행) — 기자단 히스토리 버킷.
--   published_at: 기자단이 '발행' 처리한 시각(발행 히스토리 표시용).
--   승인(회사) 시 계약 잔여-1 + 외주비 1건이 딱 1회 잡히고(저장·발행 동일),
--   이미 승인된 건을 발행 버튼으로 옮겨도 재계상되지 않음(week키=rpt-<보고id>로 중복 방지).

alter table public.blog_post_reports add column if not exists report_type text not null default 'save';
alter table public.blog_post_reports add column if not exists published_at timestamptz;
create index if not exists blog_post_reports_type_status_idx on public.blog_post_reports (report_type, status);

-- 기존 '발행완료(published)' 데이터는 발행 타입으로 정렬(이미 계약 계상 완료된 건).
update public.blog_post_reports set report_type = 'publish' where status = 'published' and report_type = 'save';

-- 기자단이 본인 보고의 report_type/published_at 을 갱신할 수 있어야 함('발행' 버튼).
--   기존 RLS에 기자단 update 정책이 본인 것만 허용하는지 확인. 없으면 아래 추가:
-- drop policy if exists "reporter update own report type" on public.blog_post_reports;
-- create policy "reporter update own report type" on public.blog_post_reports
--   for update to authenticated
--   using (reporter_id = public.my_profile_id())
--   with check (reporter_id = public.my_profile_id());
