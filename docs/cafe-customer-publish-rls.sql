-- ============================================================================
-- 고객 셀프서비스 카페 발행 — 데이터층(P0)  [작성: sub2 / ★실행: main 에서만]
--   목표: 승인받은 고객(client_id)이 '본인 업체'로만 cafe_publish_queue 에 발행을 넣고,
--         그 고객 PC 에이전트(board 필터)가 집어 발행. 위조(남의 company/board) 차단.
--
-- ⚠️ 공유 DB — 이 파일은 main 에서 검토 후 1회 실행한다. sub2 에서 실행하지 말 것.
-- ⚠️ 재실행 안전(idempotent): 모든 정책 drop→create 한 묶음 + begin/commit(반쪽 RLS 방지).
--    ❌ 정책 DROP 만 따로 돌리지 말 것(RLS-on·정책0 = 전체차단 락아웃, 2026-07-27 사고).
-- 전제: enable-login-rls.sql(is_internal/my_client_id), cafe-accounts.sql, cafe-customer-rls.sql 적용됨.
--   is_internal() 정확정의 유지: client_id IS NULL AND role NOT IN('reporter','viewer').
-- ============================================================================

begin;

-- 1) 승인 플래그 — 이 카페 계정으로 '고객 셀프 발행' 허용 여부. 기본 off(우리가 켜줘야 보임/작동).
alter table public.cafe_accounts
  add column if not exists publish_enabled boolean not null default false;

-- 2) 내가(고객) 발행 가능한 company_key 목록 — active + publish_enabled + 내 client 소유.
create or replace function public.my_publish_companies()
returns setof text language sql security definer set search_path = public as $$
  select company_key from public.cafe_accounts
   where client_id = public.my_client_id() and active and publish_enabled;
$$;

-- 3) company_key → 강제 board_name(위조 차단: 고객이 board 를 임의값으로 못 넣게).
create or replace function public.cafe_board_for(p_company text)
returns text language sql security definer set search_path = public as $$
  select board_name from public.cafe_accounts where company_key = p_company limit 1;
$$;

-- 4) cafe_publish_queue — 고객 INSERT(자기 company + 강제 board) + 본인 큐 SELECT.
--    내부 전체 정책("cpq 내부 전체", is_internal)은 그대로 둔다(직원 발행 무변경).
drop policy if exists "cpq 고객 발행 insert" on public.cafe_publish_queue;
create policy "cpq 고객 발행 insert" on public.cafe_publish_queue
  for insert to authenticated
  with check (
    company in (select public.my_publish_companies())
    and board = public.cafe_board_for(company)     -- board 는 그 company 의 board 로 고정
  );
drop policy if exists "cpq 고객 본인 조회" on public.cafe_publish_queue;
create policy "cpq 고객 본인 조회" on public.cafe_publish_queue
  for select to authenticated
  using (company in (select public.my_publish_companies()));
-- ※ 고객 UPDATE/DELETE 정책은 만들지 않는다(발행 취소·상태변경은 내부만). 에이전트는 내부계정 JWT.

-- 5) 스토리지 cafe-images — 고객은 '자기 company 폴더(<company_key>/...)' 에만 업로드/조회.
--    ⚠️ 프론트가 이미지 경로를 '<company_key>/<jobId>/NN.jpg' 로 올리도록 함께 바꿔야 한다
--       (src/api/cafePublishQueue.ts createCustomerPublishJob — sub2 가 구현). 내부 경로는 무변경.
--    storage.objects 정책과 storage.foldername(name)[1] = 최상위 폴더 = company_key 로 스코프.
drop policy if exists "storage cafe 고객 업로드" on storage.objects;
create policy "storage cafe 고객 업로드" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'cafe-images'
    and (storage.foldername(name))[1] in (select public.my_publish_companies())
  );
drop policy if exists "storage cafe 고객 조회" on storage.objects;
create policy "storage cafe 고객 조회" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'cafe-images'
    and (storage.foldername(name))[1] in (select public.my_publish_companies())
  );

commit;

-- ── 승인(우리가 켜주기) — 예시. 내부 UI 토글로도 가능. ─────────────────────
-- update public.cafe_accounts set publish_enabled = true
--  where company_key = '<그 고객 company>' and client_id = '<그 고객 clients.id>';
-- (전제: 그 cafe_accounts 행에 client_id 가 그 고객으로 연결돼 있어야 고객이 본다.)

-- 롤백:
-- begin;
--   drop policy if exists "cpq 고객 발행 insert" on public.cafe_publish_queue;
--   drop policy if exists "cpq 고객 본인 조회" on public.cafe_publish_queue;
--   drop policy if exists "storage cafe 고객 업로드" on storage.objects;
--   drop policy if exists "storage cafe 고객 조회" on storage.objects;
--   drop function if exists public.my_publish_companies();
--   drop function if exists public.cafe_board_for(text);
--   alter table public.cafe_accounts drop column if exists publish_enabled;
-- commit;
