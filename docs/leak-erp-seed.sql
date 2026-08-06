-- 누수탐지 ERP — 구글시트 실데이터 이관 (생성일 2026-08-06)
--   원본: 든든한누수탐지 구글시트 (상담DB 48건 / 작업 11건 / 통장원장 / 외주발주 66건)
--   ⚠️ docs/leak-erp.sql · docs/leak-erp-region.sql 를 먼저 실행한 뒤 이 파일을 실행할 것.
--
--   [재실행 안전] 모든 이관 행의 note 에 '[시트이관]' 마커를 넣고, 시작 시 그 마커가 붙은 행만 지운다.
--     → 이 파일을 다시 실행해도 중복이 쌓이지 않는다. 단, 이관된 행을 UI 에서 수정하며
--        note 의 마커를 지웠다면 그 행은 삭제 대상에서 빠지므로 중복될 수 있다.
--
--   [이관 규칙 — docs/누수탐지-ERP-설계.md 검증 결과 반영]
--     · 날짜: 시트의 'MM-DD' 는 연도가 없다 → 통장원장 대조로 확인된 2026년으로 확정.
--     · 금액: '100,000원' 문자열 → 정수.
--     · 정산액: 재계산하지 않고 시트 값 그대로 저장. 규칙(30/70) 이탈 건은
--       is_rule_exception=true + exception_reason 에 근거를 남긴다.
--     · 지역: 시트의 '지역' 한 칸에 지역명과 현장명이 섞여 있어 자동 분리하지 않았다.
--       원문을 region 에 그대로 넣고, 시도(서울/경기/인천)만 확실한 것에 한해 채웠다.
--       → 필요하면 UI 에서 '시/구/동'과 '현장'으로 나누면 된다.
--     · 순서 열은 이관하지 않는다(중복·불일치로 식별자 역할 불가).

begin;

delete from public.leak_ledger      where memo like '%[시트이관]%';
delete from public.leak_jobs        where note like '%[시트이관]%';
delete from public.leak_inquiries   where note like '%[시트이관]%';
delete from public.leak_outsourcing where note like '%[시트이관]%';

