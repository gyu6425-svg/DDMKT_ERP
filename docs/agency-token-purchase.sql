-- 대행사 토큰 구매 흐름 — 금액 통보 · 입금 신고 · 발행. 2026-08-19
--
-- 흐름 (선불제. 후불은 나중에)
--   1) 대행사가 건수를 신청            status = pending
--   2) 우리가 단가·금액을 통보          status = quoted     (unit_price·amount·quoted_at)
--   3) 대행사가 계좌이체 후 '완료' 신고  status = paid       (paid_declared_at·depositor)
--   4) 우리가 통장 확인 후 토큰 발행     status = done       (handled_at) + cafe_tokens +N
--   반려는 어느 단계에서든 rejected.
--
-- 금액 규칙
--   · amount 는 **공급가(부가세 미포함)** 다. 통보 300,000 이면 실제 입금은 330,000.
--     화면에서 부가세·합계를 따로 보여준다. 여기 컬럼에 VAT 를 섞으면 나중에 세금계산서와 어긋난다.
--   · 단가는 행마다 저장한다. 대행사 10,000 / 일반 15,000 처럼 상대에 따라 다르고,
--     나중에 단가를 바꿔도 과거 거래의 금액 근거가 남아야 한다(하드코딩 금지).
--
-- ⚠️ 기존 RLS 정책은 한 줄도 건드리지 않는다. 컬럼·제약·함수만 추가한다.
--
-- 실행: SQL Editor. 재실행해도 안전(멱등).

-- ── 1) 컬럼 ──────────────────────────────────────────────────────────────
alter table public.cafe_token_requests
  add column if not exists unit_price       int,             -- 통보 단가(원/건)
  add column if not exists amount           int,             -- 공급가 = 건수 × 단가 (부가세 미포함)
  add column if not exists quoted_at        timestamptz,     -- 금액 통보 시각
  add column if not exists quoted_count     int,             -- 통보 기준 건수(신청 건수와 다를 수 있다)
  add column if not exists paid_declared_at timestamptz,     -- 대행사가 '계좌이체 완료' 누른 시각
  add column if not exists depositor        text,            -- 입금자명(통장 대조용)
  add column if not exists granted_count    int;             -- 실제 발행한 건수(부분 발행 대비)

comment on column public.cafe_token_requests.amount is
  '공급가(부가세 미포함). 실제 입금액은 amount * 1.1 — VAT 를 이 컬럼에 섞지 말 것.';

create index if not exists idx_ctr_client_status
  on public.cafe_token_requests (client_id, status);

-- ── 2) 상태값 고정 ───────────────────────────────────────────────────────
--   오타 상태('done ' 같은 것)가 하나 섞이면 목록에서 조용히 사라진다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cafe_token_requests_status_chk') then
    alter table public.cafe_token_requests
      add constraint cafe_token_requests_status_chk
      check (status in ('pending', 'quoted', 'paid', 'done', 'rejected')) not valid;
    alter table public.cafe_token_requests validate constraint cafe_token_requests_status_chk;
  end if;
end $$;

-- ── 3) 입금 신고 ─────────────────────────────────────────────────────────
--   고객에게 UPDATE 정책을 열어주는 대신 함수 하나만 연다.
--   정책을 열면 고객이 status 를 'done' 으로 직접 바꿀 수 있다 — 돈 안 내고 토큰을 받는 길이 열린다.
--   이 함수는 자기 행의 '입금했다는 신고'만 남긴다. 토큰은 절대 여기서 지급하지 않는다.
create or replace function public.declare_token_payment(p_request_id uuid, p_depositor text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v record;
begin
  select * into v from public.cafe_token_requests where id = p_request_id;
  if not found then
    raise exception '요청을 찾을 수 없습니다' using errcode = '22023';
  end if;
  if v.client_id is distinct from public.my_client_id() then
    raise exception '본인 신청만 처리할 수 있습니다' using errcode = '42501';
  end if;
  if v.status not in ('pending', 'quoted') then
    raise exception '이미 처리된 신청입니다(현재 %)', v.status using errcode = '22023';
  end if;

  update public.cafe_token_requests
     set status           = 'paid',
         paid_declared_at = now(),
         depositor        = coalesce(nullif(trim(p_depositor), ''), depositor)
   where id = p_request_id;
end $fn$;

revoke all on function public.declare_token_payment(uuid, text) from public, anon;
grant execute on function public.declare_token_payment(uuid, text) to authenticated;

-- ── 확인 ─────────────────────────────────────────────────────────────────
select column_name from information_schema.columns
 where table_schema='public' and table_name='cafe_token_requests'
   and column_name in ('unit_price','amount','quoted_at','quoted_count','paid_declared_at','depositor','granted_count')
 order by column_name;   -- 7줄이어야 한다

select to_regprocedure('public.declare_token_payment(uuid, text)') as 입금신고_함수;
