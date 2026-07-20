-- ═══════════════════════════════════════════════════════════════
-- DDMKT ERP — 미실행 SQL 통합 실행본 (Supabase SQL Editor에 통째로 붙여넣고 실행)
-- 전부 멱등(create if not exists / create or replace / drop policy if exists)이라 이미 적용된 것도 안전하게 재실행됩니다.
-- 순서 = 의존성 순. blog-materials / cafe-publish 실행 후 Storage 버킷도 함께 생성됩니다.
-- ═══════════════════════════════════════════════════════════════


-- ┌───────────────────────────────────────────────────────────
-- │ reporter-erp-rls.sql — 기자단 RLS 기반(is_reporter·my_profile_id·is_internal 강화판) — 최우선
-- └───────────────────────────────────────────────────────────
-- =====================================================================
-- 기자단 전용 ERP 보안 토대 (Reporter Portal scoping) — Supabase SQL Editor에서 실행
-- 목적: 기자단(개인)이 '본인이 담당하는 블로그'만 읽도록 격리.
--       내부 직원/관리자는 기존과 동일(전체 접근). 고객(viewer) 정책도 그대로.
--
-- 모델(확정): 블로그 : 기자단 = N : 1
--   · 기자단 1명이 여러 블로그 담당(한 블로그의 담당 기자단은 정확히 1명).
--   · 그래서 조인 테이블 없이 blog_accounts.reporter_id 단일 컬럼이면 충분.
--   · 발급/배정은 '블로그 통합 관리 시트'(SheetTab)에서(고객=계약 관리, 기자단=블로그 시트).
--
-- ⚠️ 실행 순서대로. is_internal()/my_client_id() 는 enable-login-rls.sql 로 이미 배포됨
--    (모델: '활성 profile + client_id IS NULL = 내부'). 이 파일은 그 모델에 맞춰 reporter만 제외.
--    적용 후 (1) 내부 계정, (2) 고객 계정, (3) 기자단 계정 순으로 데이터 노출을 검증할 것.
-- =====================================================================


-- ========== Section A: 추가만(안전) — 지금 적용 가능 =====================

-- 1) 담당 기자단 컬럼 — 이 블로그를 담당하는 기자단(개인)의 profiles.id.
--    (기존 blog_accounts.reporter 텍스트는 표시/백필용으로 유지)
alter table public.blog_accounts
    add column if not exists reporter_id uuid references public.profiles(id) on delete set null;
create index if not exists blog_accounts_reporter_idx on public.blog_accounts (reporter_id);

-- 2) 로그인한 사용자의 profiles.id (기자단 스코프 기준값).
create or replace function public.my_profile_id()
returns uuid language sql security definer set search_path = public as $$
    select id from public.profiles where user_id = auth.uid() and is_active = true limit 1;
$$;

-- 3) 기자단 여부(역할 = reporter).
create or replace function public.is_reporter()
returns boolean language sql security definer set search_path = public as $$
    select exists (
        select 1 from public.profiles
        where user_id = auth.uid() and lower(coalesce(role,'')) = 'reporter'
    );
$$;


-- ========== Section B: is_internal 강화 — 기자단을 '내부'에서 제외 =========
-- 배포된 is_internal = '활성 profile + client_id IS NULL = 내부'.
--   그런데 기자단(reporter)도 client_id 가 NULL 이라 내부로 오인 →
--   'write 내부' 정책으로 전체 쓰기 권한이 샐 수 있음. role='reporter' 만 추가 제외.
--   (고객(viewer)은 client_id 가 채워져 이미 내부에서 빠짐 — 변경 없음)
-- ⚠️ 적용 후 내부 계정(admin/manager/sales)으로 블로그/고객 데이터 편집이 되는지 확인.
create or replace function public.is_internal()
returns boolean language sql security definer set search_path = public as $$
    select exists (
        select 1 from public.profiles
        where user_id = auth.uid()
          and is_active = true
          and client_id is null
          and lower(coalesce(role,'')) <> 'reporter'
    );
$$;


-- ========== Section C: 기자단 read 정책 — 본인 담당 블로그만 =============
-- write 는 is_internal()(내부)만 가능(위에서 reporter 제외됨) → 기자단은 읽기 전용.

