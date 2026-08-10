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

-- ── 게시판(board) 파티션 — 같은 카페를 여러 PC가 게시판별로 나눠 발행 (2026-07-21, 독립검증) ──
--   목적: 2대 이상 PC가 같은 카페에 발행할 때, 각 PC가 자기 '게시판(CAFE_BOARDS)' 행만 집게 해
--         작업을 겹치지 않게 나눈다. (같은 '행'의 이중발행은 기존 claim CAS 가 이미 막는다.)
--   ⚠️ 파티션 키로 menu_id 를 쓰지 않는다 — 어떤 enqueue 경로도 안 채우는 죽은 컬럼이고,
--      발행기는 게시판을 '이름' 정확일치로 고르므로(publish_cafe._pick_exact_option),
--      '이름'을 top-level board 컬럼으로 두는 것이 선택값·파티션값의 단일 진실원이 된다.
--   ⚠️ 새 PC 설치 시 이 블록도 1회 실행.
alter table public.cafe_publish_queue
  add column if not exists board text;

-- 백필 1) manifest 안의 board 블록({type:'board',name}) 에서 이름을 끌어와 채운다.
update public.cafe_publish_queue q
   set board = sub.name
  from (
    select id, (
      select b->>'name' from jsonb_array_elements(manifest) b
       where b->>'type' = 'board' limit 1
    ) as name
      from public.cafe_publish_queue
  ) sub
 where q.id = sub.id and q.board is null and sub.name is not null;

-- 백필 2) manifest 에 board 블록이 없던 경로(웹 수동탭·업체 자동) 는 company 로 매핑.
--   (같은 카페 안에서 company↔게시판이 1:1. 값은 실제 카페 게시판 이름과 정확히 일치해야 함.)
update public.cafe_publish_queue set board = '더맨시스템 시설경호업체' where board is null and company = 'theman';
update public.cafe_publish_queue set board = '설고점 소방의 모든 것'   where board is null and company = 'seolgo';
-- 백필 3) 레거시 누수 자동생성분(company·board 둘 다 NULL) → '누수'.
--   ⚠️ '누수' 자동발행 PC 가 그 NULL 행들의 유일한 생산자일 때만 안전(현재 구조가 그러함).
update public.cafe_publish_queue set board = '누수'
 where board is null and company is null and status in ('pending','processing');

create index if not exists cpq_board_status_idx
  on public.cafe_publish_queue (board, status, created_at);

-- 신규 insert 시 board 가 비어 있으면 manifest 의 board 블록에서 자동으로 채운다(구버전 클라이언트 안전망).
create or replace function public.cpq_fill_board() returns trigger as $$
begin
  if new.board is null then
    new.board := (select b->>'name' from jsonb_array_elements(new.manifest) b
                   where b->>'type' = 'board' limit 1);
  end if;
  return new;
end $$ language plpgsql;
drop trigger if exists cpq_fill_board_t on public.cafe_publish_queue;
create trigger cpq_fill_board_t before insert on public.cafe_publish_queue
  for each row execute function public.cpq_fill_board();
-- 롤백: drop trigger cpq_fill_board_t on public.cafe_publish_queue; drop function public.cpq_fill_board();
--       drop index cpq_board_status_idx; alter table public.cafe_publish_queue drop column board;

-- ── 같은 내용 중복 등록 차단 — '절대 중복'의 실질 보증 (2026-07-21, 독립검증) ──
--   claim CAS 는 '같은 행'만 지킨다. 같은 (업체·지역·키워드) 를 실수로 두 번 큐에 넣으면
--   서로 다른 두 행이 되어 둘 다 발행된다. 아래 유니크 인덱스가 '진행 중(active)' 상태에서
--   같은 키의 두 번째 적재를 거부한다(웹 enqueue 는 에러를 받아 사용자에게 알림).
--   · coalesce(keyword,'') : keyword NULL 도 같은 값으로 취급(Postgres 는 NULL 을 서로 다르게 봄).
--   · where status in (pending/processing/posted) : 이미 done/fail 된 과거 건의 재발행은 막지 않는다.
--     ▶ '같은 지역을 영영 재발행 금지'로 더 강하게 하려면 이 status 조건을 빼면 된다.
--   ⚠️ 기존에 같은 키의 active 중복행이 있으면 인덱스 생성이 실패한다 → 먼저 중복을 정리할 것.
create unique index if not exists cpq_active_dedup_idx
  on public.cafe_publish_queue (company, region, coalesce(keyword, ''))
 where company is not null and region is not null
       and status in ('pending','processing','posted');
-- 롤백: drop index cpq_active_dedup_idx;
