-- 지역형 접수용 '고정 행정동 마스터' — 서울/경기/인천 전체 (구/시군구 × 동/읍/면).
--   1회 구축 후 재사용(제품키워드 무관). 적재 = crawler/build_region_dong.py --db (서비스키).
--   지역형 접수: 시도 선택 → 이 표에서 그 동 전부 조회 → 동×제품키워드 후보 → 스캔.
create table if not exists public.cafe_region_dong (
    id    bigint generated always as identity primary key,
    sido  text not null,              -- 서울 | 경기 | 인천
    gu    text not null,              -- 시군구 (강남구, 안산시, 연수구 …)
    dong  text not null,              -- 동/읍/면 (역삼동, 이동, 가평읍 …)
    created_at timestamptz not null default now(),
    unique (sido, gu, dong)
);
create index if not exists cafe_region_dong_sido_idx on public.cafe_region_dong (sido);

alter table public.cafe_region_dong enable row level security;

-- 참조용 공개 데이터 — 로그인 사용자(고객·내부) 모두 읽기 허용. 쓰기는 서비스키(RLS 우회)만.
drop policy if exists "crd 읽기" on public.cafe_region_dong;
create policy "crd 읽기" on public.cafe_region_dong
    for select to authenticated using (true);

comment on table public.cafe_region_dong is '지역형 접수 고정 행정동 마스터(서울/경기/인천). build_region_dong.py 로 적재.';