-- blog_accounts: 담당(reporter_id = 내 profiles.id) 만 조회
drop policy if exists "blog_accounts read 기자단" on public.blog_accounts;
create policy "blog_accounts read 기자단" on public.blog_accounts
    for select to authenticated
    using (public.is_reporter() and reporter_id = public.my_profile_id());

-- blog_posts: 글 → 계정 → 담당 기자단
drop policy if exists "blog_posts read 기자단" on public.blog_posts;
create policy "blog_posts read 기자단" on public.blog_posts
    for select to authenticated
    using (
        public.is_reporter() and exists (
            select 1 from public.blog_accounts a
            where a.id = blog_posts.blog_account_id
              and a.reporter_id = public.my_profile_id()
        )
    );

-- blog_keywords: 대표키워드 → 계정 → 담당 기자단
drop policy if exists "blog_keywords read 기자단" on public.blog_keywords;
create policy "blog_keywords read 기자단" on public.blog_keywords
    for select to authenticated
    using (
        public.is_reporter() and exists (
            select 1 from public.blog_accounts a
            where a.id = blog_keywords.blog_account_id
              and a.reporter_id = public.my_profile_id()
        )
    );


-- ========== Section D: 내부 직원이 '기자단 프로필'을 조회 ===============
-- 블로그 시트의 '담당 기자단 지정' 드롭다운·발급 목록에 필요.
--   내부(is_internal)만, role='reporter' 행만 읽기(권한 상승 없음).
drop policy if exists "profiles 내부 기자단 조회" on public.profiles;
create policy "profiles 내부 기자단 조회" on public.profiles
    for select to authenticated
    using (public.is_internal() and lower(coalesce(role,'')) = 'reporter');


-- ========== 배정(관리자 1회, 예시) ======================================
--   실제 배정은 앱의 '블로그 통합 관리 시트'에서 드롭다운으로 처리(Phase 2).
--   수동 예시:
--   update public.blog_accounts set reporter_id = '<기자단 profiles.id>' where id = '<blog_accounts.id>';

-- ┌───────────────────────────────────────────────────────────
-- │ reporter-reports.sql — 글 보고 테이블 정책(기자단 등록/조회/재보고 + 내부 전체)
-- └───────────────────────────────────────────────────────────
-- =====================================================================
-- 기자단 글 보고(blog_post_reports) — Supabase SQL Editor에서 실행
-- 흐름: 기자단이 본인 담당 블로그에 글 URL 보고(insert) → 내부(김다영 등) 알림 →
--       '확인' 시 blog_posts 추적글로 등록(내부가 처리) + 보고 status=confirmed.
-- 전제: reporter-erp-rls.sql (is_reporter/my_profile_id/reporter_id) 이미 적용.
-- =====================================================================

create table if not exists public.blog_post_reports (
    id uuid primary key default gen_random_uuid(),
    blog_account_id uuid not null references public.blog_accounts(id) on delete cascade,
    reporter_id uuid references public.profiles(id) on delete set null,
    post_url text not null,
    title text,
    keyword text,
    status text not null default 'pending', -- pending | confirmed | rejected
    note text,
    created_at timestamptz not null default now(),
    reviewed_at timestamptz,
    reviewed_by uuid references public.profiles(id) on delete set null,
    blog_post_id uuid references public.blog_posts(id) on delete set null -- 확인 시 생성된 추적글
);
create index if not exists bpr_blog_idx on public.blog_post_reports (blog_account_id);
create index if not exists bpr_reporter_idx on public.blog_post_reports (reporter_id);
create index if not exists bpr_status_idx on public.blog_post_reports (status);
alter table public.blog_post_reports enable row level security;

-- 내부(직원/관리자): 전체 관리(조회·확인·반려).
drop policy if exists "bpr 내부 전체" on public.blog_post_reports;
create policy "bpr 내부 전체" on public.blog_post_reports
    for all to authenticated
    using (public.is_internal()) with check (public.is_internal());

-- 기자단: 본인 보고만 조회.
drop policy if exists "bpr 기자단 조회" on public.blog_post_reports;
create policy "bpr 기자단 조회" on public.blog_post_reports
    for select to authenticated
    using (public.is_reporter() and reporter_id = public.my_profile_id());

-- 기자단: 본인(reporter_id=본인) + 본인 담당 블로그(reporter_id 일치)에만 보고 등록.
drop policy if exists "bpr 기자단 등록" on public.blog_post_reports;
create policy "bpr 기자단 등록" on public.blog_post_reports
    for insert to authenticated
    with check (
        public.is_reporter()
        and reporter_id = public.my_profile_id()
        and exists (
            select 1 from public.blog_accounts a
            where a.id = blog_account_id and a.reporter_id = public.my_profile_id()
        )
    );

