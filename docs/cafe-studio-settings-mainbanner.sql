-- 카페 발행 스튜디오 '값 저장하기'에 상단 메인배너 저장 추가 — cafe_studio_settings.main_banner.
--   기존엔 실사(photos)·끝배너(banners)만 저장돼 메인배너가 저장 안 되던 문제 해결.
alter table public.cafe_studio_settings
    add column if not exists main_banner jsonb;

comment on column public.cafe_studio_settings.main_banner is
    '상단 메인배너 storage 경로 배열(맨 위 1장). 값 저장하기 시 함께 저장·복원.';
