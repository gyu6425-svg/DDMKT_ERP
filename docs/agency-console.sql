-- 대행사 콘솔 — 하위 가입 단독 승인 · 토큰 배분. 2026-08-20
--
-- 확정된 업무 규칙
--   · 대행사는 우리에게서 토큰을 사서(선불) 자기 하위 업체에 **자기 가격으로** 되판다.
--   · 하위 업체 관리는 대행사가 한다. 우리는 관여하지 않고 화면으로 보기만 한다.
--     → 하위 가입 승인도 대행사가 단독으로 한다(업체 생성 + 소속 연결 + 계정 활성화까지).
--   · 대행사가 하위에 판 금액은 **우리 DB에도 남아야 한다**(정산·분쟁 근거). 판매단가 필수 입력.
--
-- 왜 전부 SECURITY DEFINER 함수인가
--   대행사에게 profiles·clients·cafe_tokens 의 INSERT/UPDATE 정책을 열어주면
--   남의 업체를 만들거나 자기 토큰을 임의로 늘리는 길이 함께 열린다.
--   그래서 테이블 권한은 그대로 두고, "자기 조직 안에서만" 동작하는 함수만 연다.
--   모든 함수는 첫 줄에서 호출자가 대행사인지 확인하고, 대상이 자기 하위인지 다시 확인한다.
--
-- ⚠️ 기존 RLS 정책을 DROP 하지 않는다. 새 테이블 정책과 함수만 추가한다.
--
-- 실행: SQL Editor. 재실행해도 안전(멱등).

-- ── 0) 호출자가 대행사인지 ───────────────────────────────────────────────
create or replace function public.my_agency_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select c.id from public.clients c
   where c.id = public.my_client_id() and coalesce(c.is_agency, false)
$fn$;

revoke all on function public.my_agency_id() from public, anon;
grant execute on function public.my_agency_id() to authenticated;

-- ── 1) 배분 원장 ─────────────────────────────────────────────────────────
--   토큰 이동 자체는 cafe_tokens 두 줄로 남지만, **얼마에 팔았는지**는 거기 담을 자리가 없다.
--   금액을 note 문자열에 넣으면 나중에 집계가 불가능하다 → 별도 표로 둔다.
create table if not exists public.agency_token_transfers (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  agency_client_id uuid not null references public.clients(id) on delete restrict,
  child_client_id  uuid not null references public.clients(id) on delete restrict,
  count            int  not null check (count > 0),
  unit_price       int  not null check (unit_price >= 0),   -- 대행사가 하위에 판 단가
  amount           int  not null check (amount >= 0),       -- 공급가(부가세 미포함) = count * unit_price
  note             text,
  created_by       uuid
);
comment on table public.agency_token_transfers is
  '대행사 → 하위 업체 토큰 배분 원장. amount 는 공급가(부가세 미포함) — 대행사가 하위에 청구한 금액.';
create index if not exists idx_att_agency on public.agency_token_transfers (agency_client_id, created_at desc);
create index if not exists idx_att_child  on public.agency_token_transfers (child_client_id, created_at desc);

alter table public.agency_token_transfers enable row level security;

drop policy if exists att_internal_all on public.agency_token_transfers;
create policy att_internal_all on public.agency_token_transfers
  for all to authenticated using (public.is_internal()) with check (public.is_internal());

--   대행사는 자기가 준 것, 하위 업체는 자기가 받은 것만 본다. 쓰기는 함수로만(정책 없음).
drop policy if exists att_party_select on public.agency_token_transfers;
create policy att_party_select on public.agency_token_transfers
  for select to authenticated
  using (agency_client_id = public.my_client_id() or child_client_id = public.my_client_id());