-- ── 상담/문의 48건 ──────────────────────────────────────────────────────
insert into public.leak_inquiries (counselor, sido, region, phone, phone_norm, inquired_on, leak_type, contracted, note) values
  ('안유빈', '경기', '과천', '010 -2774-7589', '01027747589', '2026-04-17', '화장실 욕조', false, '[시트이관]'),
  ('안유빈', '경기', '과천', '010 -4597-2670', '01045972670', '2026-04-22', '아래층 누수', false, '[시트이관]'),
  ('조재현', '경기', '동탄', '010-7795-3203', '01077953203', '2026-04-25', '상가카페 누수', false, '[시트이관]'),
  ('홍여진', '서울', '가양동', '010-8861-5100', '01088615100', '2026-05-04', '아래층 침실 천장', false, '[시트이관]'),
  ('홍여진', '서울', '가양동', '010-3759-8480', '01037598480', '2026-05-09', '빗물누수', false, '[시트이관]'),
  ('홍여진', null, null, '02-2600-7848', '0226007848', '2026-05-11', '세면대막힘', false, '[시트이관] 원본 지역칸에 상담자명이 입력돼 있어 비움'),
  ('조재현', '인천', '을왕동', '010-3780-4347', '01037804347', '2026-05-12', '다가구 주택', false, '[시트이관]'),
  ('조재현', '인천', '청라', '010-2247-8300', '01022478300', '2026-05-12', '상가', false, '[시트이관]'),
  ('홍여진', '서울', '가양동', '010-5106-2061', '01051062061', '2026-05-12', '아파트  천장 얼룩', false, '[시트이관]'),
  ('홍여진', '서울', '가양동', '010-9184-9150', '01091849150', '2026-05-12', '타일 설비문의', false, '[시트이관]'),
  ('송민경', '서울', '구로 고척동', '010-7587-9887', '01075879887', '2026-05-12', '일반 주택', true, '[시트이관]'),
  ('조재현', '인천', '청라 국제대로237', '010-2247-8300', '01022478300', '2026-05-12', '상가', false, '[시트이관]'),
  ('조재현', '인천', '영종도 중구 을왕동', '010-3780-4347', '01037804347', '2026-05-12', '다가구 주택', false, '[시트이관]'),
  ('조재현', null, null, '010-9129-3777', '01091293777', '2026-05-13', '아파트', false, '[시트이관]'),
  ('조재현', '경기', '동탄 푸르지오', '010-7287-4119', '01072874119', '2026-05-14', '아파트', true, '[시트이관]'),
  ('조재현', '경기', '화성시 새솔동', '010-2856-7381', '01028567381', '2026-05-14', '아파트', false, '[시트이관]'),
  ('홍여진', '서울', '가양1단지', '010-8181-6186', '01081816186', '2026-05-19', '싱크대 아래', false, '[시트이관]'),
  ('조재현', '경기', '부천 소사구', '010-9492-9919', '01094929919', '2026-05-20', '단독주택', false, '[시트이관]'),
  ('김종인', '경기', '화성시 영천동', '010-7176-7329', '01071767329', '2026-05-21', '상가', false, '[시트이관]'),
  ('홍여진', '경기', '과천 지정타', '010-4139-2883', '01041392883', '2026-05-27', '카페 하수구 막힘', true, '[시트이관]'),
  ('조재현', '서울', '강서구 마곡동', '010-6413-0623', '01064130623', '2026-05-28', '외벽라인', false, '[시트이관]'),
  ('김종인', '인천', '인천 청라', '010-9392-6271', '01093926271', '2026-06-08', '싱크대 수전 찢어짐', true, '[시트이관]'),
  ('조재현', '경기', '남양주시 화도읍', '010-8752-5772', '01087525772', '2026-06-17', '빌라 메인 분배기', true, '[시트이관]'),
  ('김종인', '인천', '인천 청라', '010-2963-6486', '01029636486', '2026-06-17', '욕실누수', true, '[시트이관]'),
  ('조재현', '경기', '과천 갈현동', '010-4098-2971', '01040982971', '2026-06-22', '빗물 누수', false, '[시트이관]'),
  ('김종인', '서울', '오류동', '010-4455-5648', '01044555648', '2026-06-21', '컨테이너', false, '[시트이관]'),
  ('조재현', '경기', '과천시 별양동', '010-4728-0240', '01047280240', '2026-06-30', '아파트', false, '[시트이관]'),
  ('조재현', '경기', '동탄5동', '010-4702-2007', '01047022007', '2026-07-03', '싱크대 급수', false, '[시트이관]'),
  ('김종인', '인천', '인천 청라', '010-4166-2407', '01041662407', '2026-07-03', '타업체 실패', true, '[시트이관]'),
  ('송민경', '경기', '미사강변', '010-9345-1605', '01093451605', '2026-07-03', '수영장 화장실', false, '[시트이관]'),
  ('조재현', '서울', '사당동 빌라', '010-3836-3876', '01038363876', '2026-07-05', '아랫집 누수', false, '[시트이관]'),
  ('조재현', '서울', '강동구 암사', '010-4902-6459', '01049026459', '2026-07-08', '욕실 누수', true, '[시트이관]'),
  ('김종인', '인천', '인천 청라', '010-7928-4869', '01079284869', '2026-07-09', '카페 누수', true, '[시트이관]'),
  ('조재현', '경기', '동탄 MH 엘클루', '010-3341-7112', '01033417112', '2026-07-10', '시공 천장 물이샘', false, '[시트이관]'),
  ('조재현', '경기', '덕양구 화정동', '010-7597-6425', '01075976425', '2026-07-10', '천장 젖음', false, '[시트이관]'),
  ('조재현', '경기', '동탄 사무실', '010-2328-5227', '01023285227', '2026-07-13', '사무실  상가', false, '[시트이관]'),
  ('조재현', '경기', '과천 중앙동', '010-2653-7622', '01026537622', '2026-07-15', '빌라 19시 방문', false, '[시트이관]'),
  ('김종인', '인천', '인천 청라', '010-8077-4691', '01080774691', '2026-07-18', '윗집 누수발생', false, '[시트이관]'),
  ('조재현', '인천', '서구 검암동', '010-5449-1268', '01054491268', '2026-07-20', '배수통 누수', true, '[시트이관]'),
  ('김종인', '서울', '양천구', '010-6479-4825', '01064794825', '2026-07-21', '빗물누수', false, '[시트이관]'),
  ('김종인', '인천', '인천 청라', '010-7113-3556', '01071133556', '2026-07-22', '아랫집 누수', false, '[시트이관]'),
  ('조재현', '경기', '권선구 푸르지오', '010-2566-4329', '01025664329', '2026-07-24', '거실 베란다 천장', false, '[시트이관]'),
  ('조재현', '경기', '경기도 가평', '010-8636-7527', '01086367527', '2026-07-24', '빗물 누수 외벽젖음', false, '[시트이관]'),
  ('김종인', '인천', '인천 청라', '010-8875-4144', '01088754144', '2026-07-24', '벽에 곰팡이 들뜸', false, '[시트이관]'),
  ('조재현', '서울', '마포구월드컵로39', '010-5277-3858', '01052773858', '2026-07-27', '아파트 외벽 누수', false, '[시트이관]'),
  ('조재현', '경기', '의정부 민락동', '010-8201-1735', '01082011735', '2026-07-28', '상가 식당 주방', false, '[시트이관]'),
  ('송민경', null, '연수2차', '010-4950-1905', '01049501905', '2026-07-29', '욕실 누수', false, '[시트이관]'),
  ('송민경', '경기', '용인시 기흥구', '010-9658-6876', '01096586876', '2026-07-30', '천장 누수', true, '[시트이관]');

