-- 기자단 글 보고 — 외주비 입금(정산) 상태 컬럼 추가.
--   Supabase > SQL Editor 에서 1회 실행. (미실행 시 '외주비 정산' 및 미입금/입금 칩이 동작 안 함)
--
--   흐름: 저장/발행 승인(confirmed) = 8,000원(대박종합주방 10,000) 지급기록 쌓임 · paid=false(미입금)
--         → 회사가 주 단위로 '외주비 정산'(성과 모달) 클릭 → 그 기자단 보고들 paid=true(입금)로 일괄 전환.
--   미입금/입금 칩은 기자단 ERP '정산 내역' + 브랜드블로그 '저장,발행 성과'에서 이 컬럼으로 표시.

alter table public.blog_post_reports add column if not exists paid boolean not null default false; -- 외주비 입금 여부
alter table public.blog_post_reports add column if not exists paid_at timestamptz;                 -- 정산(입금) 처리 시각
create index if not exists blog_post_reports_paid_idx on public.blog_post_reports (paid, status);
