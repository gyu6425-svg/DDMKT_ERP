-- 카페 자동발행 '네이버 로그인' 버튼 이력 — 로그인 성공 시각 저장(버튼 색 표시용).
--   있으면 버튼이 '✓ 네이버 로그인됨(재로그인)' 초록 아웃라인으로 바뀜. Supabase SQL Editor 1회 실행.
alter table public.cafe_studio_settings add column if not exists naver_login_at timestamptz;
