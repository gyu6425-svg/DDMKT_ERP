-- 대행사 조직 계층 1단계 — 컬럼·제약만. 2026-08-18
--
-- 구조:  든든한마케팅(우리·내부, clients 아님) → 대행사(is_agency=true) → 하위 업체 N
--   · 대행사는 발행하지 않는다(순수 중개). 하위 업체가 각자 자기 카페로 발행한다.
--   · 하위 업체 접수는 우리와 그 대행사만 본다. 대행사끼리는 못 본다.
--
-- ⚠️ 이 파일은 **컬럼·제약만** 만든다. RLS 정책은 한 줄도 건드리지 않는다.
--    (이 프로젝트는 RLS 정책 DROP 만 실행해 전 테이블 락아웃을 낸 전례가 있다 — docs/rls-recover-all.sql)
--    권한 확장은 다음 단계에서 '추가만' 하는 방식으로 따로 적용한다.
--
-- 실행: Supabase > SQL Editor. 재실행해도 안전(멱등).

-- ── 1) 조직 계층 컬럼 ────────────────────────────────────────────────────
alter table public.clients
  add column if not exists parent_client_id uuid references public.clients(id) on delete set null;
--   근거: 하위 업체 → 소속 대행사. 조직 트리·권한 격리의 유일한 근거 컬럼.
--   on delete set null: 대행사 client 를 지워도 하위 업체가 증발하면 안 된다(cascade 금지).
--   ※ 계약 종료는 삭제가 아니라 parent_client_id=null 로 '직거래 전환' 하는 것으로 정의한다.

create index if not exists idx_clients_parent
  on public.clients (parent_client_id) where parent_client_id is not null;
--   근거: 대행사 화면이 "내 하위 전부"를 매번 조회한다. 권한 함수도 이 컬럼으로 하강한다.

-- 자기 자신이 부모가 되는 것 차단
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_parent_not_self') then
    alter table public.clients
      add constraint clients_parent_not_self
      check (parent_client_id is null or parent_client_id <> id) not valid;
    alter table public.clients validate constraint clients_parent_not_self;
  end if;
end $$;

-- ── 2) 트리 가드 — 깊이 2단 고정 + 부모는 반드시 대행사 ──────────────────
--   근거: 3단 이상이 생기면 "내 하위" 조회(1단 하강)가 손자를 조용히 누락시킨다.
--         그 상태로 정산하면 대행사가 자기 실적 일부를 못 본다.
create or replace function public.clients_tree_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parent_client_id is not null then
    if coalesce(new.is_agency, false) then
      raise exception '대행사는 상위를 가질 수 없습니다(든든한마케팅 → 대행사 → 업체 2단 고정)';
    end if;
    if not exists (select 1 from public.clients c
                   where c.id = new.parent_client_id and coalesce(c.is_agency, false)) then
      raise exception '상위는 대행사(is_agency=true)여야 합니다';
    end if;
  end if;
  -- 대행사로 전환하려는데 이미 자기 밑에 업체가 있으면 2단이 깨진다
  if coalesce(new.is_agency, false) and new.parent_client_id is not null then
    raise exception '하위 업체를 대행사로 전환할 수 없습니다 — 먼저 소속을 해제하세요';
  end if;
  return new;
end $$;

drop trigger if exists trg_clients_tree_guard on public.clients;
create trigger trg_clients_tree_guard
  before insert or update of parent_client_id, is_agency on public.clients
  for each row execute function public.clients_tree_guard();

-- ── 3) 초대 코드 ─────────────────────────────────────────────────────────
--   대행사마다 고유코드. 가입 화면 '초대 코드' 칸에 넣으면 그 대행사 하위로 붙는다.
--   ★ 별도 테이블인 이유: 코드가 유출되면 그 코드만 폐기(active=false)하고 새로 발급해야 하는데,
--     clients 에 컬럼 하나로 두면 덮어쓰기가 되어 "누가 어느 코드로 들어왔는지" 이력이 사라진다.
create table if not exists public.agency_invites (
  code             text primary key check (code = upper(code) and length(code) between 6 and 20),
  agency_client_id uuid not null references public.clients(id) on delete cascade,
  label            text,                       -- '2026 상반기' 처럼 발급 목적 구분
  max_uses         int,                        -- null = 무제한. 유출 시 피해 상한
  used_count       int not null default 0,
  expires_at       timestamptz,                -- null = 무기한
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid
);
create index if not exists idx_agency_invites_client
  on public.agency_invites (agency_client_id) where active;

alter table public.agency_invites enable row level security;
-- 내부 직원만. 고객·대행사에게는 아직 열지 않는다(다음 단계에서 대행사 본인 조회만 추가).
drop policy if exists "ai 내부 전체" on public.agency_invites;
create policy "ai 내부 전체" on public.agency_invites
  for all to authenticated using (public.is_internal()) with check (public.is_internal());

-- ── 4) 가입 시 초대코드 보관 ─────────────────────────────────────────────
--   가입 시점엔 clients 행이 아직 없다(승인 때 생성/연결). 그래서 코드를 profiles 에 들고 있다가
--   승인하는 순간 clients.parent_client_id 로 확정한다. 기존 is_agency 전파와 같은 자리다.
alter table public.profiles
  add column if not exists signup_invite_code text;
alter table public.profiles
  add column if not exists signup_agency_client_id uuid references public.clients(id);
--   원문(코드)과 해석결과(대행사 id)를 둘 다 남긴다.
--   원문만 두면 승인 시점에 코드가 폐기됐을 때 부모를 못 찾고,
--   해석결과만 두면 분쟁 때 "무슨 코드로 들어왔나"를 못 본다.

-- ── 확인 ─────────────────────────────────────────────────────────────────
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'clients'
   and column_name = 'parent_client_id';

select id, company, is_agency, parent_client_id
  from public.clients
 where is_agency = true
 order by company;
