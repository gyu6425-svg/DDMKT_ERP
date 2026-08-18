-- 카페 토큰 원장 보호 — 고아 정리 · 이중 발행 차단 · 음수 잔액 차단. 2026-08-18
--
-- 배경: 대행사 되팔이(다단계)를 얹기 전에 원장을 믿을 수 있게 만든다.
--   토큰은 곧 돈이다(1토큰 = 카페 1건 발행권). 지금 원장에는 다음이 실재한다:
--     · 존재하지 않는 고객에게 살아 있는 토큰 24건 (5행)
--     · 같은 접수 하나로 3번 지급된 이력 (+100 × 3, 2026-08-14 금융책사 · 이후 수기 -200 로 수습)
--     · 잔액이 음수가 되는 것을 막는 장치가 DB에 전혀 없음
--
-- ⚠️ 이 파일은 RLS 정책을 **한 줄도 DROP 하지 않는다.** 제약·인덱스·트리거만 추가한다.
--    (정책 DROP 만 실행해 전 테이블 락아웃을 낸 전례 — docs/rls-recover-all.sql)
--
-- 실행: Supabase > SQL Editor. 재실행해도 안전(멱등).

-- ── 0) 실행 전 확인 ──────────────────────────────────────────────────────
select '고아 토큰' as 항목, count(*) as 행, coalesce(sum(t.delta), 0) as 순건수
  from public.cafe_tokens t
  left join public.clients c on c.id = t.client_id
 where c.id is null;

-- ── 1) 고아 토큰 정리 ────────────────────────────────────────────────────
--   clients 에 없는 client_id 를 참조하는 원장 행. 지운 업체에 지급됐던 토큰이 남아
--   총 잔액을 부풀리고, FK 를 걸 수 없게 막는다.
--   ★ 삭제가 아니라 별도 테이블로 옮긴다 — 원장은 회계 근거라 지우면 복원이 안 된다.
create table if not exists public.cafe_tokens_orphan (like public.cafe_tokens including all);
comment on table public.cafe_tokens_orphan is
  '고아 토큰 보관 — clients 가 삭제돼 참조가 끊긴 원장 행. 삭제 대신 여기로 옮긴다(회계 근거 보존).';

insert into public.cafe_tokens_orphan
select t.* from public.cafe_tokens t
  left join public.clients c on c.id = t.client_id
 where c.id is null
   and not exists (select 1 from public.cafe_tokens_orphan o where o.id = t.id);

delete from public.cafe_tokens t
 using (select t2.id from public.cafe_tokens t2
          left join public.clients c on c.id = t2.client_id
         where c.id is null) dead
 where t.id = dead.id;

-- ── 2) FK — 앞으로 고아가 생기지 않게 ────────────────────────────────────
--   on delete restrict: 토큰이 남아 있는 client 는 지울 수 없다.
--   (cascade 로 하면 지급 이력이 조용히 증발한다 — 돈이 사라지는 것과 같다)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cafe_tokens_client_fk') then
    alter table public.cafe_tokens
      add constraint cafe_tokens_client_fk
      foreign key (client_id) references public.clients(id) on delete restrict;
  end if;
end $$;

-- ── 3) 멱등키 — 같은 입금/접수로 두 번 발행되는 사고 차단 ────────────────
--   실측 2026-08-14 금융책사: '토큰 발행' 버튼이 3초·14초 간격으로 3번 눌려 +100 이 3번 들어갔다
--   (계약 100건인데 300건 지급). 지금 방어는 "먼저 읽고 없으면 쓴다"는 애플리케이션 체크뿐이라
--   두 번째 클릭이 첫 번째의 INSERT 전에 읽으면 그대로 통과한다(TOCTOU).
--   → DB 유니크로 못박는다. 기존 행은 idem_key 가 null 이라 partial index 에 걸리지 않는다.
alter table public.cafe_tokens add column if not exists idem_key text;
create unique index if not exists uq_cafe_tokens_idem
  on public.cafe_tokens (idem_key) where idem_key is not null;

-- ── 4) 음수 잔액 차단 ────────────────────────────────────────────────────
--   대행사가 하위에 토큰을 배분할 때(P4) 잔액보다 많이 뿌리는 것을 DB에서 막는다.
--   지금도 화면 검증뿐이라 두 탭에서 동시에 누르면 둘 다 통과한다.
--   ※ 지급(+)은 검사하지 않는다. 차감(-)만 본다.
create or replace function public.cafe_tokens_no_overdraft() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_bal int;
begin
  if new.delta >= 0 then
    return new;
  end if;
  -- 같은 client 원장을 잠가 동시 차감 경합을 막는다(advisory lock — 행 잠금이 아니라 키 잠금).
  perform pg_advisory_xact_lock(hashtextextended(new.client_id::text, 0));
  select coalesce(sum(delta), 0) into v_bal from public.cafe_tokens where client_id = new.client_id;
  if v_bal + new.delta < 0 then
    raise exception '토큰 잔액 부족 — 보유 %건, 요청 %건', v_bal, -new.delta
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_cafe_tokens_no_overdraft on public.cafe_tokens;
create trigger trg_cafe_tokens_no_overdraft
  before insert on public.cafe_tokens
  for each row execute function public.cafe_tokens_no_overdraft();

-- ⚠️ 주의: 이 트리거는 '조정(-)' 회수에도 걸린다. 잔액보다 많이 회수하려면
--    먼저 잔액을 확인하고 가능한 만큼만 회수해야 한다(무한 마이너스 방지가 목적).

-- ── 확인 ─────────────────────────────────────────────────────────────────
select '고아 잔여' as 항목, count(*) as 행 from public.cafe_tokens t
  left join public.clients c on c.id = t.client_id where c.id is null;
select '보관된 고아' as 항목, count(*) as 행, coalesce(sum(delta),0) as 순건수
  from public.cafe_tokens_orphan;
select client_id, sum(delta) as 잔액
  from public.cafe_tokens group by client_id having sum(delta) < 0;   -- 0행이어야 정상
