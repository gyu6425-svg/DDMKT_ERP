-- 메디푸스 → 문제성발관리센터 통합 + 브랜드블로그 연동 (2026-08-13)
--
-- 실측: '메디푸스' 이름이 붙은 업체가 2개 더 있었다(사장님이 보신 2개 + 숨은 1개).
--   ① 9f3b960c  문제성발관리센터              계약 12건 · 플레이스계정 1 · 블로그계정 0   ← 여기로 통합
--   ② f4e6e9db  문제성 발관리센터 메디푸스     계약 2건(2026-06-09 · 잔여 0, 지난 계약)
--   ③ fd1003c8  메디푸스                      계약 1건(브랜드블로그 그림자) · **블로그계정 medifuss** · 고객계정 1
--
-- 브랜드블로그가 연동 안 된 이유: 블로그 계정(medifuss, 목표8/잔여5)이 ③에 붙어 있고,
--   정작 브랜드블로그 계약(8건 · 280,000원)은 ①에 있어서 서로 다른 업체로 갈라져 있었다.
--
-- 실행: Supabase > SQL Editor 에 통째로. 순서 중요(계약·계정을 옮긴 뒤 업체 삭제).

-- 0) 실행 전 확인
select id, company, (select count(*) from public.client_contracts ct where ct.client_id = c.id) as 계약,
       (select count(*) from public.blog_accounts b where b.client_id = c.id) as 블로그계정,
       (select count(*) from public.profiles p where p.client_id = c.id) as 계정
  from public.clients c
 where c.id in ('9f3b960c-0011-4458-aee2-f30418ad27cd',
                'f4e6e9db-ea5e-4c94-8ce2-f00512f5a908',
                'fd1003c8-97f4-48c3-be94-94d0c9d78967');

-- 1) '문제성 발관리센터 메디푸스'(②)의 계약 2건을 문제성발관리센터로 이관 (매출 이력 보존)
update public.client_contracts
   set client_id = '9f3b960c-0011-4458-aee2-f30418ad27cd'
 where client_id = 'f4e6e9db-ea5e-4c94-8ce2-f00512f5a908';

-- 2) '메디푸스'(③)의 브랜드블로그 계약은 그림자(금액·계약일 없음)라 삭제 — 진짜 계약은 ①에 있다(8건·280,000원)
delete from public.client_contracts
 where client_id = 'fd1003c8-97f4-48c3-be94-94d0c9d78967'
   and category = '블로그' and amount is null;
-- 혹시 남은 다른 계약이 있으면 지우지 말고 함께 이관
update public.client_contracts
   set client_id = '9f3b960c-0011-4458-aee2-f30418ad27cd'
 where client_id = 'fd1003c8-97f4-48c3-be94-94d0c9d78967';

-- 3) 브랜드블로그 계정(medifuss) 이관 → 문제성발관리센터
update public.blog_accounts
   set client_id = '9f3b960c-0011-4458-aee2-f30418ad27cd'
 where id = 'ce99937c-106c-4096-8d12-789e2d3b5a80';

-- 4) 브랜드블로그 계약 ↔ 블로그 계정 연결 — 관리시트가 blog_name 으로 짝을 찾는다.
--    8건 전부 처리 완료(사장님 확인 2026-08-13) → 계약·계정 모두 잔여 0 으로 맞춘다.
update public.client_contracts
   set blog_name = '메디푸스',
       remain_count = 0
 where id = 'a31b1f5e-647f-4d42-9de6-4eb1f74607cc';

-- 4-b) 블로그 계정 잔여도 0 (원장에는 5로 남아 있었다 — 실제로는 8건 다 나감)
update public.blog_accounts
   set goal_count = 8,
       remain_count = 0
 where id = 'ce99937c-106c-4096-8d12-789e2d3b5a80';

-- 5) 고객 ERP 계정(ddmkt_medipus@ddmkt.com)도 통합된 업체로
update public.profiles
   set client_id = '9f3b960c-0011-4458-aee2-f30418ad27cd'
 where email = 'ddmkt_medipus@ddmkt.com';

-- 6) 빈 껍데기가 된 '메디푸스' 이름 업체 2개 삭제
--    (위 1~5로 계약·블로그·계정이 전부 옮겨진 뒤여야 한다. 아래 확인 쿼리가 0이면 안전)
select id, company,
       (select count(*) from public.client_contracts ct where ct.client_id = c.id) as 남은계약,
       (select count(*) from public.blog_accounts b where b.client_id = c.id) as 남은블로그,
       (select count(*) from public.profiles p where p.client_id = c.id) as 남은계정
  from public.clients c
 where c.id in ('f4e6e9db-ea5e-4c94-8ce2-f00512f5a908','fd1003c8-97f4-48c3-be94-94d0c9d78967');

delete from public.clients
 where id in ('f4e6e9db-ea5e-4c94-8ce2-f00512f5a908',
              'fd1003c8-97f4-48c3-be94-94d0c9d78967');

-- 7) 최종 확인 — 문제성발관리센터에 계약 14건 · 블로그계정 1 · 고객계정 1
select c.company,
       (select count(*) from public.client_contracts ct where ct.client_id = c.id) as 계약,
       (select count(*) from public.blog_accounts b where b.client_id = c.id) as 블로그계정,
       (select count(*) from public.profiles p where p.client_id = c.id) as 계정
  from public.clients c
 where c.id = '9f3b960c-0011-4458-aee2-f30418ad27cd';

select id, subtype, goal_count, remain_count, amount, blog_name
  from public.client_contracts
 where client_id = '9f3b960c-0011-4458-aee2-f30418ad27cd' and category = '블로그';

select name, blog_url, goal_count, remain_count, client_id
  from public.blog_accounts
 where id = 'ce99937c-106c-4096-8d12-789e2d3b5a80';

-- ※ 이미 위 SQL 을 한 번 실행하신 뒤라면(잔여 5로 들어감) 아래 두 줄만 다시 돌리면 됩니다.
--   update public.client_contracts set remain_count = 0 where id = 'a31b1f5e-647f-4d42-9de6-4eb1f74607cc';
--   update public.blog_accounts set remain_count = 0 where id = 'ce99937c-106c-4096-8d12-789e2d3b5a80';
