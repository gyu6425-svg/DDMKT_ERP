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

-- 기자단 '발행' 버튼 = 본인 보고를 발행으로 이동(report_type/published_at 만).
--   기존 RLS의 기자단 update 정책은 status='rejected'(재보고)만 허용 → 저장(pending/confirmed)건은
--   0행 업데이트로 조용히 실패했음. 광범위 update 정책을 열면 기자단이 status(승인)까지 바꿀 수 있어 위험하므로,
--   딱 발행 이동만 하는 SECURITY DEFINER 함수로 처리한다(권한 상승 없음).
create or replace function public.mark_report_published(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.blog_post_reports
     set report_type = 'publish', published_at = now()
   where id = p_report_id
     and reporter_id = public.my_profile_id()  -- 본인 보고만
     and status <> 'rejected';                 -- 반려 건은 재보고로 처리
end;
$$;
grant execute on function public.mark_report_published(uuid) to authenticated;
