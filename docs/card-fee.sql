-- 카드매출 수수료(카드사 공제분, 건별 상이) — 계약 추가 '카드매출' 시 직접 입력해 저장.
--   card_fee: 카드 수수료(원). 실수령 = 카드합계(공급가+부가세) − card_fee.
--   payment_method='card' + sale_total(카드합계)와 함께 사용. 앱은 컬럼 없어도 카드 수수료만 빼고 저장(폴백).
alter table client_contracts add column if not exists card_fee int;
