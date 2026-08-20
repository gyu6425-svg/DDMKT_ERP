-- 대행사 콘솔 결함 수정 — 중복 발행 · 중복 업체 · 금액 없는 발행. 2026-08-20
--
-- 독립검증(보안·QA 두 팀이 각각 재현)에서 나온 것들이다.
--
-- ① 발행 중복 지급 (심각 — 돈이 샌다)
--    agency_fulfill_request 가 요청 행을 **잠금 없이** 읽고 status 만 봤다.
--    동시에 들어온 호출이 모두 'paid' 를 읽고 각자 토큰을 보냈다.
--    실측: 3건짜리 신청 하나로 6건이 나갔다(대행사 잔액 7→1). 잔액이 충분했다면 18건.
--    멱등키 att-out:<transfer_id> 는 호출마다 새 uuid 라 요청 단위 중복을 못 막는다.
--    트리거: 발행 버튼 더블클릭 · 탭 2개 · 네트워크 재시도.
--    → 2026-08-14 금융책사 3중지급(+100×3) 과 같은 클래스다. 그때 만든 방어가 이 경로만 비켜갔다.
--
-- ② 승인 중복 (중간)
--    agency_approve_signup 의 동명 업체 검사가 잠금 없이 read-then-write 였다.
--    실측: 동시 6회 호출로 같은 업체가 4개 생겼고 3개는 소속 프로필 없는 유령이 됐다.
--
-- ③ 금액 없이 발행 (정산 근거 소멸)
--    sub_declare_payment 가 'pending' 에서도 입금 신고를 허용해, 금액 통보를 건너뛰고
--    unit_price=0 · amount=0 인 "정상 거래" 기록이 만들어졌다(실측 1건 발생).
--    판매 단가 필수 입력이라는 업무 규칙이 DB 에서 지켜지지 않았다.
--
-- 실행: SQL Editor. 재실행해도 안전(멱등).

-- ── ① 발행 — 요청 행을 잠그고, 금액 통보 여부를 확인한다 ────────────────
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

  -- ★ for update — 두 번째 호출은 첫 커밋을 기다렸다가 status='done' 을 보고 막힌다.
  --   이 한 줄이 없으면 동시 호출이 전부 통과해 토큰이 배로 나간다.
  select * into v from public.agency_token_requests where id = p_request_id for update;

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

  -- ★ 금액이 확정되지 않은 건은 발행하지 않는다. 0원짜리 거래 기록이 남으면 정산 근거가 없다.
  if v.quoted_count is null or v.unit_price is null then
    raise exception '금액을 먼저 통보하세요 — 건수·단가가 확정돼야 발행할 수 있습니다' using errcode = '22023';
  end if;

  v_n := v.quoted_count;
  if v_n <= 0 then
    raise exception '발행할 건수가 없습니다' using errcode = '22023';
  end if;

  v_tr := public.agency_transfer_tokens(v.child_client_id, v_n, v.unit_price,
                                        format('충전신청 %s건', v_n));

  update public.agency_token_transfers set request_id = p_request_id where id = v_tr;
  update public.agency_token_requests
     set status = 'done', granted_count = v_n, handled_at = now(), transfer_id = v_tr
   where id = p_request_id;
  return v_tr;
end $fn$;

revoke all on function public.agency_fulfill_request(uuid) from public, anon;
grant execute on function public.agency_fulfill_request(uuid) to authenticated;

