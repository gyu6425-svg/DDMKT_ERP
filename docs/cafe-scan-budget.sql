-- 점진 스캔 데몬 — 전역 콜 예산 + 스캔 계획.
--   왜: 인기탭 판정은 캐시되면 즉시지만, 캐시가 비어 있으면 고객이 몇 분씩 기다린다.
--       한가할 때 미리 스캔해 두면 온디맨드는 항상 캐시 히트가 된다.
--   ★ 문제: CF egress 는 PC 를 늘려도 안 늘어나는 '단일 버킷'이다(실측 2026-08-06:
--     0.81/1.28/5.78 req/s 로 7배 차이인데 차단은 전부 294~302콜에서 발생 = 약 300콜/10분).
--     그래서 데몬이 마음대로 긁으면 고객 조회가 차단당한다. 예산을 DB 한 곳에서 나눠 준다.
--   Supabase SQL Editor 에서 1회 실행.

-- ① 콜 원장 — 분(minute) 단위 집계. 건별로 쌓으면 하루 4만행이라 분 단위로 누른다(1,440행/일).
create table if not exists public.cafe_scan_budget (
    minute  timestamptz primary key,
    calls   int not null default 0
);

-- ② 예산 예약(원자적) — 최근 10분 사용량을 보고 want 만큼 주되, 한도를 넘지 않는 만큼만 준다.
--    여러 PC(main·SUB4)가 동시에 불러도 UPDATE 잠금으로 한 번에 하나씩 처리되어 총량이 지켜진다.
--    반환 = 실제로 허용된 콜 수(0이면 지금은 긁지 마라).
create or replace function public.scan_budget_take(want int, cap int default 240)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
    used  int;
    grant_n int;
    m     timestamptz := date_trunc('minute', now());
begin
    -- 롤링 10분 사용량. 원장 자체를 잠가 동시 예약이 같은 값을 읽고 둘 다 통과하는 걸 막는다.
    perform pg_advisory_xact_lock(hashtext('cafe_scan_budget'));
    select coalesce(sum(calls), 0) into used
      from cafe_scan_budget
     where minute > now() - interval '10 minutes';

    grant_n := least(want, greatest(cap - used, 0));
    if grant_n > 0 then
        insert into cafe_scan_budget (minute, calls) values (m, grant_n)
        on conflict (minute) do update set calls = cafe_scan_budget.calls + excluded.calls;
    end if;
    return grant_n;
end;
$$;

-- 오래된 원장 정리(하루치만 남긴다). 데몬이 가끔 호출.
create or replace function public.scan_budget_prune()
returns void language sql security definer set search_path = public as $$
    delete from cafe_scan_budget where minute < now() - interval '1 day';
$$;

-- ③ 스캔 계획 — '어떤 제품키워드를 어느 시도까지 미리 봐 둘지'. 계약 제품 기준으로 담당자가 넣는다.
create table if not exists public.cafe_scan_plan (
    id          bigserial primary key,
    product     text not null,              -- 제품키워드. 예: '누수탐지'
    sidos       text not null default '서울,경기,인천',
    include_dong boolean not null default false,
    prio        int  not null default 50,   -- 작을수록 먼저
    active      boolean not null default true,
    last_run_at timestamptz,                -- 데몬이 마지막으로 한 바퀴 돈 시각
    done_count  int not null default 0,     -- 지금까지 판정 완료한 조합 수(진행 표시용)
    note        text,
    created_at  timestamptz not null default now(),
    unique (product, sidos, include_dong)
);

create index if not exists cafe_scan_plan_pick_idx
    on public.cafe_scan_plan (active, prio, last_run_at nulls first);

alter table public.cafe_scan_budget enable row level security;
alter table public.cafe_scan_plan  enable row level security;

-- 내부 직원만. 데몬은 service_key 라 RLS 우회.
drop policy if exists cafe_scan_plan_rw on public.cafe_scan_plan;
create policy cafe_scan_plan_rw on public.cafe_scan_plan
    for all to authenticated
    using (exists (select 1 from public.profiles pr
                   where pr.user_id = auth.uid() and pr.role in ('admin', 'manager', 'sales')))
    with check (exists (select 1 from public.profiles pr
                        where pr.user_id = auth.uid() and pr.role in ('admin', 'manager', 'sales')));

drop policy if exists cafe_scan_budget_read on public.cafe_scan_budget;
create policy cafe_scan_budget_read on public.cafe_scan_budget
    for select to authenticated
    using (exists (select 1 from public.profiles pr
                   where pr.user_id = auth.uid() and pr.role in ('admin', 'manager', 'sales')));

-- ④ 단일 실행 보장(리스) — 데몬이 두 개 뜨면 각자 몫만큼 가져가 예산이 배로 나간다.
--    크래시 재시작 루프를 붙이면 실수로 두 번 뜰 여지가 생기므로 DB 한 곳에서 막는다.
--    리스는 '만료 시각'이 있어, 데몬이 죽으면 자동으로 풀린다(수동 정리 불필요).
create table if not exists public.cafe_scan_lease (
    name   text primary key,
    holder text not null,
    until  timestamptz not null
);

-- 잡거나 갱신. 반환 = 지금 리스를 가진 사람. 내가 아니면 나는 돌면 안 된다.
create or replace function public.scan_lease_take(p_name text, p_holder text, p_sec int default 120)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    cur text;
begin
    perform pg_advisory_xact_lock(hashtext('cafe_scan_lease:' || p_name));
    delete from cafe_scan_lease where name = p_name and until < now();   -- 죽은 소유자 정리
    select holder into cur from cafe_scan_lease where name = p_name;
    if cur is null or cur = p_holder then
        insert into cafe_scan_lease (name, holder, until)
        values (p_name, p_holder, now() + make_interval(secs => p_sec))
        on conflict (name) do update set holder = excluded.holder, until = excluded.until;
        return p_holder;
    end if;
    return cur;
end;
$$;

alter table public.cafe_scan_lease enable row level security;

grant execute on function public.scan_budget_take(int, int) to service_role;
grant execute on function public.scan_budget_prune() to service_role;
grant execute on function public.scan_lease_take(text, text, int) to service_role;

comment on function public.scan_budget_take is
    'CF 단일 버킷(약 300콜/10분)을 여러 PC가 나눠 쓰도록 원자적으로 예약. 반환=허용된 콜 수.';

notify pgrst, 'reload schema';
