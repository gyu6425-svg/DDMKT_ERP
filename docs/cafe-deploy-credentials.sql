-- ============================================================================
-- 카페 배포 발행 정보 + 네이버 계정(민감) — 모델 B(우리가 대신 발행)
--   비민감(카페명/게시판/글쓰기URL/2단계) = cafe_deploy_requests 컬럼.
--   민감(네이버 아이디/비번) = 별도 테이블 cafe_deploy_credentials(마스킹·접근제한).
--     ⚠️ 자동 로그인에 써야 하므로 사용 가능한 형태로 보관(단방향 암호화 아님).
--       UI 는 ••••로 마스킹, RLS 로 접근 제한. 발행 에이전트는 service key 로 사용.
-- ⚠️ 공유 DB — main 에서 검토 후 1회 실행. 재실행 안전(begin/commit + drop→create).
-- 전제: enable-login-rls.sql(is_internal/my_client_id), cafe-deploy-requests.sql 적용됨.
-- ============================================================================
begin;

-- 1) 접수에 발행 설정(비민감) 추가
alter table public.cafe_deploy_requests
  add column if not exists cafe_name  text,   -- 발행 카페명
  add column if not exists board_name text,   -- 발행 게시판
  add column if not exists write_url  text,   -- 글쓰기 주소(club_id 포함)
  add column if not exists two_factor boolean default false; -- 네이버 2단계 인증 여부

-- 2) 네이버 계정(민감) 별도 테이블
create table if not exists public.cafe_deploy_credentials (
    id                uuid primary key default gen_random_uuid(),
    created_at        timestamptz not null default now(),
    client_id         uuid,                 -- 고객
    deploy_request_id uuid,                 -- 연결된 접수 건(선택)
    naver_id          text,                 -- 네이버 아이디
    naver_pw          text,                 -- 네이버 비번(민감) — UI 마스킹, 에이전트 사용
    note              text
);

alter table public.cafe_deploy_credentials enable row level security;

drop policy if exists "cdc 고객 insert" on public.cafe_deploy_credentials;
drop policy if exists "cdc 고객 select" on public.cafe_deploy_credentials;
drop policy if exists "cdc 내부 select" on public.cafe_deploy_credentials;
drop policy if exists "cdc 내부 update" on public.cafe_deploy_credentials;

-- 고객: 본인 client_id 로만 등록 + 본인 것만 조회(단, UI 에서 비번 마스킹).
create policy "cdc 고객 insert" on public.cafe_deploy_credentials
    for insert to authenticated with check (client_id = public.my_client_id());
create policy "cdc 고객 select" on public.cafe_deploy_credentials
    for select to authenticated using (client_id = public.my_client_id());
-- 내부(관리자/담당자): 전체 조회·수정(세팅용). 발행 에이전트는 service key(RLS 우회)로 사용.
create policy "cdc 내부 select" on public.cafe_deploy_credentials
    for select to authenticated using (public.is_internal());
create policy "cdc 내부 update" on public.cafe_deploy_credentials
    for update to authenticated using (public.is_internal()) with check (public.is_internal());

create index if not exists idx_cdc_client on public.cafe_deploy_credentials (client_id, created_at desc);

commit;

-- 롤백:
-- begin;
--   drop table if exists public.cafe_deploy_credentials;
--   alter table public.cafe_deploy_requests
--     drop column if exists cafe_name, drop column if exists board_name,
--     drop column if exists write_url, drop column if exists two_factor;
-- commit;