-- 기자단 재보고: 본인의 '반려(rejected)' 보고만 → '검토중(pending)'으로 되돌리기.
--   with check 로 결과 status 를 pending 으로 강제 → 기자단이 자기 글을 confirmed 로 self-승인 못 함.
drop policy if exists "bpr 기자단 재보고" on public.blog_post_reports;
create policy "bpr 기자단 재보고" on public.blog_post_reports
    for update to authenticated
    using (public.is_reporter() and reporter_id = public.my_profile_id() and status = 'rejected')
    with check (
        public.is_reporter()
        and reporter_id = public.my_profile_id()
        and status = 'pending'
        and exists (
            select 1 from public.blog_accounts a
            where a.id = blog_account_id and a.reporter_id = public.my_profile_id()
        )
    );

-- ┌───────────────────────────────────────────────────────────
-- │ reporter-reports-savetype.sql — 저장/발행 report_type + mark_report_published RPC
-- └───────────────────────────────────────────────────────────
-- 기자단 글 보고 — 저장/발행 구분 컬럼 추가 (2026-07 개편)
--   Supabase 대시보드 > SQL Editor 에서 1회 실행. (실행 전엔 저장/발행 보고가 400 남 — 먼저 실행 필수)
--
--   report_type: 'save'(저장) | 'publish'(발행) — 기자단 히스토리 버킷.
--   published_at: 기자단이 '발행' 처리한 시각(발행 히스토리 표시용).
--   승인(회사) 시 계약 잔여-1 + 외주비 1건이 딱 1회 잡히고(저장·발행 동일),
--   이미 승인된 건을 발행 버튼으로 옮겨도 재계상되지 않음(week키=rpt-<보고id>로 중복 방지).

alter table public.blog_post_reports add column if not exists report_type text not null default 'save';
alter table public.blog_post_reports add column if not exists published_at timestamptz;
create index if not exists blog_post_reports_type_status_idx on public.blog_post_reports (report_type, status);

-- 기존 '발행완료(published)' 데이터는 발행 타입으로 정렬(이미 계약 계상 완료된 건).
update public.blog_post_reports set report_type = 'publish' where status = 'published' and report_type = 'save';

