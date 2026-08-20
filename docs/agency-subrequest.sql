-- 하위 업체 → 대행사 토큰 구매 — 우리↔대행사와 **같은 4단계**. 2026-08-20
--
-- 흐름 (선불제)
--   1) 하위 업체가 건수 신청                status = pending
--   2) 대행사가 자기 판매가로 금액 통보      status = quoted   (quoted_count·unit_price·amount)
--   3) 하위 업체가 입금 후 '계좌이체 완료'   status = paid     (paid_declared_at·depositor)
--   4) 대행사가 확인 후 토큰 발행            status = done     → 대행사 잔액에서 하위로 이동
--
-- 우리↔대행사(cafe_token_requests)와 표를 나눈 이유
--   · 이건 대행사가 처리하는 큐다. 우리 큐(어드민 '토큰 구매')에 섞이면 우리가 처리해야 할 건과
--     구경만 하면 되는 건이 한 목록에 뒤섞인다.
--   · 금액 체계가 다르다. 우리→대행사는 우리 단가, 대행사→하위는 대행사가 정한 판매가다.
--   · 우리는 관여하지 않지만 **볼 수는 있어야 한다**(정산·분쟁) → is_internal 읽기 정책만 연다.
--
-- ⚠️ 기존 RLS 정책은 DROP 하지 않는다. 새 표·정책·함수만 추가한다.
--
-- 실행: SQL Editor. 재실행해도 안전(멱등).

-- ── 1) 요청 표 ───────────────────────────────────────────────────────────
create table if not exists public.agency_token_requests (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  child_client_id   uuid not null references public.clients(id) on delete restrict,
  agency_client_id  uuid not null references public.clients(id) on delete restrict,
  requested_count   int,
  note              text,
  status            text not null default 'pending'
                    check (status in ('pending','quoted','paid','done','rejected')),
  quoted_count      int,
  unit_price        int,          -- 대행사가 하위에 부르는 단가
  amount            int,          -- 공급가 = quoted_count × unit_price (부가세 미포함)
  quoted_at         timestamptz,
  paid_declared_at  timestamptz,
  depositor         text,
  granted_count     int,
  handled_at        timestamptz,
  transfer_id       uuid          -- 발행 시 생성된 agency_token_transfers 행
);
comment on column public.agency_token_requests.amount is
  '공급가(부가세 미포함). 실제 입금액은 amount * 1.1 — VAT 를 이 컬럼에 섞지 말 것.';

create index if not exists idx_atr_agency on public.agency_token_requests (agency_client_id, status);
create index if not exists idx_atr_child  on public.agency_token_requests (child_client_id, created_at desc);

alter table public.agency_token_requests enable row level security;

--   당사자(하위·대행사)와 내부 직원만 조회. 쓰기 정책은 두지 않는다 — 전부 함수로만.
--   정책으로 UPDATE 를 열면 하위 업체가 status 를 done 으로 바꿔 돈 안 내고 토큰을 받는다.
drop policy if exists atr_party_select on public.agency_token_requests;
create policy atr_party_select on public.agency_token_requests
  for select to authenticated
  using (child_client_id = public.my_client_id()
      or agency_client_id = public.my_client_id()
      or public.is_internal());

drop policy if exists atr_internal_all on public.agency_token_requests;
create policy atr_internal_all on public.agency_token_requests
  for all to authenticated using (public.is_internal()) with check (public.is_internal());

--   배분 원장에 어느 요청으로 나갔는지 연결(수동 배분은 null).
alter table public.agency_token_transfers add column if not exists request_id uuid;

-- ── 2) 내 상위 대행사 ────────────────────────────────────────────────────
create or replace function public.my_parent_agency_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select p.id
    from public.clients c
    join public.clients p on p.id = c.parent_client_id
   where c.id = public.my_client_id() and coalesce(p.is_agency, false)
$fn$;

revoke all on function public.my_parent_agency_id() from public, anon;
grant execute on function public.my_parent_agency_id() to authenticated;