-- ── ③ 입금 신고는 금액 통보 이후에만 ────────────────────────────────────
create or replace function public.sub_declare_payment(p_request_id uuid, p_depositor text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v record;
begin
  select * into v from public.agency_token_requests where id = p_request_id for update;
  if not found then
    raise exception '신청을 찾을 수 없습니다' using errcode = '22023';
  end if;
  if v.child_client_id is distinct from public.my_client_id() then
    raise exception '본인 신청만 처리할 수 있습니다' using errcode = '42501';
  end if;
  -- ★ 'quoted' 만 허용. pending 에서 바로 신고하면 얼마를 입금했는지 알 수 없고,
  --   발행 시 0원 거래가 기록된다.
  if v.status <> 'quoted' then
    raise exception '금액 통보 후에 신고할 수 있습니다(현재 %)', v.status using errcode = '22023';
  end if;

  update public.agency_token_requests
     set status = 'paid', paid_declared_at = now(),
         depositor = coalesce(nullif(trim(p_depositor), ''), depositor)
   where id = p_request_id;
end $fn$;

revoke all on function public.sub_declare_payment(uuid, text) from public, anon;
grant execute on function public.sub_declare_payment(uuid, text) to authenticated;

-- 우리↔대행사 경로도 같은 구멍이 있다 — 동일하게 막는다.
create or replace function public.declare_token_payment(p_request_id uuid, p_depositor text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v record;
begin
  select * into v from public.cafe_token_requests where id = p_request_id for update;
  if not found then
    raise exception '요청을 찾을 수 없습니다' using errcode = '22023';
  end if;
  if v.client_id is distinct from public.my_client_id() then
    raise exception '본인 신청만 처리할 수 있습니다' using errcode = '42501';
  end if;
  if v.status <> 'quoted' then
    raise exception '금액 통보 후에 신고할 수 있습니다(현재 %)', v.status using errcode = '22023';
  end if;

  update public.cafe_token_requests
     set status = 'paid', paid_declared_at = now(),
         depositor = coalesce(nullif(trim(p_depositor), ''), depositor)
   where id = p_request_id;
end $fn$;

revoke all on function public.declare_token_payment(uuid, text) from public, anon;
grant execute on function public.declare_token_payment(uuid, text) to authenticated;

-- ── 단가 0 차단 — 무상 지급은 이 경로로 하지 않는다 ─────────────────────
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
  select * into v from public.agency_token_requests where id = p_request_id for update;
  if not found or v.agency_client_id is distinct from v_ag then
    raise exception '내 하위 업체의 신청이 아닙니다' using errcode = '42501';
  end if;
  if v.status in ('done', 'rejected') then
    raise exception '이미 종료된 신청입니다(현재 %)', v.status using errcode = '22023';
  end if;
  -- 입금 신고가 끝난 뒤 금액을 바꾸면 하위가 입금한 금액과 기록이 어긋난다.
  if v.status = 'paid' then
    raise exception '입금 신고가 끝난 건은 금액을 바꿀 수 없습니다 — 반려 후 다시 진행하세요' using errcode = '22023';
  end if;
  if p_count is null or p_count <= 0 or p_count > 100000 then
    raise exception '통보 건수는 1~100,000 사이여야 합니다' using errcode = '22023';
  end if;
  if p_unit_price is null or p_unit_price <= 0 or p_unit_price > 10000000 then
    raise exception '판매 단가는 1원~10,000,000원 사이여야 합니다' using errcode = '22023';
  end if;

  update public.agency_token_requests
     set status = 'quoted', quoted_count = p_count, unit_price = p_unit_price,
         amount = p_count * p_unit_price, quoted_at = now()
   where id = p_request_id;
end $fn$;

revoke all on function public.agency_quote_request(uuid, int, int) from public, anon;
grant execute on function public.agency_quote_request(uuid, int, int) to authenticated;

-- 수동 배분도 같은 상·하한을 둔다(정수 범위 초과 시 영문 에러가 그대로 노출되던 것도 함께 막는다).
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
  if p_count is null or p_count <= 0 or p_count > 100000 then
    raise exception '배분 건수는 1~100,000 사이여야 합니다' using errcode = '22023';
  end if;
  if p_unit_price is null or p_unit_price <= 0 or p_unit_price > 10000000 then
    raise exception '판매 단가는 1원~10,000,000원 사이여야 합니다' using errcode = '22023';
  end if;

  select id, company into v_child from public.clients
   where id = p_child_client_id and parent_client_id = v_ag;
  if not found then
    raise exception '내 하위 업체가 아닙니다' using errcode = '42501';
  end if;

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

-- ── ② 승인 — 프로필 행을 잠근다 + 동명 업체를 DB 로 못박는다 ────────────
--   화면·함수 검사만으로는 동시 호출을 막을 수 없다. 유니크 인덱스가 마지막 방어선이다.
create unique index if not exists uq_clients_parent_company
  on public.clients (parent_client_id, lower(btrim(company)))
  where parent_client_id is not null;

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

  -- ★ for update — 동시 승인이 모두 "아직 비활성"을 읽고 각자 업체를 만드는 것을 막는다.
  select * into p from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception '가입 신청을 찾을 수 없습니다' using errcode = '22023';
  end if;
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

  begin
    insert into public.clients (company, business_number, email, phone, product, status, source, parent_client_id, is_agency)
    values (v_name, nullif(p.signup_biz_no, ''), nullif(p.email, ''), nullif(p.phone, ''),
            '카페 배포', '계약완료', '대행사', v_ag, false)
    returning id into v_cid;
  exception when unique_violation then
    raise exception '이미 같은 이름의 하위 업체가 있습니다: %', v_name using errcode = '22023';
  end;

  insert into public.client_contracts (client_id, category, subtype, sheet_approved, contract_date)
  values (v_cid, '카페', '카페 배포', true, current_date);

  update public.profiles set client_id = v_cid, is_active = true where id = p_profile_id;

  if p.signup_invite_code is not null then
    update public.agency_invites
       set used_count = used_count + 1
     where code = upper(p.signup_invite_code) and agency_client_id = v_ag;
  end if;

  return v_cid;
end $fn$;

revoke all on function public.agency_approve_signup(uuid, text) from public, anon;
grant execute on function public.agency_approve_signup(uuid, text) to authenticated;

-- ── 확인 ─────────────────────────────────────────────────────────────────
select proname,
       (prosrc like '%for update%') as 행잠금,
       (prosrc like '%quoted%')     as 통보확인
  from pg_proc
 where proname in ('agency_fulfill_request','sub_declare_payment','declare_token_payment',
                   'agency_quote_request','agency_transfer_tokens','agency_approve_signup')
 order by proname;

select indexname from pg_indexes
 where schemaname='public' and indexname='uq_clients_parent_company';
