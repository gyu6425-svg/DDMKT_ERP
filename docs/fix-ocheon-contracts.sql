-- 오천T&C 블로그 계약 정리 2026-08-14
--
-- 실측한 현재 상태:
--   ① 12a594ed  브랜드블로그 유료이미지 · 4건 · 140,000원 · 2026-06-09 · 진행이력 4건(2+2) · 외주 0원
--   ② 562513a8  브랜드 블로그      · 4건 · 100,000원 · 2026-06-09 · note '[만료]' · 외주 32,000원
--                └ 진행이력 12건 = 자기 몫 4건(2+2) + 기자단 승인 8건(rpt-*, 7/20~8/03)  ← 잘못 쌓임
--   ③ 472ee769  브랜드 블로그      · 8건 · 240,000원 · 2026-07-14 · note '[재계약]' · 잔여 8 · 진행이력 0
--
-- 왜 이렇게 됐나: 기자단 승인 계상(bookContractCredit)이 계약을 '생성순 + blog_name 일치'로 골라서
--   재계약으로 만료된 ②가 먼저 잡혔다. ②는 잔여가 이미 0이라 카운트는 안 줄고 로그만 8건 쌓였고,
--   정작 진행 중인 ③은 0/8 로 남았다. 코드는 커밋에서 수정(만료 제외 + 잔여 있는 계약 우선).
--
-- 이 스크립트가 하는 일(사장님 지시):
--   A) 기자단 승인 8건(rpt-*)을 ③으로 옮기고 ③을 8/8 완료로  → 100% · 잔여 외주 0원
--   B) ①+② 를 ② 하나로 통합 → 8건 · 240,000원 · 8/8 · '[만료]'(계약 만료 표시), ① 삭제
--      외주비는 8건 × 8,000원 = 64,000원으로 맞춘다(①이 0원으로 비어 있었음 → 6월 외주비 +32,000원).
--
-- 실행: Supabase > SQL Editor. 재실행해도 안전(가드 있음).

-- 0) 실행 전 확인
select id, subtype, goal_count, remain_count, amount, outsource, note,
       jsonb_array_length(coalesce(weekly_logs, '[]'::jsonb)) as logs
  from public.client_contracts
 where client_id = '84d1147d-324c-4b60-8de3-d71b9f37cc69'
 order by created_at;

-- A) 기자단 승인 8건(rpt-*)을 7월 계약(③)으로 이동 + 8/8 완료 처리
--    exists 가드 — 이미 옮겼으면 아무것도 하지 않는다(로그를 빈 배열로 덮어쓰는 사고 방지).
update public.client_contracts c
   set weekly_logs = coalesce((
           select jsonb_agg(l)
             from public.client_contracts o, jsonb_array_elements(o.weekly_logs) l
            where o.id = '562513a8-ffde-48b1-889f-9caef85019ab'
              and l->>'week' like 'rpt-%'
       ), '[]'::jsonb),
       remain_count = 0
 where c.id = '472ee769-bbc9-4a60-9a8a-174428b3552d'
   and exists (
        select 1 from public.client_contracts o, jsonb_array_elements(o.weekly_logs) l
         where o.id = '562513a8-ffde-48b1-889f-9caef85019ab' and l->>'week' like 'rpt-%');

-- B-1) 6월 계약 통합 — ②에 ①을 흡수. 진행이력은 ②의 비-기자단 4건 + ①의 4건 = 8건.
--      goal_count = 4 가드 — 이미 통합됐으면(8) 건너뛴다.
update public.client_contracts c
   set goal_count    = 8,
       remain_count  = 0,
       amount        = 240000,   -- 100,000 + 140,000
       unit_price    = 30000,    -- 240,000 / 8
       unit_outsource = 8000,
       outsource     = 64000,    -- 8건 × 8,000 (①이 0원으로 비어 있었음)
       note          = '[만료]',
       weekly_logs   = (
           select coalesce(jsonb_agg(l), '[]'::jsonb) from (
               select l from public.client_contracts o, jsonb_array_elements(o.weekly_logs) l
                where o.id = '562513a8-ffde-48b1-889f-9caef85019ab'
                  and l->>'week' not like 'rpt-%'
               union all
               select l from public.client_contracts p, jsonb_array_elements(p.weekly_logs) l
                where p.id = '12a594ed-064d-4442-b770-bf254266821d'
           ) t)
 where c.id = '562513a8-ffde-48b1-889f-9caef85019ab'
   and c.goal_count = 4;

-- B-2) 흡수된 유료이미지 계약 삭제
delete from public.client_contracts
 where id = '12a594ed-064d-4442-b770-bf254266821d';

-- 확인 — 계약 2건만 남고 둘 다 8/8
--   562513a8: 8건 · 240,000원 · 잔여 0 · '[만료]'  → 카드 '계약 만료' · 100%
--   472ee769: 8건 · 240,000원 · 잔여 0 · '[재계약]' → 카드 100% · 잔여 외주 0원
--   ※ 472ee769 는 기자단 입금 미처리 2건(8/03 문경·안동)이 남아 있어 '재계약' 버튼은 아직 안 뜬다.
--     승인내역에서 그 2건을 입금 처리하면 계약 완료 + 재계약 버튼이 나온다.
select id, subtype, goal_count, remain_count, amount, outsource, unit_price, note,
       jsonb_array_length(coalesce(weekly_logs, '[]'::jsonb)) as logs,
       (select coalesce(sum((l->>'count')::int), 0)
          from jsonb_array_elements(coalesce(weekly_logs, '[]'::jsonb)) l) as log_count_sum
  from public.client_contracts
 where client_id = '84d1147d-324c-4b60-8de3-d71b9f37cc69'
 order by created_at;