-- ── 작업 · 정산 11건 ────────────────────────────────────────────────────
--   inquiry_id 는 연락처로 연결(시트에서 유일하게 검증된 조인 키 · 11/11 매칭 확인됨).
insert into public.leak_jobs (inquiry_id, site_name, sido, region, phone, phone_norm, worked_on, gross_amount, vendor, deduction_amount, deduction_note, base_amount, applied_rate, our_share, partner_share, is_rule_exception, exception_reason, settled_on, invoice_status, note) values (
  (select id from public.leak_inquiries where phone_norm = '01075879887' and contracted order by inquired_on desc limit 1),
  null, '서울', '구로 고척동', '010-7587-9887', '01075879887', '2026-05-12',
  100000, '백준누수', 0, null, 100000, 30.0, 30000, 70000,
  false, null, '2026-05-13', '미발행', '[시트이관]');
insert into public.leak_jobs (inquiry_id, site_name, sido, region, phone, phone_norm, worked_on, gross_amount, vendor, deduction_amount, deduction_note, base_amount, applied_rate, our_share, partner_share, is_rule_exception, exception_reason, settled_on, invoice_status, note) values (
  (select id from public.leak_inquiries where phone_norm = '01072874119' and contracted order by inquired_on desc limit 1),
  null, '경기', '동탄 푸르지오', '010-7287-4119', '01072874119', '2026-05-14',
  300000, '백준누수', 0, null, 300000, 20.0, 60000, 240000,
  true, '적용요율 20.0% (정의 30%와 다름)', '2026-05-15', '미발행', '[시트이관]');
insert into public.leak_jobs (inquiry_id, site_name, sido, region, phone, phone_norm, worked_on, gross_amount, vendor, deduction_amount, deduction_note, base_amount, applied_rate, our_share, partner_share, is_rule_exception, exception_reason, settled_on, invoice_status, note) values (
  (select id from public.leak_inquiries where phone_norm = '01041392883' and contracted order by inquired_on desc limit 1),
  null, '경기', '과천 지정타', '010-4139-2883', '01041392883', '2026-06-01',
  300000, '백준누수', 0, null, 300000, 20.0, 60000, 240000,
  true, '적용요율 20.0% (정의 30%와 다름)', '2026-06-01', '미발행', '[시트이관]');
insert into public.leak_jobs (inquiry_id, site_name, sido, region, phone, phone_norm, worked_on, gross_amount, vendor, deduction_amount, deduction_note, base_amount, applied_rate, our_share, partner_share, is_rule_exception, exception_reason, settled_on, invoice_status, note) values (
  (select id from public.leak_inquiries where phone_norm = '01093926271' and contracted order by inquired_on desc limit 1),
  null, '인천', '인천청라', '010-9392-6271', '01093926271', '2026-06-08',
  250000, '백준누수', 0, '수전교체 20% 정산', 250000, 17.36, 43400, 217000,
  true, '수전교체 20% 정산 · 시트 합계 불일치 +10,400원(원본 값 그대로 이관) · 적용요율 17.36% (정의 30%와 다름)', '2026-06-09', '미발행', '[시트이관]');
