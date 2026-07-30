-- ============================================================================
-- cafe_kw_requests 고객 접근 — 인기글 조회(키워드형) UI 연결용.
--   현재 SELECT/INSERT 가 is_internal() 만이라 고객이 자기 요청을 못 넣고 못 읽음.
--   → 고객이 requested_by=auth.uid() 로만 등록·조회하는 정책을 '추가'(기존 내부 정책 유지).
--   워커는 service key(RLS 우회)로 계속 동작.
-- ⚠️ 기존 정책 DROP 안 함(내 이름 'ckq 고객 *' 만 drop→create) → 락아웃 위험 없음. [[rls-lockout-recovery]]
-- ⚠️ main 에서 1회 실행. 재실행 안전.
-- ============================================================================
begin;

drop policy if exists "ckq 고객 insert" on public.cafe_kw_requests;
drop policy if exists "ckq 고객 select" on public.cafe_kw_requests;

-- 고객: 본인(auth.uid()) 요청만 등록. status/target 등 값은 프론트가 채움.
create policy "ckq 고객 insert" on public.cafe_kw_requests
    for insert to authenticated with check (requested_by = auth.uid());
-- 고객: 본인 요청만 조회(폴링).
create policy "ckq 고객 select" on public.cafe_kw_requests
    for select to authenticated using (requested_by = auth.uid());

commit;

-- 롤백:
-- begin;
--   drop policy if exists "ckq 고객 insert" on public.cafe_kw_requests;
--   drop policy if exists "ckq 고객 select" on public.cafe_kw_requests;
-- commit;
