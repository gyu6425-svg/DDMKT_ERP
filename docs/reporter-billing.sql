-- 기자단 정산 정보(은행/계좌번호/주민번호) — 최고 민감정보(주민번호 포함)라 별도 테이블 + 내부 전용 RLS.
--   Supabase > SQL Editor 에서 1회 실행.
--
--   보안 설계(client_billing 과 동일 원칙):
--     · profiles 나 blog_accounts 에 컬럼을 두지 않는다 → 기자단 포털(본인 조회)에 절대 섞이지 않음.
--     · RLS = is_internal()(내부 직원)만 전체 권한. 기자단(reporter)·고객(viewer)은 정책 없음 → 완전 차단.
--       (기자단이 '기자단 계정 관리' 화면을 못 열고, 열더라도 RLS 로 계좌/주민번호를 못 읽음.)
--     · 화면: 계좌번호·주민번호는 마스킹(주민번호 뒤 7자리 ••••••) + '보기' 토글로만 노출. 편집은 관리자만.
--     · updated_by 로 작성자 감사.
--   (Supabase 디스크 AES-256 저장 암호화 기본. 주민번호는 법적으로 민감 → 추가 컬럼 암호화 필요 시 pgsodium/Vault.)

create table if not exists public.reporter_billing (
  reporter_id uuid primary key references public.profiles(id) on delete cascade,
  bank_name text,
  account_number text,
  rrn text, -- 주민등록번호(민감) — 마스킹 표시, 내부 전용
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.reporter_billing enable row level security;

-- ⚠️ 정책은 is_internal() 에 '의존하지 않고' 자체 완결로 판정한다.
--   이유: is_internal() 구버전(enable-login-rls.sql)은 'client_id is null'만 봐서 기자단(client_id null)을 내부로 오인 →
--        기자단이 다른 기자단의 계좌/주민번호를 읽을 수 있는 CRITICAL 누수. 여기서 role=reporter/viewer 를 명시 배제한다.
--   = 활성 프로필 + client_id null(내부 직원) + role 이 reporter/viewer 아님.
drop policy if exists "reporter_billing internal" on public.reporter_billing;
create policy "reporter_billing internal" on public.reporter_billing
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
