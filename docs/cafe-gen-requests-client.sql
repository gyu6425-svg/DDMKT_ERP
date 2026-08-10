-- 신규 업체(모델B: 고객 자기 카페·자기 계정) 발행요청용 — cafe_gen_requests 에 client_id 추가.
--   고정업체(더반/누수 등)는 우리 카페라 client_id 불필요(null). 신규 업체는 이 값으로 SUB2 가
--   cafe_deploy_credentials(고객 네이버 계정)·cafe_accounts(고객 카페/게시판)를 조회해 대신발행한다.
alter table public.cafe_gen_requests
    add column if not exists client_id uuid;

create index if not exists cgr_client_status_idx on public.cafe_gen_requests (client_id, status, created_at);

comment on column public.cafe_gen_requests.client_id is
    '신규 업체(모델B) 식별. 있으면 SUB2 가 이 client 의 고객 계정/카페로 대신발행. 고정업체는 null.';