insert into public.leak_jobs (inquiry_id, site_name, sido, region, phone, phone_norm, worked_on, gross_amount, vendor, deduction_amount, deduction_note, base_amount, applied_rate, our_share, partner_share, is_rule_exception, exception_reason, settled_on, invoice_status, note) values (
  (select id from public.leak_inquiries where phone_norm = '01087525772' and contracted order by inquired_on desc limit 1),
  null, '경기', '남양주시 화도읍', '010-8752-5772', '01087525772', '2026-06-17',
  1900000, '백준누수', 0, null, 1900000, 30.0, 570000, 1330000,
  false, null, '2026-06-17', '발행완료', '[시트이관]');
insert into public.leak_jobs (inquiry_id, site_name, sido, region, phone, phone_norm, worked_on, gross_amount, vendor, deduction_amount, deduction_note, base_amount, applied_rate, our_share, partner_share, is_rule_exception, exception_reason, settled_on, invoice_status, note) values (
  (select id from public.leak_inquiries where phone_norm = '01029636486' and contracted order by inquired_on desc limit 1),
  null, '인천', '인천 청라', '010-2963-6486', '01029636486', '2026-06-25',
  1800000, '백준누수', 0, null, 1800000, 30.0, 540000, 1800000,
  true, '시트 합계 불일치 +540,000원(원본 값 그대로 이관)', '2026-06-25', '발행완료', '[시트이관]');
insert into public.leak_jobs (inquiry_id, site_name, sido, region, phone, phone_norm, worked_on, gross_amount, vendor, deduction_amount, deduction_note, base_amount, applied_rate, our_share, partner_share, is_rule_exception, exception_reason, settled_on, invoice_status, note) values (
  (select id from public.leak_inquiries where phone_norm = '01079284869' and contracted order by inquired_on desc limit 1),
  null, '인천', '인천 청라 카페', '010-7928-4869', '01079284869', '2026-07-09',
  480000, '백준누수', 0, null, 480000, 22.08, 106000, 374000,
  true, '적용요율 22.08% (정의 30%와 다름)', '2026-07-09', '발행완료', '[시트이관]');
insert into public.leak_jobs (inquiry_id, site_name, sido, region, phone, phone_norm, worked_on, gross_amount, vendor, deduction_amount, deduction_note, base_amount, applied_rate, our_share, partner_share, is_rule_exception, exception_reason, settled_on, invoice_status, note) values (
  (select id from public.leak_inquiries where phone_norm = '01041662407' and contracted order by inquired_on desc limit 1),
  null, '인천', '인천청라', '010-4166-2407', '01041662407', '2026-07-13',
  740000, '백준누수', 0, '자재비 6만원', 740000, 30.0, 222000, 518000,
  false, '자재비 6만원', '2026-07-15', '발행완료', '[시트이관]');
insert into public.leak_jobs (inquiry_id, site_name, sido, region, phone, phone_norm, worked_on, gross_amount, vendor, deduction_amount, deduction_note, base_amount, applied_rate, our_share, partner_share, is_rule_exception, exception_reason, settled_on, invoice_status, note) values (
  (select id from public.leak_inquiries where phone_norm = '01054491268' and contracted order by inquired_on desc limit 1),
  null, '인천', '서구 검암동', '010-5449-1268', '01054491268', '2026-07-20',
  100000, '백준누수', 0, '하수구 누수 / 자재비 2만원', 100000, 16.0, 16000, 80000,
  true, '하수구 누수 / 자재비 2만원 · 시트 합계 불일치 -4,000원(원본 값 그대로 이관) · 적용요율 16.0% (정의 30%와 다름)', '2026-07-20', '발행완료', '[시트이관]');
