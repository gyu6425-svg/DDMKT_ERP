-- 예약 발행건에 사진 고정(스냅샷) — cafe_gen_requests 에 이미지 경로 3종 추가
--
-- 왜 필요한가 (실측 2026-08-14)
--   예약 발행 행(cafe_gen_requests)에는 company·client_id·region·keyword·scheduled_at 만 들어간다.
--   사진은 SUB2 가 '그 건을 실제로 처리하는 순간' cafe_studio_settings 에서 읽는다.
--   cafe_studio_settings 는 client_id 당 1행이라, 사진을 바꿔 저장하면
--   아직 발행 안 된 '먼저 걸어둔 예약'까지 전부 새 사진으로 나간다.
--   → 날짜별로 다른 사진을 예약할 방법이 지금은 없다.
--
-- 계약
--   값 형식은 cafe_studio_settings 의 같은 이름 컬럼과 100% 동일(R2 저장 경로 배열).
--     예: ["studio-settings/<client_id>/photos_0_msr5vrxr-dpnze8.jpg", ...]
--     조회 URL = /api/img/cafe-images/<path>   (지금 쓰는 방식 그대로)
--   NULL = '스냅샷 없음' → SUB2 는 기존대로 cafe_studio_settings 를 읽는다(하위호환).
--   []   = '사진 없음이 의도' → 설정으로 폴백하면 안 된다.
--
-- 안전
--   · 전부 nullable. SUB2 가 아직 안 고쳐도 동작은 지금과 100% 동일하다(배포 순서 무관).
--   · R2 업로드는 매번 고유 파일명(stamp)이라 덮어쓰기가 없다 → 예약 시점 경로는 나중에도 유효.
--   · 여러 번 실행해도 안전(if not exists).

alter table public.cafe_gen_requests add column if not exists photos      jsonb;
alter table public.cafe_gen_requests add column if not exists banners     jsonb;
alter table public.cafe_gen_requests add column if not exists main_banner jsonb;

comment on column public.cafe_gen_requests.photos      is '예약 시점 실사 사진 경로 스냅샷(R2). NULL=cafe_studio_settings 사용';
comment on column public.cafe_gen_requests.banners     is '예약 시점 끝 배너 경로 스냅샷(R2). NULL=cafe_studio_settings 사용';
comment on column public.cafe_gen_requests.main_banner is '예약 시점 상단 배너 경로 스냅샷(R2). NULL=cafe_studio_settings 사용';

-- 확인 — 아래 3행이 나오면 적용 완료.
--   select column_name, data_type from information_schema.columns
--    where table_name = 'cafe_gen_requests' and column_name in ('photos','banners','main_banner');