-- ── 2) 내 코드로 들어온 가입 신청 ────────────────────────────────────────
--   profiles 는 대행사에게 열지 않는다(다른 업체의 로그인 정보가 같이 열린다).
--   이 함수가 자기 코드로 들어온 대기 건만, 필요한 칸만 골라 돌려준다.
create or replace function public.agency_pending_signups()
returns table (
  profile_id  uuid,
  name        text,
  email       text,
  phone       text,
  company     text,
  biz_no      text,
  invite_code text,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select p.id, p.name, p.email, p.phone, p.signup_company, p.signup_biz_no,
         p.signup_invite_code, p.created_at
    from public.profiles p
   where p.signup_agency_client_id = public.my_agency_id()
     and public.my_agency_id() is not null
     and coalesce(p.is_active, false) = false
     and p.role = 'viewer'
   order by p.created_at desc
$fn$;

revoke all on function public.agency_pending_signups() from public, anon;
grant execute on function public.agency_pending_signups() to authenticated;

-- ── 3) 대행사 단독 승인 ──────────────────────────────────────────────────
--   업체 생성 → 소속 연결 → 계정 활성화 → 코드 사용횟수 증가를 **한 트랜잭션**에서 끝낸다.
--   중간에 하나라도 실패하면 전부 되돌아간다("업체는 생겼는데 로그인이 안 된다"를 막는다).
create or replace function public.agency_approve_signup(p_profile_id uuid, p_company text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ag    uuid := public.my_agency_id();
  p       record;
  v_name  text;
  v_cid   uuid;
begin
  if v_ag is null then
    raise exception '대행사 계정만 승인할 수 있습니다' using errcode = '42501';
  end if;

  select * into p from public.profiles where id = p_profile_id;
  if not found then
    raise exception '가입 신청을 찾을 수 없습니다' using errcode = '22023';
  end if;
  -- ★ 자기 코드로 들어온 신청만. 이 한 줄이 남의 조직을 건드리는 길을 막는다.
  if p.signup_agency_client_id is distinct from v_ag then
    raise exception '내 초대 코드로 들어온 신청이 아닙니다' using errcode = '42501';
  end if;
  if coalesce(p.is_active, false) then
    raise exception '이미 승인된 계정입니다' using errcode = '22023';
  end if;
  if p.role <> 'viewer' then
    raise exception '고객 계정만 승인할 수 있습니다' using errcode = '22023';
  end if;

  v_name := coalesce(nullif(trim(p_company), ''), nullif(trim(p.signup_company), ''), p.name);
  if v_name is null or v_name = '' then
    raise exception '업체명이 없습니다' using errcode = '22023';
  end if;

  -- 같은 대행사 밑에 같은 이름이 두 번 생기면 실적이 갈린다.
  if exists (select 1 from public.clients c
              where c.parent_client_id = v_ag and lower(trim(c.company)) = lower(v_name)) then
    raise exception '이미 같은 이름의 하위 업체가 있습니다: %', v_name using errcode = '22023';
  end if;

  insert into public.clients (company, business_number, email, phone, product, status, source, parent_client_id, is_agency)
  values (v_name, nullif(p.signup_biz_no, ''), nullif(p.email, ''), nullif(p.phone, ''),
          '카페 배포', '계약완료', '대행사', v_ag, false)
  returning id into v_cid;
  --   parent_client_id 는 clients_tree_guard 트리거가 다시 검증한다(상위는 대행사여야 함).

  -- 고객 사이드바에 '카페' 메뉴가 뜨게 — 어드민 승인 경로와 같은 처리.
  insert into public.client_contracts (client_id, category, subtype, sheet_approved, contract_date)
  values (v_cid, '카페', '카페 배포', true, current_date);

  update public.profiles
     set client_id = v_cid,
         is_active = true
   where id = p_profile_id;

  if p.signup_invite_code is not null then
    update public.agency_invites
       set used_count = used_count + 1
     where code = upper(p.signup_invite_code) and agency_client_id = v_ag;
  end if;

  return v_cid;
end $fn$;

revoke all on function public.agency_approve_signup(uuid, text) from public, anon;
grant execute on function public.agency_approve_signup(uuid, text) to authenticated;

-- ── 4) 내 하위가 아님(반려) ──────────────────────────────────────────────
--   대행사에게 계정 삭제 권한은 주지 않는다(되돌릴 수 없다). 소속 표시만 떼어
--   우리 쪽 '가입 승인' 대기로 되돌린다.
create or replace function public.agency_release_signup(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_ag uuid := public.my_agency_id();
begin
  if v_ag is null then
    raise exception '대행사 계정만 처리할 수 있습니다' using errcode = '42501';
  end if;
  update public.profiles
     set signup_agency_client_id = null
   where id = p_profile_id
     and signup_agency_client_id = v_ag
     and coalesce(is_active, false) = false;
  if not found then
    raise exception '처리할 수 있는 신청이 아닙니다' using errcode = '22023';
  end if;
end $fn$;

revoke all on function public.agency_release_signup(uuid) from public, anon;
grant execute on function public.agency_release_signup(uuid) to authenticated;

-- ── 5) 하위 업체 현황(토큰 포함) ─────────────────────────────────────────
--   cafe_tokens 를 대행사에게 열지 않고 집계값만 돌려준다.
create or replace function public.agency_children_overview()
returns table (
  client_id  uuid,
  company    text,
  status     text,
  created_at timestamptz,
  balance    int,
  granted    int,
  used       int
)
language sql
stable
security definer
set search_path = public
as $fn$
  select c.id, c.company, c.status, c.created_at,
         coalesce(sum(t.delta), 0)::int,
         coalesce(sum(t.delta) filter (where t.delta > 0), 0)::int,
         coalesce(-sum(t.delta) filter (where t.delta < 0), 0)::int
    from public.clients c
    left join public.cafe_tokens t on t.client_id = c.id
   where c.parent_client_id = public.my_agency_id()
     and public.my_agency_id() is not null
   group by c.id, c.company, c.status, c.created_at
   order by c.company
