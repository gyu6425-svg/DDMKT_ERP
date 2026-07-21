-- 카페 자동발행 대기열 — 웹 '카페 발행' 버튼이 적재 → 로컬 데몬(publish_listener.py)이 폴링해
--   스마트에디터로 이미지 순서대로 + 본문 발행. 카카오 report_send_requests와 동형(내부 전용).
-- 전제: enable-login-rls.sql / reporter-erp-rls.sql (is_internal 강화판) 적용.

create table if not exists public.cafe_publish_queue (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    title text not null,
    club_id text,                              -- 카페 clubid(예: demolish0812의 숫자 id)
    menu_id text,                              -- 게시판 menuid
    manifest jsonb not null default '[]',      -- [{type:'image',url} | {type:'text',text}] 게시 순서(위→아래)
    status text not null default 'pending',    -- pending | processing | done | fail
    posted_url text,                           -- 발행된 글 URL(검증 후 기록)
    reason text,                               -- 실패 사유
    scheduled_at timestamptz,                  -- 예약/간격 제어(선택)
    done_at timestamptz
);
create index if not exists cpq_status_idx on public.cafe_publish_queue (status, created_at);
alter table public.cafe_publish_queue enable row level security;

drop policy if exists "cpq 내부 전체" on public.cafe_publish_queue;
create policy "cpq 내부 전체" on public.cafe_publish_queue
    for all to authenticated
    using (public.is_internal()) with check (public.is_internal());

-- 카페 발행용 이미지 버킷(private) — 웹이 생성 이미지 업로드, 로컬 데몬(service_role)이 다운로드.
insert into storage.buckets (id, name, public)
values ('cafe-images', 'cafe-images', false)
on conflict (id) do nothing;

drop policy if exists "storage cafe 내부" on storage.objects;
create policy "storage cafe 내부" on storage.objects
    for all to authenticated
    using (bucket_id = 'cafe-images' and public.is_internal())
    with check (bucket_id = 'cafe-images' and public.is_internal());

-- ── 발행 중복/좀비 방어 (2026-07-21, 독립검증) ────────────────────────────
--   claimed_at: 워커가 processing 으로 집은 시각. 청소기가 좀비(중단된 processing)를 판별하는 근거.
--   attempts  : 원고성 일시오류 재시도 횟수. CAFE_MAX_ATTEMPTS(기본 3) 넘으면 fail.
--   상태값에 'posted' 추가(등록 클릭됨·done 확정 전) — CHECK 제약 없어 별도 DDL 불필요.
--   ⚠️ 새 PC 설치 시 반드시 이 두 줄을 Supabase 편집기에서 1회 실행할 것(없으면 리스너가 claim 단계에서 실패).
alter table public.cafe_publish_queue
  add column if not exists attempts   int not null default 0,
  add column if not exists claimed_at timestamptz;
-- 롤백: alter table public.cafe_publish_queue drop column attempts, drop column claimed_at;

-- ── 멀티 PC 라우팅 (2026-07-21, 독립검증) ──────────────────────────────────
--   company: 어느 업체 작업인가(theman|seolgo|leak…). NULL=레거시 누수(company 없이 적재된 기존 행).
--   region/keyword: 자동발행 대상·같은 지역 재발행 중복방지용.
--   ⚠️ 순서 중요 — 컬럼을 먼저 add 한 뒤 인덱스를 만든다(인덱스가 company 컬럼을 참조하므로).
--   ⚠️ 새 PC 설치 시 이 블록도 1회 실행(그동안 라이브 DB에만 수동 반영돼 있던 것을 문서화).
alter table public.cafe_publish_queue
  add column if not exists company text,
  add column if not exists region  text,
  add column if not exists keyword text;
create index if not exists cpq_company_status_idx
  on public.cafe_publish_queue (company, status, created_at);
-- 롤백: drop index cpq_company_status_idx; alter table ... drop column company, drop column region, drop column keyword;
