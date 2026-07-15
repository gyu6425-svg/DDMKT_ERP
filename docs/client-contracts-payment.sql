-- 계약 결제수단 — 카드매출 구분. 'card'=카드결제, null=현금/계좌이체(일반, 세금계산서).
--   세금계산서 붙여넣기의 카드 양식으로 등록 시 payment_method='card'로 저장돼 카드 배지로 표시된다.
alter table public.client_contracts add column if not exists payment_method text;
