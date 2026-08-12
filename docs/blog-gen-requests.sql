-- 블로그 발행 요청 큐 — 카페 cafe_gen_requests 미러. (블로그 자동발행 = 카페 구조 그대로 + 원고만 현장 사례형)
--   웹(스튜디오)이 키워드 파인더로 대상 적재 → SUB1 폴러가 읽어 case-study 원고 생성 → blog_save_queue → 리스너 임시저장.
--   * 원고 생성은 SUB1(또는 배포 API)에서. 웹은 '무엇을 쓸지(키워드)'만 넘긴다.
--   전제: is_internal() (docs/_RUN_ALL.sql). SUB1 폴러는 서비스키(RLS 우회)로 폴링.
--   ⚠️ 전부 additive — 기존 스키마/카페 테이블 수정 없음.
create table if not exists public.blog_gen_requests (
    id           uuid primary key default gen_random_uuid(),
    created_at   timestamptz not null default now(),
    blog_account_id uuid references public.blog_accounts(id) on delete set null,
    blog_id      text not null,          -- 네이버 블로그 아이디(발행 대상)
    keyword      text not null,          -- 전체 키워드(예: 안양 누수탐지)
    region       text,                   -- 지역(안양) — 큰키워드와 조합 추적·중복대조용
    subject_type text,                   -- 대상/현장 유형(선택)
    status       text not null default 'pending',  -- pending | claimed | done | fail
    claimed_by   text,                   -- 처리 PC(sub1) 식별
    claimed_at   timestamptz,
    done_at      timestamptz,
    reason       text,                   -- 실패 사유
    queue_job_id text                    -- 생성된 blog_save_queue job id(추적)
);
create index if not exists bgr_blog_status_idx on public.blog_gen_requests (blog_id, status, created_at);
-- 같은 블로그 같은 키워드 중복 적재 방지(활성 상태만) — 카페처럼 미사용 키워드 순환.
create unique index if not exists bgr_dedup_idx on public.blog_gen_requests (blog_id, keyword)
    where status in ('pending', 'claimed', 'done');

alter table public.blog_gen_requests enable row level security;
drop policy if exists "bgr 내부" on public.blog_gen_requests;
create policy "bgr 내부" on public.blog_gen_requests
    for all to authenticated using (public.is_internal()) with check (public.is_internal());