-- 기자단 '발행' 버튼 = 본인 보고를 발행으로 이동(report_type/published_at 만).
--   기존 RLS의 기자단 update 정책은 status='rejected'(재보고)만 허용 → 저장(pending/confirmed)건은
--   0행 업데이트로 조용히 실패했음. 광범위 update 정책을 열면 기자단이 status(승인)까지 바꿀 수 있어 위험하므로,
--   딱 발행 이동만 하는 SECURITY DEFINER 함수로 처리한다(권한 상승 없음).
create or replace function public.mark_report_published(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.blog_post_reports
     set report_type = 'publish', published_at = now()
   where id = p_report_id
     and reporter_id = public.my_profile_id()  -- 본인 보고만
     and status <> 'rejected';                 -- 반려 건은 재보고로 처리
end;
$$;
grant execute on function public.mark_report_published(uuid) to authenticated;

-- ┌───────────────────────────────────────────────────────────
-- │ reporter-reports-round.sql — 회차(round) 컬럼
-- └───────────────────────────────────────────────────────────
-- 기자단 글 보고 — 회차(n회차) 컬럼 추가.
--   Supabase > SQL Editor 에서 1회 실행. (미실행 시 회차 저장이 400)
--   기자단이 글 보고 시 블로그·제목 사이에 '회차'를 입력 → 저장/발행 이력·성과에 표시.

alter table public.blog_post_reports add column if not exists round int; -- 회차(n회차)

-- ┌───────────────────────────────────────────────────────────
-- │ reporter-reports-paid.sql — 입금(paid) 컬럼
-- └───────────────────────────────────────────────────────────
-- 기자단 글 보고 — 외주비 입금(정산) 상태 컬럼 추가.
--   Supabase > SQL Editor 에서 1회 실행. (미실행 시 '외주비 정산' 및 미입금/입금 칩이 동작 안 함)
--
--   흐름: 저장/발행 승인(confirmed) = 8,000원(대박종합주방 10,000) 지급기록 쌓임 · paid=false(미입금)
--         → 회사가 주 단위로 '외주비 정산'(성과 모달) 클릭 → 그 기자단 보고들 paid=true(입금)로 일괄 전환.
--   미입금/입금 칩은 기자단 ERP '정산 내역' + 브랜드블로그 '저장,발행 성과'에서 이 컬럼으로 표시.

alter table public.blog_post_reports add column if not exists paid boolean not null default false; -- 외주비 입금 여부
alter table public.blog_post_reports add column if not exists paid_at timestamptz;                 -- 정산(입금) 처리 시각
create index if not exists blog_post_reports_paid_idx on public.blog_post_reports (paid, status);

-- ⚠️ 보안 전제: '외주비 정산'(paid 갱신)은 blog_post_reports 의 'bpr 내부 전체'(is_internal) 정책으로 내부만 가능.
--   단 is_internal() 구버전은 client_id null 인 기자단을 내부로 오인 → 기자단이 paid 를 조작할 수 있음(상태 무결성 이슈).
--   반드시 reporter-erp-rls.sql Section B(하드닝: role='reporter' 제외)를 먼저 실행해 두어야 이 경로가 닫힌다.

-- ┌───────────────────────────────────────────────────────────
-- │ reporter-reports-blogkind.sql — 블로그 종류(blog_kind)+비브랜드 외주비(out_amount)+가드
-- └───────────────────────────────────────────────────────────
-- 기자단 글 보고: 블로그 종류 + 비-브랜드 외주비 금액
--   blog_kind  : 브랜드 블로그 | 최적화 | 준최적화 | 저인망 배포 (null=브랜드 간주, 구 데이터 호환)
--   out_amount : 비-브랜드 블로그의 외주비 금액(승인 시 담당자가 입력). null이면 브랜드 규칙(8,000/대박종합주방 10,000).
-- 컬럼 추가만 — RLS/정책 변경 불필요(기존 행 정책이 그대로 적용).

alter table public.blog_post_reports add column if not exists blog_kind  text;
alter table public.blog_post_reports add column if not exists out_amount integer;

-- 참고: 기존 승인 건은 blog_kind=null → 브랜드 블로그로 간주되어 외주비 8,000/10,000 규칙이 그대로 유지됩니다.

-- ── 방어심화(독립검증 권고): 기자단은 out_amount를 절대 쓸 수 없게 DB에서 원천 차단 ──
--   RLS는 행 단위라 컬럼을 못 막는다 → 기자단이 insert/update 시 out_amount를 강제로 NULL.
--   (앱 계층 reportOutUnit도 브랜드는 무시하지만, 향후 리팩터/우회 대비 이중 방어.)
create or replace function public.bpr_guard_out_amount()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if public.is_reporter() then
        new.out_amount := null; -- 기자단 주입 차단(외주비는 내부 승인 시에만 설정)
    end if;
    return new;
end;
$$;

drop trigger if exists trg_bpr_guard_out_amount on public.blog_post_reports;
create trigger trg_bpr_guard_out_amount
    before insert or update on public.blog_post_reports
    for each row execute function public.bpr_guard_out_amount();

-- 혹시 남아있을 수 있는 브랜드/구데이터의 out_amount 값 정리(브랜드는 규칙가로 계산되므로 NULL이 정상).
update public.blog_post_reports set out_amount = null
 where out_amount is not null and (blog_kind is null or blog_kind = '브랜드 블로그');

-- ┌───────────────────────────────────────────────────────────
-- │ reporter-reports-paid-guard.sql — 기자단 paid/out_amount 조작 차단 트리거(방어심화)
-- └───────────────────────────────────────────────────────────
-- 방어심화(독립검증 권고): 기자단이 out_amount 뿐 아니라 paid/paid_at(입금 상태)도 조작 못 하게 DB에서 차단.
--   입금 처리는 내부(회사 ERP)에서만. 기자단은 insert 시 미입금 고정, update 시 기존값 유지(변경 무시).
--   RLS가 이미 confirmed 행을 기자단이 못 바꾸게 막지만, 정책 변경/우회 대비 컬럼 단위 이중 방어.

create or replace function public.bpr_guard_out_amount()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if public.is_reporter() then
        new.out_amount := null; -- 외주비 금액은 내부 승인 시에만
        if TG_OP = 'INSERT' then
            new.paid := false; new.paid_at := null; -- 신규 보고는 항상 미입금
        else
            new.paid := old.paid; new.paid_at := old.paid_at; -- 기자단의 paid 변경 무시(기존값 유지)
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_bpr_guard_out_amount on public.blog_post_reports;
create trigger trg_bpr_guard_out_amount
    before insert or update on public.blog_post_reports
    for each row execute function public.bpr_guard_out_amount();

-- ┌───────────────────────────────────────────────────────────
-- │ blog-post-reports-customer-rls.sql — 고객 뷰 보고 읽기 정책
-- └───────────────────────────────────────────────────────────
-- 고객 ERP 성과 탭 — 고객이 '저장,발행 성과'(글 보고 히스토리)를 보려면 본인 업체 블로그의 보고를 읽을 수 있어야 함.
--   Supabase > SQL Editor 에서 1회 실행. (미실행 시 고객 성과 모달의 저장/발행 히스토리가 항상 빈 목록)
--
--   기존 blog_post_reports 정책 = 'bpr 내부 전체'(내부) + 'bpr 기자단 조회'(본인) 뿐 → 고객은 못 읽음.
--   blog_posts '고객 본인 읽기' 정책과 동일 패턴(blog_accounts.client_id = my_client_id()).

drop policy if exists "bpr 고객 본인 읽기" on public.blog_post_reports;
create policy "bpr 고객 본인 읽기" on public.blog_post_reports
  for select to authenticated
  using (exists (
    select 1 from public.blog_accounts ba
    where ba.id = blog_post_reports.blog_account_id
      and ba.client_id = public.my_client_id()));

-- ┌───────────────────────────────────────────────────────────
-- │ clients-advertiser.sql — 광고주/거래처명 등 고객 컬럼
-- └───────────────────────────────────────────────────────────
-- 고객사(clients)에 세금계산서용 '광고주 성함' 컬럼 추가.
--   Supabase > SQL Editor 에서 1회 실행. (미실행 시 광고주 성함 저장/표시 불가)
--   나머지 세금계산서 항목은 기존 필드로 매핑:
--     상호명=거래처명(client_partner) 또는 업체명(company) · 사업자번호=business_number · 담당자 성함=manager
--     담당자 휴대폰=contact(연락처) · 사업장 주소=address · 업종/업태=industry · 이메일=invoice_email/email
--     금액·부가세·상품·외주비·실매출/순매출 = 계약(client_contracts)에서 자동 계산.

alter table public.clients add column if not exists advertiser_name text; -- 광고주 성함(세금계산서)

-- ┌───────────────────────────────────────────────────────────
-- │ client-billing.sql — 고객사 정산 민감정보(계좌·주민번호) 별도테이블 RLS
-- └───────────────────────────────────────────────────────────
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

-- ┌───────────────────────────────────────────────────────────
-- │ reporter-billing.sql — 기자단 정산 민감정보 별도테이블 RLS
-- └───────────────────────────────────────────────────────────
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

-- ┌───────────────────────────────────────────────────────────
-- │ erp-signup.sql — 셀프 회원가입(가입 승인)
-- └───────────────────────────────────────────────────────────
-- 셀프 회원가입(고객/기자단 ERP) — profiles 에 가입 신청 정보 컬럼 추가.
--   Supabase > SQL Editor 에서 1회 실행. (미실행 시 가입 시 signup_company/biz_no 저장이 400)
--
--   흐름: 회원가입(비활성 profiles + auth) → 관리자 승인(is_active=true, 고객은 client_id 연결) → 이용.
--   가입/승인/거절/목록은 모두 Edge Function(create-customer=clever-processor, 서비스롤)로 처리 →
--   RLS 추가 정책 불필요. 본인 프로필 열람은 기존 'profiles self read'(user_id=auth.uid())로 승인 대기 화면 표시.

alter table public.profiles add column if not exists signup_company text;  -- 가입 시 입력한 업체명(관리자 매칭용)
alter table public.profiles add column if not exists signup_biz_no text;   -- 가입 시 입력한 사업자등록번호
alter table public.profiles add column if not exists phone text;           -- 연락처(가입 시 입력, 관리자 확인용)

-- (참고) Edge Function 재배포 필요: create-customer 에 signup/list_pending/approve_signup/reject_signup 액션 추가됨.

-- ┌───────────────────────────────────────────────────────────
-- │ blog-materials.sql — 브랜드블로그 자료 전달(테이블+Storage 버킷+RLS)
-- └───────────────────────────────────────────────────────────
-- 브랜드 블로그 자료 전달 — 우리가 각 블로그(회차)에 전달하는 자료를 등록 → 기자단 ERP에서 받아 글 작성.
--   자료 1건 = 업체명 + 대표키워드(1) + 서브키워드(≤3) + 카테고리(정보성/사례성) + 사진 1~9장.
--   사진 = Supabase Storage(private 버킷 'blog-materials'), 메타·사진목록 = 이 테이블.
--   용량 전략: 클라우드엔 블로그당 최신 5건만 유지, 초과분은 로컬 데몬이 PC로 아카이브(무료 티어 유지).
-- 전제: reporter-erp-rls.sql (is_reporter/my_profile_id/is_internal 강화판) 이미 적용.

-- ── 테이블 ──────────────────────────────────────────────
create table if not exists public.blog_materials (
    id uuid primary key default gen_random_uuid(),
    blog_account_id uuid not null references public.blog_accounts(id) on delete cascade,
    round integer,                              -- 회차(선택). null=공통 자료
    category text not null default '정보성',    -- 정보성 | 사례성
    company_name text,                          -- 업체명(표시용)
    main_keyword text,                          -- 대표키워드 1개
    sub_keywords text[] not null default '{}',  -- 서브키워드 최대 3개
    photos jsonb not null default '[]',         -- [{path,name,size}] 1~9장 (path=Storage 경로)
    uploaded_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now()
);
create index if not exists bm_blog_idx on public.blog_materials (blog_account_id, created_at desc);
alter table public.blog_materials enable row level security;

-- 내부: 전체(조회·등록·수정·삭제)
drop policy if exists "bm 내부 전체" on public.blog_materials;
create policy "bm 내부 전체" on public.blog_materials
    for all to authenticated
    using (public.is_internal()) with check (public.is_internal());

-- 기자단: 본인 담당 블로그의 자료만 조회(읽기 전용)
drop policy if exists "bm 기자단 조회" on public.blog_materials;
create policy "bm 기자단 조회" on public.blog_materials
    for select to authenticated
    using (
        public.is_reporter() and exists (
            select 1 from public.blog_accounts a
            where a.id = blog_materials.blog_account_id
              and a.reporter_id = public.my_profile_id()
        )
    );

-- ── Storage 버킷 (private) ──────────────────────────────
insert into storage.buckets (id, name, public)
values ('blog-materials', 'blog-materials', false)
on conflict (id) do nothing;

-- 내부: blog-materials 버킷 전체(업로드·삭제·조회)
drop policy if exists "storage bm 내부" on storage.objects;
create policy "storage bm 내부" on storage.objects
    for all to authenticated
    using (bucket_id = 'blog-materials' and public.is_internal())
    with check (bucket_id = 'blog-materials' and public.is_internal());

-- 기자단: SELECT만 + 경로 첫 폴더(=blog_account_id)가 본인 담당 블로그인 객체만.
--   경로 규칙: {blog_account_id}/{material_id}/{파일}. 첫 세그먼트 UUID 가드(캐스트 예외 방지).
drop policy if exists "storage bm 기자단 조회" on storage.objects;
create policy "storage bm 기자단 조회" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'blog-materials'
        and public.is_reporter()
        and name ~ '^[0-9a-fA-F-]{36}/'
        and exists (
            select 1 from public.blog_accounts a
            where a.id = ((storage.foldername(name))[1])::uuid
              and a.reporter_id = public.my_profile_id()
        )
    );

