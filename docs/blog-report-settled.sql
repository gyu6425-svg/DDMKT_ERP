-- 기자단 승인 처리 내역: '정산' 상태(정산/미정산) 컬럼 추가.
--   입금(paid)의 '전 단계' 상태를 구분만 하기 위한 순수 플래그. 외주비·계약 진행이력엔 영향 없음.
--   Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요. (이미 있으면 IF NOT EXISTS 로 무해)

ALTER TABLE public.blog_post_reports
    ADD COLUMN IF NOT EXISTS settled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS settled_at timestamptz;

-- 참고: paid(입금)와 독립. 워크플로 = 미정산 → 정산 → 입금.