$fn$;

revoke all on function public.agency_children_overview() from public, anon;
grant execute on function public.agency_children_overview() to authenticated;

-- ── 6) 토큰 배분 ─────────────────────────────────────────────────────────
--   대행사 잔액에서 빼고 하위에 더한다. 두 줄이 한 트랜잭션이라 한쪽만 남을 수 없다.
--   음수 잔액은 cafe_tokens_no_overdraft 트리거가 DB 차원에서 막지만, 여기서 먼저
--   사람이 읽을 수 있는 문구로 걸러 준다.
create or replace function public.agency_transfer_tokens(
  p_child_client_id uuid,
  p_count           int,
  p_unit_price      int,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ag    uuid := public.my_agency_id();
  v_bal   int;
  v_child record;
  v_id    uuid;
begin
  if v_ag is null then
    raise exception '대행사 계정만 배분할 수 있습니다' using errcode = '42501';
  end if;
  if p_count is null or p_count <= 0 then
    raise exception '배분 건수는 1 이상이어야 합니다' using errcode = '22023';
  end if;
  if p_unit_price is null or p_unit_price < 0 then
    raise exception '판매 단가를 입력하세요' using errcode = '22023';
  end if;

  select id, company into v_child from public.clients
   where id = p_child_client_id and parent_client_id = v_ag;
  if not found then
    raise exception '내 하위 업체가 아닙니다' using errcode = '42501';
  end if;

  -- 같은 대행사 원장을 잠가 두 탭 동시 배분을 막는다(트리거와 같은 키를 쓴다).
  perform pg_advisory_xact_lock(hashtextextended(v_ag::text, 0));
  select coalesce(sum(delta), 0) into v_bal from public.cafe_tokens where client_id = v_ag;
  if v_bal < p_count then
    raise exception '토큰이 부족합니다 — 보유 %건, 배분 %건', v_bal, p_count using errcode = 'check_violation';
  end if;

  insert into public.agency_token_transfers
    (agency_client_id, child_client_id, count, unit_price, amount, note, created_by)
  values (v_ag, p_child_client_id, p_count, p_unit_price, p_count * p_unit_price,
          nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;

  -- 원장 두 줄. idem_key 로 같은 배분이 두 번 기록되는 것을 DB에서 막는다.
  insert into public.cafe_tokens (client_id, delta, kind, note, idem_key, created_by)
  values (v_ag, -p_count, '배분',
          format('%s 배분 %s건', v_child.company, p_count), 'att-out:' || v_id, auth.uid());
  insert into public.cafe_tokens (client_id, delta, kind, note, idem_key, created_by)
  values (p_child_client_id, p_count, '대행사충전',
          format('대행사 배분 %s건', p_count), 'att-in:' || v_id, auth.uid());

  return v_id;
end $fn$;

revoke all on function public.agency_transfer_tokens(uuid, int, int, text) from public, anon;
grant execute on function public.agency_transfer_tokens(uuid, int, int, text) to authenticated;

-- ── 확인 ─────────────────────────────────────────────────────────────────
select proname, pg_get_function_identity_arguments(oid) as 인자
  from pg_proc
 where proname in ('my_agency_id','agency_pending_signups','agency_approve_signup',
                   'agency_release_signup','agency_children_overview','agency_transfer_tokens')
 order by proname;   -- 6줄

select tablename, policyname, cmd from pg_policies
 where schemaname = 'public' and tablename = 'agency_token_transfers' order by policyname;
