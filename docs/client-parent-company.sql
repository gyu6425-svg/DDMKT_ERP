-- 고객사 상위 그룹 — 한 업체(예: 더업스)가 여러 카페(방문요양·순댓국·횟집)를 운영할 때 묶는 이름.
--   A안: 각 카페=독립 client(토큰·발행 분리), parent_company 로 그룹 표시.
-- Supabase SQL Editor 에서 1회 실행(멱등).
alter table public.clients
    add column if not exists parent_company text;

comment on column public.clients.parent_company is
    '상위 그룹명 — 한 업체가 여러 카페를 운영할 때 묶는 이름(예: 더업스). 자동화 발행 탭에서 "더업스 › 방문요양" 그룹 표시.';
