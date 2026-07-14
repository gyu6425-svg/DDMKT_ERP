-- 고객사(clients)에 세금계산서용 '광고주 성함' 컬럼 추가.
--   Supabase > SQL Editor 에서 1회 실행. (미실행 시 광고주 성함 저장/표시 불가)
--   나머지 세금계산서 항목은 기존 필드로 매핑:
--     상호명=거래처명(client_partner) 또는 업체명(company) · 사업자번호=business_number · 담당자 성함=manager
--     담당자 휴대폰=contact(연락처) · 사업장 주소=address · 업종/업태=industry · 이메일=invoice_email/email
--     금액·부가세·상품·외주비·실매출/순매출 = 계약(client_contracts)에서 자동 계산.

alter table public.clients add column if not exists advertiser_name text; -- 광고주 성함(세금계산서)
