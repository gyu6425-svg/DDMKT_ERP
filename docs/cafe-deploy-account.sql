-- ============================================================================
-- 카페 배포 접수 '즉시' 등록 — 고객이 접수하기 누르면 본인 cafe_account 생성.
--   → 관리 시트(고객·회사 둘 다)에 즉시 반영. publish_enabled=false 로 강제(자동화발행 탭은 담당자 세팅 후).
--   순위 트래커는 발행된 글이 생기면 크롤러가 자동 등록(접수 때 아무것도 안 함).
-- ⚠️ 공유 DB — main 에서 검토 후 1회 실행. 재실행 안전(drop→create).
-- 전제: cafe-accounts.sql, cafe-customer-rls.sql(고객 본인 읽기), enable-login-rls.sql(my_client_id).
-- ============================================================================
begin;

-- 고객: 본인 client_id 로만 cafe_account 등록. publish_enabled 는 반드시 false(자동화발행 자가승인 차단).
drop policy if exists "cafe_accounts 고객 본인 등록" on public.cafe_accounts;
create policy "cafe_accounts 고객 본인 등록" on public.cafe_accounts
  for insert to authenticated
  with check (
    client_id = public.my_client_id()
    and coalesce(publish_enabled, false) = false
  );

commit;

-- 롤백:
-- begin;
--   drop policy if exists "cafe_accounts 고객 본인 등록" on public.cafe_accounts;
-- commit;
