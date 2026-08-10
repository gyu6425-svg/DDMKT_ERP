-- =====================================================================
-- 계약 실매출(부가세포함 합계) 저장 — client_contracts.sale_total
-- 배경: ERP는 부가세를 항상 공급가×10%로 재계산해서, 세금계산서별로 반올림한
--       이카운트의 실제 부가세와 미세하게 어긋난다(장부 불일치).
--   sale_total(부가세포함 합계, 이카운트 '합계')을 저장해두면 매출 요약이 부가세를
--   재계산하지 않고 이 값을 그대로 써서 이카운트와 원 단위까지 일치한다.
--   null이면 기존대로 공급가×1.1(현금이면 미포함) 계산.
-- 실행: Supabase SQL Editor.
-- =====================================================================

alter table public.client_contracts add column if not exists sale_total bigint;

notify pgrst, 'reload schema';
