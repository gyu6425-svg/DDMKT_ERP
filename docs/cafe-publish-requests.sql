-- 카페 자동발행 '승인 요청' — 고객이 신청 → 내부가 등록/승인/거절. (src/api/cafeRequests.ts 대응)
--   Supabase > SQL Editor 1회 실행. is_internal()/my_client_id() 는 이미 배포됨(enable-login-rls.sql).

create table if not exists public.cafe_publish_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_id uuid not null references public.clients(id) on delete cascade,
  cafe_name text,
  cafe_url text,
  board_name text,
  business text,
  note text,
  status text not null default 'pending',    -- pending | done | rejected
  handled_at timestamptz
);
create index if not exists cafe_publish_requests_status_idx
  on public.cafe_publish_requests(status, created_at);

alter table public.cafe_publish_requests enable row level security;

-- 내부(직원): 전체 조회·처리(승인/거절)
drop policy if exists "cpr 내부 전체" on public.cafe_publish_requests;
create policy "cpr 내부 전체" on public.cafe_publish_requests
  for all to authenticated using (public.is_internal()) with check (public.is_internal());

-- 고객: 본인 업체로만 신청 insert (위조 차단 — client_id = my_client_id)
drop policy if exists "cpr 고객 신청" on public.cafe_publish_requests;
create policy "cpr 고객 신청" on public.cafe_publish_requests
  for insert to authenticated with check (client_id = public.my_client_id());

-- 고객: 본인 신청만 조회
drop policy if exists "cpr 고객 본인 조회" on public.cafe_publish_requests;
create policy "cpr 고객 본인 조회" on public.cafe_publish_requests
  for select to authenticated using (client_id = public.my_client_id());
