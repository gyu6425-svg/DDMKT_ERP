-- ============================================================================
-- 카페 배포 접수 유형 — 지역형 / 키워드형.
--   지역형: 지역셋(서울/경기/인천) 선택 + 제품키워드 → 지역+키워드.
--   키워드형: 플레이스 주소 기반(맛집 등).
-- ⚠️ main 에서 1회 실행. 재실행 안전.
-- ============================================================================
begin;
alter table public.cafe_deploy_requests
  add column if not exists deploy_type text default '지역형',   -- 지역형 | 키워드형
  add column if not exists region_sets jsonb;                    -- 지역형 선택 지역셋 예 ["서울","경기"]
commit;
-- 롤백: alter table public.cafe_deploy_requests drop column if exists deploy_type, drop column if exists region_sets;
