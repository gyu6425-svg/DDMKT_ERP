-- 지역 토큰 마스터 — 인기탭 스캔의 '지역 축'을 한 곳에 모은다.
--   왜: 지금은 cafe_region_dong(행정동 GeoJSON 유래)만 쓰는데, 여기엔 역세권·상권·신도시가 없다.
--       실측(2026-08-06) 네일 역세권 적중 57%·신도시 43%, 입주청소 신도시 60% → 놓치면 손실이 크다.
--   kind 별 우선순위로 '좋은 것부터' 스캔하고, 목표 건수를 채우면 멈춘다.
--   Supabase SQL Editor 에서 1회 실행. 적재는 crawler/build_region_token.py.

create table if not exists public.cafe_region_token (
    token       text primary key,          -- 스캔에 쓰는 지역 토큰. 예: '강남' '역삼동' '강남역' '동탄'
    kind        text not null,             -- sido | sigungu | sigungu_suffix | dong | eupmyeon | station | newtown | district
    sido        text,                       -- 소속 시도(있으면)
    gu          text,                       -- 소속 시군구(있으면)
    prio        int  not null default 50,   -- 작을수록 먼저 스캔(실측 적중률 기반)
    dup         int  not null default 1,    -- 같은 이름이 몇 개 지역에 있는지(동명이지) — 2 이상이면 지역 귀속 주의
    source      text,                       -- region_dong | local_api | curated
    active      boolean not null default true,
    updated_at  timestamptz not null default now()
);

create index if not exists cafe_region_token_prio_idx on public.cafe_region_token (active, prio, token);
create index if not exists cafe_region_token_sido_idx on public.cafe_region_token (sido, kind);

alter table public.cafe_region_token enable row level security;

-- 내부 직원만 조회(스캔 설계용 데이터). 크롤러는 service_key 라 RLS 우회.
drop policy if exists cafe_region_token_read on public.cafe_region_token;
create policy cafe_region_token_read on public.cafe_region_token
    for select to authenticated
    using (exists (select 1 from public.profiles pr
                   where pr.user_id = auth.uid() and pr.role in ('admin', 'manager', 'sales')));

comment on table public.cafe_region_token is
    '인기탭 스캔용 지역 토큰 마스터(행정 + 역세권 + 신도시/상권). prio 순으로 스캔, dup>=2 는 동명이지 주의.';

notify pgrst, 'reload schema';
