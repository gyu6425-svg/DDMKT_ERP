-- 고객사 정산 계좌(은행/계좌번호) — 민감 정보라 clients 와 분리한 별도 테이블 + 내부 전용 RLS.
--   Supabase > SQL Editor 에서 1회 실행.
--
--   보안 설계:
--     · clients 에 컬럼을 두지 않는다 → 고객 포털의 clients select(본인 업체 읽기)에 절대 섞이지 않음.
--     · RLS = is_internal()(내부 직원)만 select/insert/update/delete. 고객(viewer)·기자단(reporter)은 정책이 없어 접근 불가.
--     · 화면에서는 계좌번호를 마스킹(••••1234) + '보기' 토글로만 노출(어깨너머 방지). 편집/조회는 관리자 화면(계약 상세)에서만.
--     · 저장 시 updated_by(작성자 profile) 기록 → 감사 추적.
--   (Supabase 는 디스크 레벨 AES-256 저장 암호화 기본 적용. 추가로 컬럼 암호화가 필요하면 pgsodium/Vault 도입 가능.)

create table if not exists public.client_billing (
  client_id uuid primary key references public.clients(id) on delete cascade,
  bank_name text,
  account_number text,
  account_holder text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.client_billing enable row level security;

-- 내부 직원만 전체 권한. 고객/기자단은 차단.
--   ⚠️ is_internal() 구버전은 client_id null 인 기자단을 내부로 오인할 수 있어, 정책에서 role=reporter/viewer 를 명시 배제한다.
drop policy if exists "client_billing internal" on public.client_billing;
create policy "client_billing internal" on public.client_billing
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.is_active = true
      and p.client_id is null
      and lower(coalesce(p.role, '')) not in ('reporter', 'viewer')
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.is_active = true
      and p.client_id is null
      and lower(coalesce(p.role, '')) not in ('reporter', 'viewer')
  ));