-- ── 3) 하위 업체 — 신청 ─────────────────────────────────────────────────
create or replace function public.sub_request_tokens(p_count int, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me uuid := public.my_client_id();
  v_ag uuid := public.my_parent_agency_id();
  v_id uuid;
begin
  if v_ag is null then
    raise exception '소속 대행사가 없습니다 — 담당자에게 문의하세요' using errcode = '42501';
  end if;
  if p_count is null or p_count <= 0 then
    raise exception '신청 건수는 1 이상이어야 합니다' using errcode = '22023';
  end if;
  -- 처리 안 끝난 신청이 쌓이면 대행사 큐가 지저분해지고 중복 입금 사고가 난다.
  if exists (select 1 from public.agency_token_requests
              where child_client_id = v_me and status in ('pending','quoted','paid')) then
    raise exception '아직 처리 중인 신청이 있습니다 — 완료 후 다시 신청해 주세요' using errcode = '22023';
  end if;

  insert into public.agency_token_requests (child_client_id, agency_client_id, requested_count, note)
  values (v_me, v_ag, p_count, nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end $fn$;

revoke all on function public.sub_request_tokens(int, text) from public, anon;
grant execute on function public.sub_request_tokens(int, text) to authenticated;

-- ── 4) 하위 업체 — 입금 신고 ────────────────────────────────────────────
--   토큰은 여기서 지급되지 않는다. 대행사가 통장을 보고 발행한다.
create or replace function public.sub_declare_payment(p_request_id uuid, p_depositor text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v record;
begin
  select * into v from public.agency_token_requests where id = p_request_id;
  if not found then
    raise exception '신청을 찾을 수 없습니다' using errcode = '22023';
  end if;
  if v.child_client_id is distinct from public.my_client_id() then
    raise exception '본인 신청만 처리할 수 있습니다' using errcode = '42501';
  end if;
  if v.status not in ('pending', 'quoted') then
    raise exception '이미 처리된 신청입니다(현재 %)', v.status using errcode = '22023';
  end if;

  update public.agency_token_requests
     set status = 'paid',
         paid_declared_at = now(),
         depositor = coalesce(nullif(trim(p_depositor), ''), depositor)
   where id = p_request_id;
end $fn$;

revoke all on function public.sub_declare_payment(uuid, text) from public, anon;
grant execute on function public.sub_declare_payment(uuid, text) to authenticated;

-- ── 5) 대행사 — 금액 통보 ───────────────────────────────────────────────
create or replace function public.agency_quote_request(p_request_id uuid, p_count int, p_unit_price int)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ag uuid := public.my_agency_id();
  v    record;
begin
  if v_ag is null then
    raise exception '대행사 계정만 처리할 수 있습니다' using errcode = '42501';
  end if;
  select * into v from public.agency_token_requests where id = p_request_id;
  if not found or v.agency_client_id is distinct from v_ag then
    raise exception '내 하위 업체의 신청이 아닙니다' using errcode = '42501';
  end if;
  if v.status in ('done', 'rejected') then
    raise exception '이미 종료된 신청입니다(현재 %)', v.status using errcode = '22023';
  end if;
  if p_count is null or p_count <= 0 then
    raise exception '통보 건수는 1 이상이어야 합니다' using errcode = '22023';
  end if;
  if p_unit_price is null or p_unit_price < 0 then
    raise exception '판매 단가를 입력하세요' using errcode = '22023';
  end if;

  update public.agency_token_requests
     set status = 'quoted', quoted_count = p_count, unit_price = p_unit_price,
         amount = p_count * p_unit_price, quoted_at = now()
   where id = p_request_id;
end $fn$;

revoke all on function public.agency_quote_request(uuid, int, int) from public, anon;
grant execute on function public.agency_quote_request(uuid, int, int) to authenticated;

-- ── 6) 대행사 — 입금 확인 후 발행 ───────────────────────────────────────
--   실제 토큰 이동은 agency_transfer_tokens 를 그대로 재사용한다.
--   잔액 검사·advisory lock·원장 2줄·멱등키가 이미 거기 있어, 여기서 다시 구현하면
--   두 경로의 안전장치가 서로 어긋나게 된다.
create or replace function public.agency_fulfill_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ag uuid := public.my_agency_id();
  v    record;
  v_n  int;
  v_tr uuid;
begin
  if v_ag is null then
    raise exception '대행사 계정만 처리할 수 있습니다' using errcode = '42501';
  end if;
  select * into v from public.agency_token_requests where id = p_request_id;
  if not found or v.agency_client_id is distinct from v_ag then
    raise exception '내 하위 업체의 신청이 아닙니다' using errcode = '42501';
  end if;
  if v.status = 'done' then
    raise exception '이미 발행된 신청입니다' using errcode = '22023';
  end if;
  if v.status = 'rejected' then
    raise exception '반려된 신청입니다' using errcode = '22023';
  end if;
  if v.status <> 'paid' then
    raise exception '입금 신고 전입니다 — 하위 업체의 입금 확인 후 발행하세요' using errcode = '22023';
  end if;

  v_n := coalesce(v.quoted_count, v.requested_count);
  if v_n is null or v_n <= 0 then
    raise exception '발행할 건수가 없습니다 — 먼저 금액을 통보하세요' using errcode = '22023';
  end if;

  v_tr := public.agency_transfer_tokens(
            v.child_client_id, v_n, coalesce(v.unit_price, 0),
            format('충전신청 %s건', v_n));

  update public.agency_token_transfers set request_id = p_request_id where id = v_tr;
  update public.agency_token_requests
     set status = 'done', granted_count = v_n, handled_at = now(), transfer_id = v_tr
   where id = p_request_id;
  return v_tr;
end $fn$;

revoke all on function public.agency_fulfill_request(uuid) from public, anon;
grant execute on function public.agency_fulfill_request(uuid) to authenticated;

-- ── 7) 대행사 — 반려 ────────────────────────────────────────────────────
create or replace function public.agency_reject_request(p_request_id uuid)
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
  update public.agency_token_requests
     set status = 'rejected', handled_at = now()
   where id = p_request_id and agency_client_id = v_ag and status <> 'done';
  if not found then
    raise exception '처리할 수 있는 신청이 아닙니다' using errcode = '22023';
  end if;
end $fn$;

revoke all on function public.agency_reject_request(uuid) from public, anon;
grant execute on function public.agency_reject_request(uuid) to authenticated;

-- ── 확인 ─────────────────────────────────────────────────────────────────
select proname, pg_get_function_identity_arguments(oid) as 인자
  from pg_proc
 where proname in ('my_parent_agency_id','sub_request_tokens','sub_declare_payment',
                   'agency_quote_request','agency_fulfill_request','agency_reject_request')
 order by proname;   -- 6줄

select policyname, cmd from pg_policies
 where schemaname='public' and tablename='agency_token_requests' order by policyname;
