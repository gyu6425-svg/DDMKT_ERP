-- ============================================================================
-- 고객 ERP 플레이스 순위 — 고객(viewer)이 '본인 업체(client_id)'의 플레이스 순위만 조회.
--   내부(is_internal) 정책은 그대로 두고, viewer SELECT 정책만 추가(권한 상승 없음, 본인 것만).
--   Supabase SQL Editor에서 1회 실행. my_client_id(): 로그인 뷰어의 client_id (customer-portal-rls.sql 정의).
-- ============================================================================

-- place_accounts: 본인 업체 것만 조회
drop policy if exists "place_accounts 고객 본인 조회" on public.place_accounts;
create policy "place_accounts 고객 본인 조회" on public.place_accounts
    for select to authenticated
    using (client_id = public.my_client_id());

-- place_keywords: 본인 업체 account 에 속한 키워드만 조회
drop policy if exists "place_keywords 고객 본인 조회" on public.place_keywords;
create policy "place_keywords 고객 본인 조회" on public.place_keywords
    for select to authenticated
    using (
        exists (
            select 1 from public.place_accounts a
            where a.id = place_keywords.place_account_id
              and a.client_id = public.my_client_id()
        )
    );
