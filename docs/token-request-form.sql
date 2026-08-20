-- 충전 요청에 결제 방식 — 우리↔대행사 · 대행사↔하위 양쪽. 2026-08-20
--
-- 왜 필요한가
--   지금은 '희망 건수 + 메모' 뿐이라, 고객이 어떻게 결제할지를 메모 문장으로 적어 보낸다.
--   담당자는 그 문장을 읽고 계좌를 안내할지 카드 링크를 보낼지 판단해야 하고,
--   나중에 "카드로 받은 건이 몇 건인가" 같은 집계는 아예 불가능하다.
--   → 결제 방식을 컬럼으로 받는다. 메모는 요청사항 전용으로 남긴다.
--
-- 값은 자유 텍스트로 두되 화면에서만 고른다(계좌이체/카드결제/기타).
--   CHECK 로 못박으면 결제 수단이 하나 늘 때마다 배포가 필요하다.
--
-- 실행: SQL Editor. 재실행해도 안전(멱등).

alter table public.cafe_token_requests   add column if not exists pay_method text;
alter table public.agency_token_requests add column if not exists pay_method text;

comment on column public.cafe_token_requests.pay_method is
  '결제 방식(계좌이체/카드결제/기타). 담당자가 안내 방법을 정하고 나중에 수단별 집계를 낼 수 있게 컬럼으로 받는다.';

-- 하위 업체 신청 함수 — 결제 방식 인자 추가.
--   기본값이 있어 옛 앱(2개 인자 호출)도 그대로 동작한다.
--   ※ 옛 시그니처를 남겨두면 호출이 모호해지므로 먼저 지운다.
drop function if exists public.sub_request_tokens(int, text);

create or replace function public.sub_request_tokens(
  p_count      int,
  p_note       text default null,
  p_pay_method text default null
)
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
  if p_count is null or p_count <= 0 or p_count > 100000 then
    raise exception '신청 건수는 1~100,000 사이여야 합니다' using errcode = '22023';
  end if;
  if exists (select 1 from public.agency_token_requests
              where child_client_id = v_me and status in ('pending','quoted','paid')) then
    raise exception '아직 처리 중인 신청이 있습니다 — 완료 후 다시 신청해 주세요' using errcode = '22023';
  end if;

  insert into public.agency_token_requests (child_client_id, agency_client_id, requested_count, note, pay_method)
  values (v_me, v_ag, p_count, nullif(trim(p_note), ''), nullif(trim(p_pay_method), ''))
  returning id into v_id;
  return v_id;
end $fn$;

revoke all on function public.sub_request_tokens(int, text, text) from public, anon;
grant execute on function public.sub_request_tokens(int, text, text) to authenticated;

-- ── 확인 ─────────────────────────────────────────────────────────────────
select table_name, column_name from information_schema.columns
 where table_schema='public' and column_name='pay_method' order by table_name;

select proname, pg_get_function_identity_arguments(oid) as 인자
  from pg_proc where proname = 'sub_request_tokens';   -- 3-인자 한 줄만 나와야 한다
