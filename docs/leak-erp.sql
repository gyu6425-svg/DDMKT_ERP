-- 누수탐지 ERP — 상담/작업·정산/통장원장/외주발주 (2026-08-05)
--   설계 근거: docs/누수탐지-ERP-설계.md (구글시트 8탭 독립검증)
--   ⚠️ 핵심 원칙: 정산액은 "계산 컬럼"이 아니라 확정값 스냅샷이다.
--      기존 11건 중 8건이 정의된 30/70 규칙에서 벗어나 있고(20%·22.08% 등),
--      일부는 이미 세금계산서 발행완료 상태라 재계산하면 발행 금액과 어긋난다.
--      → our_share / partner_share 는 반드시 입력값을 그대로 저장한다.
--   접근: 4인 전용(김종인·송민경·조재현·장규진). is_leak_member() 로 게이트.
--   ⚠️ 정책 DROP 만 따로 돌리지 말 것(RLS-on·정책0 = 전체차단 락아웃).

begin;

-- ── 접근 판정 헬퍼 ────────────────────────────────────────────────────────
--   기존 is_internal() 은 내부 직원 전체라 범위가 넓다. 누수 ERP 는 4인 한정이므로 별도 함수.
create or replace function public.is_leak_member()
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid()
      and is_active = true
      and lower(email) in (
        'rlawhddls@ddmkt.com',   -- 김종인(대표)
        'ming99@ddmkt.com',      -- 송민경
        'ddmkt1@ddmkt.com',      -- 조재현
        'gyu6425@gmail.com'      -- 장규진
      )
  );
$$;

-- ── ① 상담/문의 ──────────────────────────────────────────────────────────
create table if not exists public.leak_inquiries (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz,
    counselor text,                                 -- 상담자(내부 직원)
    region text,                                    -- 지역/현장
    phone text,                                     -- 원본 표기
    phone_norm text,                                -- 숫자만 — 작업과 연결하는 유일한 키
    inquired_on date,                               -- 문의일
    leak_type text,                                 -- 누수 종류
    contracted boolean not null default false,      -- 계약성사(진행/미진행)
    source text,                                    -- 유입경로: 카페 | 블로그 | 플레이스 | 기타
    note text
);
-- ⚠️ phone_norm 에 UNIQUE 걸지 말 것 — 기존 데이터에 동일 번호 재문의 2쌍 존재.
create index if not exists li_phone_idx on public.leak_inquiries (phone_norm);
create index if not exists li_inquired_idx on public.leak_inquiries (inquired_on desc nulls last);
create index if not exists li_created_idx on public.leak_inquiries (created_at desc);

-- ── ② 작업 + 정산 ────────────────────────────────────────────────────────
create table if not exists public.leak_jobs (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz,
    inquiry_id uuid references public.leak_inquiries(id) on delete set null,
    site_name text,                                 -- 현장/지역 (시트의 '고객명')
    phone text,
    phone_norm text,
    worked_on date,                                 -- 진행일자
    gross_amount bigint not null default 0,         -- 결제금액(VAT 포함)
    vendor text,                                    -- 집행업체(백준누수 등)
    vendor_phone text,                              -- 타업체 진행 시 연락처
    -- 정산 — 전부 확정값 저장(재계산 금지)
    deduction_amount bigint not null default 0,     -- 자재비 등 공제액
    deduction_note text,                            -- 공제 사유(시트 비고 원문 보존)
    base_amount bigint,                             -- 산정 기준금액(보통 gross - deduction)
    applied_rate numeric(5,2),                      -- 실제 적용 요율(%) — 20 / 30 등
    our_share bigint not null default 0,            -- 든든한누수탐지 확정 정산액
    partner_share bigint not null default 0,        -- 백준누수 확정 정산액(몫만! 기준금액 아님)
    is_rule_exception boolean not null default false,   -- 규칙 이탈 건
    exception_reason text,                          -- 이탈 사유
    settled_on date,                                -- 정산날짜
    invoice_status text not null default '미발행',   -- 미발행 | 발행완료
    note text
);
create index if not exists lj_worked_idx on public.leak_jobs (worked_on desc nulls last);
create index if not exists lj_inquiry_idx on public.leak_jobs (inquiry_id);
create index if not exists lj_phone_idx on public.leak_jobs (phone_norm);

-- ── ③ 통장 원장(일별) ────────────────────────────────────────────────────
--   시트 검증 결과 일별 러닝밸런스는 전 구간 정합(오차 0). 단 월합계 행은 손입력이라 오류 2건.
--   → 월 합계는 저장하지 않고 집계로 산출한다.
create table if not exists public.leak_ledger (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    entry_date date not null,
    inflow bigint not null default 0,               -- 입금(정산 수취)
    outflow bigint not null default 0,              -- 출금
    outflow_kind text,                              -- ⚠️ 잡탕 분해: 외주비|급여|세금|대표인출|기타
    job_id uuid references public.leak_jobs(id) on delete set null,
    memo text,
    unreconciled boolean not null default false     -- 근거 없는 건(예: 50,000 / 575)
);
create index if not exists ll_date_idx on public.leak_ledger (entry_date desc);
create index if not exists ll_job_idx on public.leak_ledger (job_id);

-- ── ④ 외주 발주 ──────────────────────────────────────────────────────────
create table if not exists public.leak_outsourcing (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    item_name text,
    marketing_type text,                            -- 마케팅 분류
    vendor text,
    started_on date,
    ended_on date,
    amount bigint not null default 0,               -- 음수 허용(환불/차감)
    amount_vat bigint not null default 0,
    entry_kind text not null default 'order',       -- order | refund
    settled_to_vendor boolean not null default false,   -- 든든 → 외주업체
    settled_final boolean not null default false,       -- 든든 → 든든 최종
    note text
);
create index if not exists lo_started_idx on public.leak_outsourcing (started_on desc nulls last);

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.leak_inquiries   enable row level security;
alter table public.leak_jobs        enable row level security;
alter table public.leak_ledger      enable row level security;
alter table public.leak_outsourcing enable row level security;

drop policy if exists "leak 상담 4인" on public.leak_inquiries;
drop policy if exists "leak 작업 4인" on public.leak_jobs;
drop policy if exists "leak 원장 4인" on public.leak_ledger;
drop policy if exists "leak 외주 4인" on public.leak_outsourcing;

create policy "leak 상담 4인" on public.leak_inquiries
    for all to authenticated
    using (public.is_leak_member()) with check (public.is_leak_member());
create policy "leak 작업 4인" on public.leak_jobs
    for all to authenticated
    using (public.is_leak_member()) with check (public.is_leak_member());
create policy "leak 원장 4인" on public.leak_ledger
    for all to authenticated
    using (public.is_leak_member()) with check (public.is_leak_member());
create policy "leak 외주 4인" on public.leak_outsourcing
    for all to authenticated
    using (public.is_leak_member()) with check (public.is_leak_member());

commit;

-- 롤백:
-- begin;
-- drop table if exists public.leak_outsourcing, public.leak_ledger, public.leak_jobs, public.leak_inquiries;
-- drop function if exists public.is_leak_member();
-- commit;
