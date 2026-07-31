-- 지역형 접수 제품키워드 칩 — 고객이 접수 시 넣는 제품키워드 여러 개(입주청소·상가청소 …).
--   우리가 이 값으로 '동/구 × 제품키워드' 인기탭 선수집·발행 대상을 잡는다.
alter table public.cafe_deploy_requests
    add column if not exists product_keywords jsonb;

comment on column public.cafe_deploy_requests.product_keywords is
    '지역형 고객 제품키워드 칩 배열(예: ["입주청소","상가청소"]). 선수집·발행 대상 기준.';