-- 검증 순서(대시보드): (1)내부 로그인 → 업로드/조회 OK, (2)고객(viewer) → 0행, (3)기자단 → 본인 블로그만.

-- ┌───────────────────────────────────────────────────────────
-- │ client-contracts-payment.sql — 계약 결제수단(카드매출) 컬럼
-- └───────────────────────────────────────────────────────────
-- 계약 결제수단 — 카드매출 구분. 'card'=카드결제, null=현금/계좌이체(일반, 세금계산서).
--   세금계산서 붙여넣기의 카드 양식으로 등록 시 payment_method='card'로 저장돼 카드 배지로 표시된다.
alter table public.client_contracts add column if not exists payment_method text;

-- ┌───────────────────────────────────────────────────────────
-- │ cafe-publish-queue.sql — 카페 자동발행 대기열 + 이미지 버킷
-- └───────────────────────────────────────────────────────────
-- 카페 자동발행 대기열 — 웹 '카페 발행' 버튼이 적재 → 로컬 데몬(publish_listener.py)이 폴링해
--   스마트에디터로 이미지 순서대로 + 본문 발행. 카카오 report_send_requests와 동형(내부 전용).
-- 전제: enable-login-rls.sql / reporter-erp-rls.sql (is_internal 강화판) 적용.

