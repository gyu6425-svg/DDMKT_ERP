-- ============================================================================
-- [초안·정합필요] 카페 인기탭 발굴 — 공유 캐시 + 측정 큐
--   백엔드 스캐너 = crawler/cafe_kw_probe.py (다른 세션). 검색량API(차단0) → --target 소량 스크랩.
--   운영 모델: 버튼 → 캐시 우선 반환 → 없으면 큐 → 단일 워커가 --target 처리 → 캐시 write.
--     ★ 고객 버튼이 절대 라이브 스크랩 X (동시다발=차단). 항상 캐시/큐 경유.
--
-- ⚠️ 정합 필요 — 기존 겹침:
--   · docs/keyword-scan-queue.sql = keyword_scan_requests (내 SUB4 기본 큐) + scan_listener.py 워커
--   · 이 파일 cafe_kw_requests = cafe_kw_probe(플레이스·검색량·target) 용 큐
--   → 권장: 워커를 cafe_kw_probe 로 단일화. cafe_kw_requests 를 정식 큐로,
--     cafe_kw_targets 를 공유 결과캐시로. keyword_scan_requests/scan_listener 는 은퇴 또는 흡수.
--   ※ 필드 shape 은 cafe_kw_probe 출력에 맞춰 다른 세션이 최종 확정할 것(아래는 제안).
-- ============================================================================
begin;

-- 1) 공유 결과 캐시 — 키워드별 인기탭 결과(업체 무관·재사용). 스크랩 급감의 핵심.
create table if not exists public.cafe_kw_targets (
    id          uuid primary key default gen_random_uuid(),
    keyword     text not null,                 -- "광교 횟집" (지역+업종)
    has_popular boolean,                        -- 인기탭 O/X
    holders     jsonb,                          -- 인기글 섹션 점유(카페/글 목록)
    pc_vol      int,
    mobile_vol  int,
    total_vol   int,                            -- 검색량(검색광고 API)
    business    text,                           -- 업종
    region      text,                           -- 지역
    source      text default 'scan',            -- scan | precrawl(새벽 미리크롤)
    measured_at timestamptz default now(),
    constraint cafe_kw_targets_keyword_uniq unique (keyword)
);
alter table public.cafe_kw_targets enable row level security;
drop policy if exists "ckt 읽기" on public.cafe_kw_targets;
drop policy if exists "ckt 내부쓰기" on public.cafe_kw_targets;
-- 공유 캐시 — 로그인 사용자 누구나 읽기(키워드는 고객전용 아님). 쓰기=내부(워커는 service key).
create policy "ckt 읽기" on public.cafe_kw_targets
    for select to authenticated using (true);
create policy "ckt 내부쓰기" on public.cafe_kw_targets
    for all to authenticated using (public.is_internal()) with check (public.is_internal());
create index if not exists idx_ckt_keyword on public.cafe_kw_targets (keyword);
create index if not exists idx_ckt_region_biz on public.cafe_kw_targets (region, business);

-- 2) 측정 큐 — 캐시에 없을 때. 워커(cafe_kw_probe)가 --target 으로 직렬 처리.
create table if not exists public.cafe_kw_requests (
    id           uuid primary key default gen_random_uuid(),
    created_at   timestamptz not null default now(),
    client_id    uuid,                           -- 요청 고객(선택)
    place_url    text,                           -- --place 대상(플레이스 주소) 또는
    seed_keyword text,                           -- 키워드 시드
    target       int not null default 20,        -- 그날 스크랩 상한(--target N)
    status       text not null default 'pending',-- pending | processing | done | fail
    result       jsonb,                          -- 발굴 요약(찾은 인기탭 키워드들)
    done_at      timestamptz
);
alter table public.cafe_kw_requests enable row level security;
drop policy if exists "ckr 고객" on public.cafe_kw_requests;
drop policy if exists "ckr 내부" on public.cafe_kw_requests;
create policy "ckr 고객" on public.cafe_kw_requests
    for insert to authenticated with check (client_id = public.my_client_id());
create policy "ckr 고객조회" on public.cafe_kw_requests
    for select to authenticated using (client_id = public.my_client_id() or public.is_internal());
create policy "ckr 내부" on public.cafe_kw_requests
    for all to authenticated using (public.is_internal()) with check (public.is_internal());
create index if not exists idx_ckr_status on public.cafe_kw_requests (status, created_at);

commit;
