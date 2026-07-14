-- 기자단 글 보고 — 외주비 입금(정산) 상태 컬럼 추가.
--   Supabase > SQL Editor 에서 1회 실행. (미실행 시 '외주비 정산' 및 미입금/입금 칩이 동작 안 함)
--
--   흐름: 저장/발행 승인(confirmed) = 8,000원(대박종합주방 10,000) 지급기록 쌓임 · paid=false(미입금)
--         → 회사가 주 단위로 '외주비 정산'(성과 모달) 클릭 → 그 기자단 보고들 paid=true(입금)로 일괄 전환.
--   미입금/입금 칩은 기자단 ERP '정산 내역' + 브랜드블로그 '저장,발행 성과'에서 이 컬럼으로 표시.

alter table public.blog_post_reports add column if not exists paid boolean not null default false; -- 외주비 입금 여부
alter table public.blog_post_reports add column if not exists paid_at timestamptz;                 -- 정산(입금) 처리 시각
create index if not exists blog_post_reports_paid_idx on public.blog_post_reports (paid, status);

-- ⚠️ 보안 전제: '외주비 정산'(paid 갱신)은 blog_post_reports 의 'bpr 내부 전체'(is_internal) 정책으로 내부만 가능.
--   단 is_internal() 구버전은 client_id null 인 기자단을 내부로 오인 → 기자단이 paid 를 조작할 수 있음(상태 무결성 이슈).
--   반드시 reporter-erp-rls.sql Section B(하드닝: role='reporter' 제외)를 먼저 실행해 두어야 이 경로가 닫힌다.
