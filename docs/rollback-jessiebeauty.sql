-- 제시뷰티 — 이월 재계약 되돌리기(잔여 2건 상태로 복구) 2026-08-13
--
-- 현재 상태(실측):
--   client_contracts f218e306  브랜드 블로그 · 목표 24 · 잔여 0 · note '[만료] [2건 이월]'
--   blog_accounts    8819dfe7  제시뷰티 · 목표 26 · 잔여 26      ← 이월 재계약(24+2)이 반영된 값
--   ※ 재계약으로 생성됐던 새 계약 카드는 이미 삭제된 상태(계약 행이 1개뿐).
--
-- 되돌린 뒤: 브랜드 블로그 24건 · 잔여 2 · 만료 표시 없음(= 아까 그 화면), 블로그 계정도 24/2.
-- 실행: Supabase > SQL Editor. 재실행해도 안전.

-- 0) 실행 전 확인
select id, subtype, goal_count, remain_count, contract_date, note
  from public.client_contracts
 where client_id = '1b0784c3-10fb-496c-aefd-ad9594628aa8';
select id, name, goal_count, remain_count
  from public.blog_accounts
 where client_id = '1b0784c3-10fb-496c-aefd-ad9594628aa8';

-- 1) 계약 복구 — 잔여 2건 · 만료/이월 마커 제거(카드 블러 해제, 재계약 버튼 복귀)
update public.client_contracts
   set remain_count = 2,
       note = null
 where id = 'f218e306-254f-4e46-874c-67982923504b';

-- 2) 블로그 계정 복구 — 이월분(+2)이 더해진 26/26 을 원래 24/2 로
update public.blog_accounts
   set goal_count = 24,
       remain_count = 2
 where id = '8819dfe7-6c63-4976-90d0-e1b8932c798f';

-- 3) (안전장치) 혹시 재계약으로 만든 새 계약 카드가 아직 남아 있다면 확인용 — 있으면 수동 삭제
select id, subtype, goal_count, remain_count, contract_date, note
  from public.client_contracts
 where client_id = '1b0784c3-10fb-496c-aefd-ad9594628aa8'
   and note like '%[재계약]%';

-- 4) 확인 — 계약 24/잔여 2·note 없음 / 블로그 24·2
select id, subtype, goal_count, remain_count, contract_date, note
  from public.client_contracts
 where client_id = '1b0784c3-10fb-496c-aefd-ad9594628aa8';
select id, name, goal_count, remain_count
  from public.blog_accounts
 where client_id = '1b0784c3-10fb-496c-aefd-ad9594628aa8';
