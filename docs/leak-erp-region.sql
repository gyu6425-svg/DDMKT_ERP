-- 누수탐지 ERP — 지역/현장 분리 (2026-08-05)
--   기존: region 한 칸에 '의정부 민락동' · '연수2차'(현장명) 등이 섞여 들어감.
--   변경: sido(서울/경기/인천 토글) + region(시/구/동 직접입력) + site_name(현장명) 3분리.
--   ⚠️ docs/leak-erp.sql 을 먼저 실행한 뒤 이 파일을 실행할 것.

begin;

-- 상담: sido / site_name 추가. 기존 region 은 '시/구/동' 용도로 계속 사용.
alter table public.leak_inquiries
  add column if not exists sido      text,   -- 서울 | 경기 | 인천
  add column if not exists site_name text;   -- 현장명(아파트·상가 등)

-- 작업: sido / region 추가. 기존 site_name 은 '현장명' 용도로 계속 사용.
alter table public.leak_jobs
  add column if not exists sido   text,
  add column if not exists region text;

create index if not exists li_sido_idx on public.leak_inquiries (sido);
create index if not exists lj_sido_idx on public.leak_jobs (sido);

commit;

-- 롤백:
-- begin;
-- alter table public.leak_inquiries drop column if exists sido, drop column if exists site_name;
-- alter table public.leak_jobs      drop column if exists sido, drop column if exists region;
-- commit;
