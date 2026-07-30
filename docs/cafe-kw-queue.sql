-- =====================================================================
-- 카페 인기탭 발굴 — 공유 큐 + 공유 캐시 (분산 워커 조율용)
-- 배경: 여러 PC 워커가 각자 자기 IP로 인기탭을 스캔하되, ① 작업(큐)을 원자적으로
--       나눠 갖고(중복 스캔 방지) ② 결과를 공유 캐시에 쌓아(겹치는 키워드 재스크랩 0)
--       고객ERP·우리 모두 캐시만 읽게 한다.
-- 실행: Supabase SQL Editor. (RLS는 service_role/내부만 쓰기, 조회는 내부 읽기.)
-- =====================================================================

-- 1) 요청 큐 — 고객/우리가 "이 플레이스 인기탭 조회해줘"를 넣는 곳.
create table if not exists public.cafe_kw_requests (
    id           bigint generated always as identity primary key,
    place_url    text not null,              -- 네이버 플레이스 URL 또는 placeId
    place_id     text,                        -- 해석된 placeId(워커가 채움)
    biz_name     text,                        -- 업체명(워커가 채움)
    target       int  not null default 10,    -- 찾을 인기탭 건수(--target)
    deploy_type  text,                        -- '지역형'|'키워드형'. 지역형=자기지역×업종, 키워드형=제품니치(지역배제). null=지역형
    regions      text,                        -- 지역 제약(예: '서울,경기,인천'), 서비스형(청소 등)만 의미. 맛집/키워드형은 무시됨
    status       text not null default 'queued',  -- queued/claimed/done/failed
    worker_id    text,                        -- 처리 중인 워커(원자적 클레임)
    claimed_at   timestamptz,
    result       jsonb,                       -- 발견 인기탭 키워드 목록(워커가 채움)
    note         text,
    requested_by uuid,                        -- 요청 고객/직원(profiles.id)
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);
create index if not exists cafe_kw_requests_status_idx on public.cafe_kw_requests (status, created_at);

-- 1-b) 기존 테이블에 deploy_type 추가(멱등) — 이미 만들어진 큐에도 컬럼 반영.
alter table public.cafe_kw_requests add column if not exists deploy_type text;

-- 2) 공유 캐시 — 키워드별 인기탭 판정 결과(모든 워커·고객 공유). 겹치는 키워드 재스크랩 방지.
create table if not exists public.cafe_kw_targets (
    keyword      text primary key,            -- 정규화 키워드(예: '수원 입주청소')
    has_section  boolean not null default false,  -- 인기탭(인기글 섹션) 있음?
    theme        text,                        -- '맛집 인기글' 등
    verdict      text,                        -- 카페분산(기회)/카페독점/섹션없음
    volume       int,                         -- 검색광고 검색량(있으면)
    cafes        jsonb,                       -- 점유 카페 [{rank,who,article}]
    scanned_by   text,                        -- 어느 워커가 스캔
    scanned_at   timestamptz not null default now()
);
create index if not exists cafe_kw_targets_scanned_idx on public.cafe_kw_targets (scanned_at);

-- 3) 원자적 클레임 RPC — 두 워커가 같은 요청을 동시에 잡지 않게(한 행만 '이긴다').
create or replace function public.claim_kw_request(p_worker text)
returns setof public.cafe_kw_requests
language sql
as $$
    update public.cafe_kw_requests r
       set status = 'claimed', worker_id = p_worker, claimed_at = now(), updated_at = now()
     where r.id = (
         select id from public.cafe_kw_requests
          where status = 'queued'
          order by created_at
          for update skip locked
          limit 1
     )
    returning r.*;
$$;

-- 4) RLS — 내부(직원)만 읽기, 쓰기는 service_role(워커). 고객 요청 INSERT는 앱에서 처리.
alter table public.cafe_kw_requests enable row level security;
alter table public.cafe_kw_targets  enable row level security;
drop policy if exists cafe_kw_req_read on public.cafe_kw_requests;
create policy cafe_kw_req_read on public.cafe_kw_requests for select using (public.is_internal());
drop policy if exists cafe_kw_tgt_read on public.cafe_kw_targets;
create policy cafe_kw_tgt_read on public.cafe_kw_targets for select using (public.is_internal());
-- (INSERT/UPDATE/DELETE는 service_role 키가 RLS 우회 — 워커/서버가 담당)

notify pgrst, 'reload schema';
