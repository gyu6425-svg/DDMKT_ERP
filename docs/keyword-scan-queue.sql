-- ─────────────────────────────────────────────────────────────
-- 인기탭 발굴 스캔 큐 (웹 '키워드 찾기' 버튼 → SUB4 스캔 리스너)
--   measure_requests 와 동일 패턴. 프론트가 pending 으로 INSERT,
--   SUB4 의 scan_listener.py 가 SERVICE_KEY 로 폴링→스캔→results 채움.
--   Supabase SQL Editor 에서 1회 실행. (멱등 — 재실행 안전)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.keyword_scan_requests (
    id           uuid primary key default gen_random_uuid(),
    created_at   timestamptz not null default now(),
    keywords     jsonb not null,                       -- ["부천 입주청소","안양 입주청소",...]
    status       text  not null default 'pending',     -- pending | processing | done | fail
    results      jsonb,                                 -- {"부천 입주청소":"O","안양 입주청소":"X",...}
    note         text,                                  -- 요청 메모(테마/지역 등, 선택)
    requested_by uuid,                                  -- 요청자(선택)
    done_at      timestamptz
);

alter table public.keyword_scan_requests enable row level security;

-- 내부 로그인 사용자면 insert/select 허용(measure_requests 와 동일 정책).
--   리스너(SUB4)는 SERVICE_KEY 로 접근 → RLS 우회하므로 update 정책 불필요.
drop policy if exists "ksr insert" on public.keyword_scan_requests;
drop policy if exists "ksr select" on public.keyword_scan_requests;
create policy "ksr insert" on public.keyword_scan_requests
    for insert to authenticated with check (true);
create policy "ksr select" on public.keyword_scan_requests
    for select to authenticated using (true);

-- pending 빠른 조회용 인덱스(리스너 폴링).
create index if not exists idx_ksr_status_created
    on public.keyword_scan_requests (status, created_at);