insert into public.leak_jobs (inquiry_id, site_name, sido, region, phone, phone_norm, worked_on, gross_amount, vendor, deduction_amount, deduction_note, base_amount, applied_rate, our_share, partner_share, is_rule_exception, exception_reason, settled_on, invoice_status, note) values (
  (select id from public.leak_inquiries where phone_norm = '01049026459' and contracted order by inquired_on desc limit 1),
  null, '서울', '강동구 암사동', '010-4902-6459', '01049026459', '2026-07-25',
  5500000, '백준누수', 0, '자재비 외 2,900,000원', 5500000, 14.18, 780000, 2600000,
  true, '자재비 외 2,900,000원 · 시트 합계 불일치 -2,120,000원(원본 값 그대로 이관) · 적용요율 14.18% (정의 30%와 다름)', '2026-07-25', '발행완료', '[시트이관]');
insert into public.leak_jobs (inquiry_id, site_name, sido, region, phone, phone_norm, worked_on, gross_amount, vendor, deduction_amount, deduction_note, base_amount, applied_rate, our_share, partner_share, is_rule_exception, exception_reason, settled_on, invoice_status, note) values (
  (select id from public.leak_inquiries where phone_norm = '01096586876' and contracted order by inquired_on desc limit 1),
  null, '경기', '용인시 기흥구', '010-9658-6876', '01096586876', '2026-08-01',
  400000, '백준누수', 0, null, 400000, 20.0, 80000, 320000,
  true, '적용요율 20.0% (정의 30%와 다름)', '2026-08-01', '미발행', '[시트이관]');

-- ── 통장 원장 ───────────────────────────────────────────────────────────
--   잔액 열은 이관하지 않는다 — 앱이 입출금으로 매번 누적 계산한다.
--   (시트의 월합계 잔고는 손입력이라 4월·8월에 오류가 있었다.)
insert into public.leak_ledger (entry_date, inflow, outflow, outflow_kind, memo, unreconciled) values
  ('2026-04-24', 0, 725945, '외주비', '[시트이관]', false),
  ('2026-05-12', 50000, 1478400, '외주비', '디디클린 입금 [시트이관]', true),
  ('2026-05-13', 30000, 0, null, '[시트이관]', false),
  ('2026-05-15', 60000, 0, null, '[시트이관]', false),
  ('2026-06-01', 60000, 0, null, '[시트이관]', false),
  ('2026-06-08', 43400, 0, null, '[시트이관]', false),
  ('2026-06-10', 0, 207900, '외주비', '[시트이관]', false),
  ('2026-06-12', 0, 30800, '외주비', '[시트이관]', false),
  ('2026-06-17', 570000, 0, null, '[시트이관]', false),
  ('2026-06-19', 0, 203280, '외주비', '[시트이관]', false),
  ('2026-06-20', 575, 0, null, '[시트이관]', true),
  ('2026-06-25', 540000, 0, null, '[시트이관]', false),
  ('2026-07-09', 106000, 0, null, '[시트이관]', false),
  ('2026-07-15', 222000, 4560, '외주비', '드림 VOL 출금 [시트이관]', false),
  ('2026-07-20', 16000, 0, null, '[시트이관]', false),
  ('2026-07-25', 780000, 0, null, '[시트이관]', false),
  ('2026-08-01', 80000, 0, null, '[시트이관]', false),
  ('2026-08-03', 0, 110000, '세금', '누수탐지 부가세 [시트이관]', false),
  ('2026-08-04', 0, 560860, '급여', '재현,민경 정산 [시트이관]', false),
  ('2026-08-05', 0, 2236230, '대표인출', '대표님 [시트이관]', false);