create table if not exists public.cafe_publish_queue (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    title text not null,
    club_id text,                              -- 카페 clubid(예: demolish0812의 숫자 id)
    menu_id text,                              -- 게시판 menuid
    manifest jsonb not null default '[]',      -- [{type:'image',url} | {type:'text',text}] 게시 순서(위→아래)
    status text not null default 'pending',    -- pending | processing | done | fail
    posted_url text,                           -- 발행된 글 URL(검증 후 기록)
    reason text,                               -- 실패 사유
    scheduled_at timestamptz,                  -- 예약/간격 제어(선택)
    done_at timestamptz
);
create index if not exists cpq_status_idx on public.cafe_publish_queue (status, created_at);
alter table public.cafe_publish_queue enable row level security;

drop policy if exists "cpq 내부 전체" on public.cafe_publish_queue;
create policy "cpq 내부 전체" on public.cafe_publish_queue
    for all to authenticated
    using (public.is_internal()) with check (public.is_internal());

-- 카페 발행용 이미지 버킷(private) — 웹이 생성 이미지 업로드, 로컬 데몬(service_role)이 다운로드.
insert into storage.buckets (id, name, public)
values ('cafe-images', 'cafe-images', false)
on conflict (id) do nothing;

drop policy if exists "storage cafe 내부" on storage.objects;
create policy "storage cafe 내부" on storage.objects
    for all to authenticated
    using (bucket_id = 'cafe-images' and public.is_internal())
    with check (bucket_id = 'cafe-images' and public.is_internal());

