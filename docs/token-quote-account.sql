-- 금액 통보에 입금 계좌를 함께 보낸다. 2026-08-20
--
-- 왜 컬럼에 저장하는가(상수로 화면에만 띄우지 않고)
--   · 우리 계좌는 지금 코드 상수(PAYMENT_INFO)다. 계좌를 바꾸면 **과거 통보 건까지 새 계좌로 보인다.**
--     "그때 어느 계좌를 알려줬나"는 입금 대조·분쟁의 근거라, 통보 시점 값을 그대로 박아 둔다.
--   · 대행사→하위는 아예 대행사마다 계좌가 다르다. 저장하지 않으면 보여줄 값 자체가 없다.
--
-- 실행: SQL Editor. 재실행해도 안전(멱등).

alter table public.cafe_token_requests
  add column if not exists pay_bank    text,
  add column if not exists pay_account text,
  add column if not exists pay_holder  text;

alter table public.agency_token_requests
  add column if not exists pay_bank    text,
  add column if not exists pay_account text,
  add column if not exists pay_holder  text;

comment on column public.agency_token_requests.pay_account is
  '금액 통보 시점의 입금 계좌 스냅샷. 나중에 계좌가 바뀌어도 과거 통보 건은 그때 알려준 계좌로 남는다.';

-- ── 대행사 금액 통보 — 계좌 3종을 함께 받는다 ───────────────────────────
--   옛 3-인자 시그니처는 지운다(남겨두면 호출이 모호해진다).
drop function if exists public.agency_quote_request(uuid, int, int);

create or replace function public.agency_quote_request(
  p_request_id uuid,
  p_count      int,
  p_unit_price int,
  p_bank       text default null,
  p_account    text default null,
  p_holder     text default null
)
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
  if v.status = 'paid' then
    raise exception '입금 신고가 끝난 건은 금액을 바꿀 수 없습니다 — 반려 후 다시 진행하세요' using errcode = '22023';
  end if;
  if p_count is null or p_count <= 0 or p_count > 100000 then
    raise exception '통보 건수는 1~100,000 사이여야 합니다' using errcode = '22023';
  end if;
  if p_unit_price is null or p_unit_price <= 0 or p_unit_price > 10000000 then
    raise exception '판매 단가는 1원~10,000,000원 사이여야 합니다' using errcode = '22023';
  end if;
  -- ★ 계좌 없이 통보하면 하위 업체는 어디로 입금할지 알 수 없다. 세 칸 모두 필수.
  if coalesce(nullif(trim(p_bank), ''), '') = ''
     or coalesce(nullif(trim(p_account), ''), '') = ''
     or coalesce(nullif(trim(p_holder), ''), '') = '' then
    raise exception '입금 계좌(은행·계좌번호·예금주)를 모두 입력하세요' using errcode = '22023';
  end if;

  update public.agency_token_requests
     set status = 'quoted', quoted_count = p_count, unit_price = p_unit_price,
         amount = p_count * p_unit_price, quoted_at = now(),
         pay_bank = trim(p_bank), pay_account = trim(p_account), pay_holder = trim(p_holder)
   where id = p_request_id;
end $fn$;

revoke all on function public.agency_quote_request(uuid, int, int, text, text, text) from public, anon;
grant execute on function public.agency_quote_request(uuid, int, int, text, text, text) to authenticated;

-- ── 확인 ─────────────────────────────────────────────────────────────────
select table_name, column_name from information_schema.columns
 where table_schema='public' and column_name in ('pay_bank','pay_account','pay_holder')
 order by table_name, column_name;   -- 6줄

select proname, pg_get_function_identity_arguments(oid) as 인자
  from pg_proc where proname = 'agency_quote_request';   -- 6-인자 한 줄만
