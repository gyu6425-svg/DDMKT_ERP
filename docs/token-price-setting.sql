-- 토큰 기본 단가를 설정값으로 — 1건 = 1토큰 = 15,000원(변경 가능). 2026-08-20
--
-- 왜 코드 상수가 아니라 DB 설정인가
--   단가는 매번 달라질 수 있다(사장님 확인 2026-08-20). 상수로 두면 값 하나 바꾸는 데
--   코드 수정 → 빌드 → 배포가 필요하고, 그동안 담당자는 매 건 손으로 고쳐 넣어야 한다.
--   ★ 거래에 실제로 적용된 단가는 지금도 **행마다 저장**된다(cafe_token_requests.unit_price 등).
--     여기 값은 '통보 화면에 처음 채워지는 기본값'일 뿐이고, 과거 거래를 소급해 바꾸지 않는다.
--
-- 실행: SQL Editor. 재실행해도 안전(멱등).

create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
comment on table public.app_settings is
  '전역 설정. 값이 바뀌어도 과거 거래는 각 행에 저장된 값을 그대로 쓴다(소급 금지).';

insert into public.app_settings (key, value)
values ('token_unit_price', jsonb_build_object('default', 15000))
on conflict (key) do nothing;   -- 이미 정해 둔 값이 있으면 덮어쓰지 않는다

alter table public.app_settings enable row level security;

--   읽기는 로그인한 모두(고객 화면에서 금액 안내에 쓸 수 있게), 쓰기는 내부 직원만.
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select to authenticated using (true);

drop policy if exists app_settings_internal_write on public.app_settings;
create policy app_settings_internal_write on public.app_settings
  for all to authenticated using (public.is_internal()) with check (public.is_internal());

-- ── 확인 ─────────────────────────────────────────────────────────────────
select key, value, updated_at from public.app_settings order by key;
select policyname, cmd from pg_policies where schemaname='public' and tablename='app_settings' order by policyname;
