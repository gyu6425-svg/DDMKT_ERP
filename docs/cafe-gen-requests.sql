-- 카페 발행 요청 큐 — main(웹)이 finder로 '검증된 발행 대상'을 적재 → 각 발행 PC 제너레이터가 읽어
--   자기 양식(make_and_queue)으로 원고·이미지 생성 → cafe_publish_queue → 게시.
--   * 원고/이미지 생성은 PC에서만(OpenAI+로컬자산). main은 '무엇을 발행할지'만 넘긴다.
create table if not exists public.cafe_gen_requests (
    id          uuid primary key default gen_random_uuid(),
    created_at  timestamptz not null default now(),
    company     text not null,            -- 발행 업체키: theman | seolgo | durban | leak3 …
    business    text,                     -- 더반 업종(입주청소/이사청소/상가청소/청소업체/사무실청소). 그 외 null
    region      text not null,            -- 지역/동 (금천 · 개포동 …) — 제너레이터가 이 값으로 배너·본문 생성
    keyword     text,                     -- 선택한 전체 키워드(예: 금천 사설경호) — 추적·중복대조용
    board       text,                     -- 게시판명(정확일치) — PC가 매니페스트 board 블록에 그대로 사용
    popular_verified boolean not null default true,  -- main finder 인기탭 검증됨(PC 차단가드 통과 근거)
    status      text not null default 'pending',     -- pending | claimed | done | fail
    claimed_by  text,                     -- 처리 PC(sub1/sub2) 식별
    claimed_at  timestamptz,
    done_at     timestamptz,
    reason      text,                     -- 실패 사유
    queue_job_id text                     -- 생성된 cafe_publish_queue job id(추적)
);
create index if not exists cgr_company_status_idx on public.cafe_gen_requests (company, status, created_at);

alter table public.cafe_gen_requests enable row level security;
-- 내부(담당자)만 적재·조회. PC 제너레이터는 서비스키(RLS 우회)로 폴링.
drop policy if exists "cgr 내부" on public.cafe_gen_requests;
create policy "cgr 내부" on public.cafe_gen_requests
    for all to authenticated using (public.is_internal()) with check (public.is_internal());

comment on table public.cafe_gen_requests is 'main 웹→발행PC 발행요청 큐. company로 라우팅, PC가 make_and_queue로 생성·게시.';