-- ── 외주 발주 ───────────────────────────────────────────────────────────
insert into public.leak_outsourcing (item_name, marketing_type, vendor, started_on, ended_on, amount, amount_vat, entry_kind, settled_to_vendor, settled_final, note) values
  ('비상주_용인(연장)', '비상주', '헬로우비상주', '2026-04-05', '2027-04-04', 200000, 220000, 'order', true, true, '카드결제(현대) [시트이관]'),
  ('비상주_양천신정점', '비상주', '헬로우비상주', '2026-04-13', '2027-06-12', 300000, 300000, 'order', true, true, '카드결제(하나) / 12+2개월 [시트이관]'),
  ('비상주_강서가양1호점', '비상주', '헬로우비상주', '2026-04-13', '2027-04-12', 220000, 220000, 'order', true, true, '카드결제(하나) [시트이관]'),
  ('비상주_일산동구점', '비상주', '헬로우비상주', '2026-04-13', '2027-04-12', 220000, 220000, 'order', true, true, '카드결제(하나) [시트이관]'),
  ('비상주_부천중동점', '비상주', '헬로우비상주', '2026-04-13', '2027-04-12', 220000, 220000, 'order', true, true, '카드결제(하나) [시트이관]'),
  ('과천', '비상주', '디테크타워', null, null, 0, 0, 'order', false, false, '[시트이관]'),
  ('동탄', '비상주', '헬로우비상주', null, null, 0, 0, 'order', false, false, '[시트이관]'),
  ('인천', '비상주', '헬로우비상주', null, null, 0, 0, 'order', false, false, '[시트이관]'),
  ('안산-> 분당', '비상주', '비즈비즈', '2026-05-28', '2026-10-25', 33000, 0, 'order', false, false, '[시트이관]'),
  ('안양', '비상주', '평촌역힐스테이트', null, null, 0, 0, 'order', false, false, '[시트이관]'),
  ('동탄', '플레이스(블배포)', 'TS', '2026-04-17', '2026-05-06', 35000, 38500, 'order', true, false, '어스 100건 [시트이관]'),
  ('인천', '플레이스(블배포)', 'TS', '2026-04-17', '2026-05-06', 35000, 38500, 'order', true, false, '어스 100건 [시트이관]'),
  ('안산', '플레이스(블배포)', 'TS', '2026-04-17', '2026-05-06', 35000, 38500, 'order', true, false, '어스 100건 [시트이관]'),
  ('용인', '플레이스(블배포)', 'TS', '2026-04-17', '2026-05-06', 35000, 38500, 'order', true, false, '어스 100건 [시트이관]'),
  ('양천구', '플레이스(블배포)', 'TS', '2026-04-21', '2026-05-10', 35000, 38500, 'order', true, false, '어스 100건 [시트이관]'),
  ('강서구', '플레이스(블배포)', 'TS', '2026-04-21', '2026-05-10', 35000, 38500, 'order', true, false, '어스 100건 [시트이관]'),
  ('일산동구', '플레이스(블배포)', 'TS', '2026-04-21', '2026-05-10', 35000, 38500, 'order', true, false, '어스 100건 [시트이관]'),
  ('부천중동', '플레이스(블배포)', 'TS', '2026-04-21', '2026-05-10', 35000, 38500, 'order', true, false, '어스 100건 [시트이관]'),
  ('동탄', '플레이스(리워드)', 'TS', '2026-04-22', '2026-04-28', 56000, 61600, 'order', true, false, '리워드 애플 200타 [시트이관]'),
  ('인천', '플레이스(리워드)', 'TS', '2026-04-22', '2026-04-28', 56000, 61600, 'order', true, false, '리워드 애플 200타 [시트이관]'),
  ('안산', '플레이스(리워드)', 'TS', '2026-04-22', '2026-04-28', 56000, 61600, 'order', true, false, '리워드 애플 200타 [시트이관]'),
  ('용인', '플레이스(리워드)', 'TS', '2026-04-22', '2026-04-28', 56000, 61600, 'order', true, false, '리워드 애플 200타 [시트이관]'),
  ('양천구', '플레이스(리워드)', 'TS', '2026-04-22', '2026-04-28', 56000, 61600, 'order', true, false, '리워드 애플 200타 [시트이관]'),
  ('강서구', '플레이스(리워드)', 'TS', '2026-04-22', '2026-04-28', 56000, 61600, 'order', true, false, '리워드 애플 200타 [시트이관]'),
  ('일산동구', '플레이스(리워드)', 'TS', '2026-04-22', '2026-04-28', 56000, 61600, 'order', true, false, '리워드 애플 200타 [시트이관]'),
  ('부천중동', '플레이스(리워드)', 'TS', '2026-04-22', '2026-04-28', 56000, 61600, 'order', true, false, '리워드 애플 200타 [시트이관]'),
  ('동탄', '플레이스(블배포)', 'TS', '2026-04-23', '2026-04-23', -24150, -26565, 'refund', true, false, '어스 -69 [시트이관]'),
  ('인천', '플레이스(블배포)', 'TS', '2026-04-23', '2026-04-23', -23800, -26180, 'refund', true, false, '어스 -68 [시트이관]'),
  ('안산', '플레이스(블배포)', 'TS', '2026-04-23', '2026-04-23', -23450, -25795, 'refund', true, false, '어스 -67 [시트이관]'),
  ('용인', '플레이스(블배포)', 'TS', '2026-04-23', '2026-04-23', -24150, -26565, 'refund', true, false, '어스 -69 [시트이관]'),
  ('양천구', '플레이스(블배포)', 'TS', '2026-04-23', '2026-04-23', -32550, -35805, 'refund', true, false, '어스 -93 [시트이관]'),
  ('강서구', '플레이스(블배포)', 'TS', '2026-04-23', '2026-04-23', -32200, -35420, 'refund', true, false, '어스 -92 [시트이관]'),
  ('일산동구', '플레이스(블배포)', 'TS', '2026-04-23', '2026-04-23', -32550, -35805, 'refund', true, false, '어스 -93 [시트이관]'),
  ('부천중동', '플레이스(블배포)', 'TS', '2026-04-23', '2026-04-23', -32200, -35420, 'refund', true, false, '어스 -92 [시트이관]'),
  ('동탄', '플레이스(블배포)', 'TS', '2026-04-23', null, 42750, 47025, 'order', true, false, '247 충전 95 [시트이관]'),
  ('인천', '플레이스(블배포)', 'TS', '2026-04-23', null, 42750, 47025, 'order', true, false, '247 충전 95 [시트이관]'),
  ('안산', '플레이스(블배포)', 'TS', '2026-04-23', null, 42750, 47025, 'order', true, false, '247 충전 95 [시트이관]'),
  ('용인', '플레이스(블배포)', 'TS', '2026-04-23', null, 42750, 47025, 'order', true, false, '247 충전 95 [시트이관]'),
  ('양천구', '플레이스(블배포)', 'TS', '2026-04-23', null, 31500, 34650, 'order', true, false, '247 충전 70 [시트이관]'),
  ('강서구', '플레이스(블배포)', 'TS', '2026-04-23', null, 31500, 34650, 'order', true, false, '247 충전 70 [시트이관]'),
  ('일산동구', '플레이스(블배포)', 'TS', '2026-04-23', null, 31500, 34650, 'order', true, false, '247 충전 70 [시트이관]'),
  ('부천중동', '플레이스(블배포)', 'TS', '2026-04-23', null, 31500, 34650, 'order', true, false, '247 충전 70 [시트이관]'),
  ('동탄', '플레이스(리워드)', 'HS', '2026-04-29', '2026-05-04', 63000, 69300, 'order', true, false, '프리미엄뭉치 [시트이관]'),
  ('인천', '플레이스(리워드)', 'HS', '2026-04-29', '2026-05-04', 63000, 69300, 'order', true, false, '프리미엄뭉치 [시트이관]'),
  ('안산', '플레이스(리워드)', 'HS', '2026-04-29', '2026-05-04', 63000, 69300, 'order', true, false, '프리미엄뭉치 [시트이관]'),
  ('용인', '플레이스(리워드)', 'HS', '2026-04-29', '2026-05-04', 63000, 69300, 'order', true, false, '프리미엄뭉치 [시트이관]'),
  ('양천구', '플레이스(리워드)', 'HS', '2026-04-29', '2026-05-04', 63000, 69300, 'order', true, false, '프리미엄뭉치 [시트이관]'),
  ('강서구', '플레이스(리워드)', 'HS', '2026-04-29', '2026-05-04', 63000, 69300, 'order', true, false, '프리미엄뭉치 [시트이관]'),
  ('일산동구', '플레이스(리워드)', 'HS', '2026-04-29', '2026-05-04', 63000, 69300, 'order', true, false, '프리미엄뭉치 [시트이관]'),
  ('부천중동', '플레이스(리워드)', 'HS', '2026-04-29', '2026-05-04', 63000, 69300, 'order', true, false, '프리미엄뭉치 [시트이관]'),
  ('동탄', '플레이스(리워드)', 'HS', '2026-05-05', '2026-05-07', 31500, 34650, 'order', true, false, '프리미엄뭉치 [시트이관]'),
  ('인천', '플레이스(리워드)', 'HS', '2026-05-05', '2026-05-07', 31500, 34650, 'order', true, false, '프리미엄뭉치 [시트이관]'),
  ('안산', '플레이스(리워드)', 'HS', '2026-05-05', '2026-05-07', 31500, 34650, 'order', true, false, '프리미엄뭉치 [시트이관]'),
  ('용인', '플레이스(리워드)', 'HS', '2026-05-05', '2026-05-07', 31500, 34650, 'order', true, false, '프리미엄뭉치 [시트이관]'),
  ('양천구', '플레이스(리워드)', 'HS', '2026-05-05', '2026-05-07', 31500, 34650, 'order', true, false, '프리미엄뭉치 [시트이관]'),
  ('강서구', '플레이스(리워드)', 'HS', '2026-05-05', '2026-05-07', 31500, 34650, 'order', true, false, '프리미엄뭉치 [시트이관]'),
  ('일산동구', '플레이스(리워드)', 'HS', '2026-05-05', '2026-05-07', 31500, 34650, 'order', true, false, '프리미엄뭉치 [시트이관]'),
  ('부천중동', '플레이스(리워드)', 'HS', '2026-05-05', '2026-05-07', 31500, 34650, 'order', true, false, '프리미엄뭉치 [시트이관]'),
  ('동탄', '플레이스(리워드)', 'HS', '2026-05-09', '2026-05-15', 73500, 80850, 'order', true, false, '슈퍼뭉치 [시트이관]'),
  ('인천', '플레이스(리워드)', 'HS', '2026-05-09', '2026-05-15', 73500, 80850, 'order', true, false, '슈퍼뭉치 [시트이관]'),
  ('안산', '플레이스(리워드)', 'HS', '2026-05-09', '2026-05-15', 73500, 80850, 'order', true, false, '슈퍼뭉치 [시트이관]'),
  ('용인', '플레이스(리워드)', 'HS', '2026-05-09', '2026-05-15', 73500, 80850, 'order', true, false, '슈퍼뭉치 [시트이관]'),
  ('양천구', '플레이스(리워드)', 'HS', '2026-05-09', '2026-05-15', 73500, 80850, 'order', true, false, '슈퍼뭉치 [시트이관]'),
  ('강서구', '플레이스(리워드)', 'HS', '2026-05-09', '2026-05-15', 73500, 80850, 'order', true, false, '슈퍼뭉치 [시트이관]'),
  ('일산동구', '플레이스(리워드)', 'HS', '2026-05-09', '2026-05-15', 73500, 80850, 'order', true, false, '슈퍼뭉치 [시트이관]'),
  ('부천중동', '플레이스(리워드)', 'HS', '2026-05-09', '2026-05-15', 73500, 80850, 'order', true, false, '슈퍼뭉치 [시트이관]'),
  ('(품목명 없음)', '플레이스(리워드)', 'TS', null, null, -112720, -123992, 'refund', true, false, '리워드 애플 200타 [시트이관]');

