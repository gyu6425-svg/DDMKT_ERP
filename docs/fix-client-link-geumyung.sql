-- 금융책사 — 고객ERP 계정 연동 복구 (2026-08-12)
--
-- 증상: 관리자 계약관리에는 금융책사 계약 3건이 있는데 고객ERP 화면엔 아무것도 안 보인다.
-- 원인 2가지 (실측):
--   ① 고객이 우리 등록과 별개로 셀프 가입 → 거래처명 '스마트비즈'로 **다른 client 행**이 생성됐고
--      그 계정(yanstar82@gmail.com)이 그쪽을 보고 있었다. 금융책사에 연결된 계정은 0개.
--        · 금융책사   1210f034-1158-4a83-bf76-777ea2c9c32f  (2026-07-07 등록 · 담당 김종인 · 거래처=스마트비즈)
--        · 스마트비즈 cff4168c-2b49-48c8-99e6-59ea66e11609  (2026-08-12 셀프가입 · 계약은 가입승인용 빈 껍데기 1건)
--   ② 금융책사 계약 3건이 전부 sheet_approved=false(카테고리 관리시트 '신규 등록' 미승인)였다.
--      고객 사이드바·개요는 승인된 계약만 노출하므로, 계정을 연결해도 승인 없이는 여전히 안 보인다.
--
-- 실행: Supabase > SQL Editor 에 통째로 붙여넣고 실행. 재실행해도 안전(멱등).

-- 0) 실행 전 상태 확인 (원하면 이 줄만 먼저 돌려보기)
select c.company, c.id, count(ct.id) as 계약수,
       count(*) filter (where ct.sheet_approved) as 승인됨,
       (select count(*) from public.profiles p where p.client_id = c.id) as 연결계정
  from public.clients c
  left join public.client_contracts ct on ct.client_id = c.id
 where c.id in ('1210f034-1158-4a83-bf76-777ea2c9c32f','cff4168c-2b49-48c8-99e6-59ea66e11609')
 group by c.company, c.id;

-- 1) 고객 계정을 '금융책사'로 이동 (셀프가입으로 생긴 스마트비즈 → 본 계정)
update public.profiles
   set client_id = '1210f034-1158-4a83-bf76-777ea2c9c32f'
 where email = 'yanstar82@gmail.com';

-- 2) 금융책사 계약 3건 시트 승인 — 카페 배포 100건 / 랜딩페이지 1건 / 브랜드 블로그 50건
--    (카테고리 관리시트의 '승인' 버튼과 동일. 승인해야 고객 사이드바·개요에 뜬다)
update public.client_contracts
   set sheet_approved = true
 where client_id = '1210f034-1158-4a83-bf76-777ea2c9c32f'
   and sheet_approved is not true;

-- 3) 셀프가입 때 자동 생성된 빈 껍데기 정리 (수량·금액 없는 '카페 배포' 더미 + 상품태그)
--    실제 카페 배포 계약은 금융책사 쪽 100건짜리가 진짜다.
delete from public.client_contracts
 where client_id = 'cff4168c-2b49-48c8-99e6-59ea66e11609'
   and goal_count is null and amount is null;
delete from public.contract_data
 where client_id = 'cff4168c-2b49-48c8-99e6-59ea66e11609';

-- 4) 실행 후 확인 — 금융책사: 계약 3건·승인 3건·연결계정 1 / 스마트비즈: 0·0·0
select c.company, c.id, count(ct.id) as 계약수,
       count(*) filter (where ct.sheet_approved) as 승인됨,
       (select count(*) from public.profiles p where p.client_id = c.id) as 연결계정
  from public.clients c
  left join public.client_contracts ct on ct.client_id = c.id
 where c.id in ('1210f034-1158-4a83-bf76-777ea2c9c32f','cff4168c-2b49-48c8-99e6-59ea66e11609')
 group by c.company, c.id;

-- 5) (선택) 빈 껍데기가 된 '스마트비즈' 업체 행 삭제 — 위 4번에서 전부 0 인 것을 확인한 뒤에만.
--    삭제하면 계약관리 목록에서 사라진다. 되돌릴 수 없으니 확인 후 주석 해제.
-- delete from public.clients where id = 'cff4168c-2b49-48c8-99e6-59ea66e11609';
