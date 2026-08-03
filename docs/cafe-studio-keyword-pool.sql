-- 모델B 일별 발행 — 계약 키워드 풀 저장. 매일 스타일+건수로 '미사용' 키워드만 골라 발행요청.
alter table public.cafe_studio_settings
    add column if not exists keyword_pool jsonb,
    add column if not exists product_kw text;

comment on column public.cafe_studio_settings.keyword_pool is
    '계약 키워드 풀(배열). 발행 상태는 cafe_gen_requests.status 로 판별(done=발행됨).';