commit;

-- ── 이관 검증 ────────────────────────────────────────────────────────────
--   기대값: 상담 48 / 성사 11 / 작업 11 / 상담연결 11 / 결제 11,870,000 /
--           든든 2,507,400 / 백준 7,789,000 / 원장 입금 2,557,975 · 출금 5,557,975 / 외주 67
select
  (select count(*) from public.leak_inquiries)                            as 상담,
  (select count(*) from public.leak_inquiries where contracted)           as 성사,
  (select count(*) from public.leak_jobs)                                 as 작업,
  (select count(*) from public.leak_jobs where inquiry_id is not null)    as 상담연결,
  (select count(*) from public.leak_jobs where is_rule_exception)         as 정산예외,
  (select sum(gross_amount)  from public.leak_jobs)                       as 결제합계,
  (select sum(our_share)     from public.leak_jobs)                       as 든든합계,
  (select sum(partner_share) from public.leak_jobs)                       as 백준합계,
  (select sum(inflow)  from public.leak_ledger)                           as 원장입금,
  (select sum(outflow) from public.leak_ledger)                           as 원장출금,
  (select count(*) from public.leak_outsourcing)                          as 외주;

-- 롤백(이관분만 제거):
-- begin;
-- delete from public.leak_ledger where memo like '%[시트이관]%';
-- delete from public.leak_jobs where note like '%[시트이관]%';
-- delete from public.leak_inquiries where note like '%[시트이관]%';
-- delete from public.leak_outsourcing where note like '%[시트이관]%';
-- commit;
