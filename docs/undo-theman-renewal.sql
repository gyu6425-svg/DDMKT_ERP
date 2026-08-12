-- 더맨시스템 '카페 배포' 재계약 되돌리기 (2026-08-12) — 잘못 눌러 생긴 재계약 2건 취소.
--
-- 지금 상태(실측):
--   32a556f2  카페 배포 50건 / 잔여 0  · 2026-07-10 · note '[만료]'          ← 원래 계약
--   5611b7af  카페 배포 50건 / 잔여 0  · 2026-08-12 · note '[만료] [재계약]'  ← 잘못 누른 1차
--   a4ff4654  카페 배포 100건 / 잔여 100 · 2026-08-12 · note '[재계약]'       ← 잘못 누른 2차
--   토큰 잔액 154 (재계약으로 +50, +100 들어감. 원래 4)
--
-- 되돌린 뒤: 원래 계약 1건만 남고 [만료] 마커가 지워져 카드에 '재계약' 버튼이 다시 뜬다. 토큰 4로 복귀.
-- 실행: Supabase > SQL Editor 에 통째로 붙여넣기. 재실행해도 안전(멱등).

-- 0) 실행 전 확인
select id, subtype, goal_count, remain_count, contract_date, note
  from public.client_contracts
 where client_id = 'deb9d873-34f8-4a54-a207-58480ff18c02' and category = '카페'
 order by contract_date;

-- 1) 잘못 만든 재계약 계약 2건 삭제
delete from public.client_contracts
 where id in ('5611b7af-3ba1-4ded-9916-56e3fd002ee0',
              'a4ff4654-1d72-4367-a573-bd97b5254ef2');

-- 2) 원래 계약의 '[만료]' 마커 제거 → 카드 블러 해제 + '재계약' 버튼 복귀
update public.client_contracts
   set note = null
 where id = '32a556f2-b310-43fe-9dda-21bf00c39ae9';

-- 3) 재계약이 넣은 토큰(+50, +100) 회수 — 그 두 줄만 정확히 지운다(다른 이력은 보존)
delete from public.cafe_tokens
 where client_id = 'deb9d873-34f8-4a54-a207-58480ff18c02'
   and note like '재계약 2026-08-12%';

-- 4) 실행 후 확인 — 계약은 32a556f2 한 줄(note 비어 있음), 토큰 잔액 4
select id, subtype, goal_count, remain_count, contract_date, note
  from public.client_contracts
 where client_id = 'deb9d873-34f8-4a54-a207-58480ff18c02' and category = '카페';
select coalesce(sum(delta), 0) as 토큰잔액
  from public.cafe_tokens
 where client_id = 'deb9d873-34f8-4a54-a207-58480ff18c02';