-- ┌───────────────────────────────────────────────────────────
-- │ cafe-comment-queue.sql — 카페 댓글 자동화 대기열 (텍스트만, 버킷 없음)
-- └───────────────────────────────────────────────────────────
-- 카페 댓글 자동화 대기열 — 웹 '댓글 예약' 버튼이 적재 → 로컬 데몬(comment_listener.py)이 폴링해
--   대상 글(article_url)에 댓글을 작성한다. cafe_publish_queue 와 동형(내부 전용).
create table if not exists public.cafe_comment_queue (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    account text,                              -- 댓글 달 계정명(accounts.txt 의 name; null=기본 계정)
    article_url text not null,                 -- 댓글 달 카페 글 주소(전체 URL)
    body text not null,                        -- 댓글 내용(텍스트)
    status text not null default 'pending',    -- pending | processing | done | fail
    posted_url text,                           -- 댓글 작성 확인된 글 URL(검증 후 기록)
    reason text,                               -- 실패 사유
    scheduled_at timestamptz,                  -- 예약/간격 제어(선택)
    done_at timestamptz
);
-- 이미 만들어진 테이블에도 계정 컬럼 추가(멀티계정).
alter table public.cafe_comment_queue add column if not exists account text;
create index if not exists ccq_status_idx on public.cafe_comment_queue (status, created_at);
create index if not exists ccq_account_status_idx on public.cafe_comment_queue (account, status, created_at);
alter table public.cafe_comment_queue enable row level security;

drop policy if exists "ccq 내부 전체" on public.cafe_comment_queue;
create policy "ccq 내부 전체" on public.cafe_comment_queue
    for all to authenticated
    using (public.is_internal()) with check (public.is_internal());

