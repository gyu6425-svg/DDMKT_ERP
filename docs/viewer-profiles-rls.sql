-- ============================================================================
-- 고객 ERP 검색 드롭다운 — 내부(is_internal) 사용자가 viewer 계정 목록을 읽어
--   업체별 로그인 아이디(ddmkt_xxx)를 () 안에 표시하기 위한 SELECT 정책.
--   (대표 김종인은 기존 "profiles owner manage"로 이미 전체 조회 가능. 그 외 내부
--    관리자/매니저도 viewer 행만 읽을 수 있게 추가 — 권한 상승 없음.)
--   Supabase SQL Editor에서 1회 실행.
-- ============================================================================
drop policy if exists "profiles 내부 고객 조회" on public.profiles;
create policy "profiles 내부 고객 조회" on public.profiles
    for select to authenticated
    using (public.is_internal() and lower(coalesce(role, '')) = 'viewer');
