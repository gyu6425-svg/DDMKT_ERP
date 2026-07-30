-- 카페 배포 접수: 고객이 '정확 인기탭 분석'에서 골라 전달하는 키워드(발행 대상) 저장.
--   형태: jsonb 배열 [{ "keyword": "...", "volume": 123, "theme": "맛집 인기글" }, ...]
--   멱등(IF NOT EXISTS). 기존 접수 행은 NULL 유지.
alter table public.cafe_deploy_requests
    add column if not exists selected_keywords jsonb;

comment on column public.cafe_deploy_requests.selected_keywords is
    '고객이 인기탭 분석에서 고른 발행 대상 키워드 배열 [{keyword,volume,theme}]';