-- ┌───────────────────────────────────────────────────────────
-- │ cafe-comment-watch.sql — 카페 댓글 자동화 감시 카페 등록
-- └───────────────────────────────────────────────────────────
-- 워처(watch_new_posts.py)가 이 목록의 카페를 크롤링해 새 글에 댓글을 자동 예약.
create table if not exists public.cafe_comment_watch (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    account text,                              -- 댓글 달 계정(멀티계정 대비; null=기본 계정)
    cafe_url text not null,                    -- 카페 홈 주소(예: https://cafe.naver.com/ddmkt2)
    club_id text,                              -- 카페 clubid(정규화 저장)
    region text not null default '',           -- 댓글 템플릿 {지역}
    keyword text not null default '',          -- 댓글 템플릿 {키워드}
    enabled boolean not null default true,     -- 감시 on/off
    last_seen_article_id bigint,               -- 마지막으로 본 최대 글번호(첫 실행=기준선)
    updated_at timestamptz
);
create index if not exists ccw_enabled_idx on public.cafe_comment_watch (enabled);
alter table public.cafe_comment_watch enable row level security;

drop policy if exists "ccw 내부 전체" on public.cafe_comment_watch;
create policy "ccw 내부 전체" on public.cafe_comment_watch
    for all to authenticated
    using (public.is_internal()) with check (public.is_internal());

-- ┌───────────────────────────────────────────────────────────
-- │ blog-account-requests.sql — 기자단 업체 등록 신청(신청→내부 승인→브랜드 블로그 생성)
-- └───────────────────────────────────────────────────────────
-- =====================================================================
-- 기자단 업체 등록 신청(blog_account_requests) — Supabase SQL Editor에서 실행
-- 흐름: 기자단이 본인이 진행할 업체를 신청(insert) → 내부 알림 →
--       브랜드 블로그 시트 '승인 대기' 탭에서 승인 → blog_accounts 생성
--       (reporter_id = 신청 기자단, client_id = null → 계약 관리엔 안 들어감).
-- 전제: reporter-erp-rls.sql (is_reporter/my_profile_id/is_internal) 이미 적용.
-- =====================================================================

create table if not exists public.blog_account_requests (
    id uuid primary key default gen_random_uuid(),
    reporter_id uuid references public.profiles(id) on delete set null,
    name text not null,                      -- 업체 이름
    blog_url text not null,                  -- 블로그 주소
    contract_count integer,                  -- 계약 건(총 계약 건수) → blog_accounts.goal_count
    progress_count integer,                  -- 진행 건(이미 진행한 건수) → 잔여 = 계약 - 진행
    status text not null default 'pending',  -- pending | approved | rejected
    note text,                               -- 반려 사유
    created_at timestamptz not null default now(),
    reviewed_at timestamptz,
    reviewed_by uuid references public.profiles(id) on delete set null,
    blog_account_id uuid references public.blog_accounts(id) on delete set null -- 승인 시 생성된 블로그
);
create index if not exists bar_reporter_idx on public.blog_account_requests (reporter_id);
create index if not exists bar_status_idx on public.blog_account_requests (status);
alter table public.blog_account_requests enable row level security;

-- 내부(직원/관리자): 전체 관리(조회·승인·반려).
drop policy if exists "bar 내부 전체" on public.blog_account_requests;
create policy "bar 내부 전체" on public.blog_account_requests
    for all to authenticated
    using (public.is_internal()) with check (public.is_internal());

-- 기자단: 본인 신청만 조회.
drop policy if exists "bar 기자단 조회" on public.blog_account_requests;
create policy "bar 기자단 조회" on public.blog_account_requests
    for select to authenticated
    using (public.is_reporter() and reporter_id = public.my_profile_id());

-- 기자단: 본인(reporter_id=본인) 명의로만 신청 등록.
--   status 를 pending 으로 강제 → 기자단이 self-승인(approved) 못 함.
drop policy if exists "bar 기자단 등록" on public.blog_account_requests;
create policy "bar 기자단 등록" on public.blog_account_requests
    for insert to authenticated
    with check (
        public.is_reporter()
        and reporter_id = public.my_profile_id()
        and status = 'pending'
    );

-- 기자단 재신청: 본인의 '반려(rejected)' 신청만 → '검토중(pending)'으로 되돌리기.
--   with check 로 결과 status 를 pending 으로 강제(글 보고 재보고 정책과 동일한 패턴).
drop policy if exists "bar 기자단 재신청" on public.blog_account_requests;
create policy "bar 기자단 재신청" on public.blog_account_requests
    for update to authenticated
    using (public.is_reporter() and reporter_id = public.my_profile_id() and status = 'rejected')
    with check (
        public.is_reporter()
        and reporter_id = public.my_profile_id()
        and status = 'pending'
    );

notify pgrst, 'reload schema';

-- ═══ 끝. Storage: blog-materials · cafe-images 버킷은 위 SQL로 생성됨(private). ═══
