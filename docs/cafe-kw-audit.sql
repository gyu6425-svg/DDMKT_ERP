-- 카페 인기탭 스캔 자가점검(카나리) 결과 저장 — crawler/cafe_kw_audit.py 가 하루 1회 기록.
--   목적: 오탐·누락·경로회귀를 사람이 눈치채기 전에 잡는다. 로그 파일에만 두면 아무도 안 보므로
--        DB에 남겨 ERP 카페 대시보드 상단에 경고 배너로 띄운다.
--   Supabase SQL Editor 에서 1회 실행.

create table if not exists public.cafe_kw_audit (
    id          bigint generated always as identity primary key,
    run_at      timestamptz not null default now(),
    ok          boolean not null,               -- false = 이상 감지(또는 점검 불가)
    status      text    not null,               -- 'ok' | 'alert' | 'blocked'
    golden_ok   int,                            -- 골든셋 중 정상 확인된 수
    golden_n    int,                            -- 실제 판정된 골든셋 수(차단분 제외)
    golden_undet int,                           -- 차단 등으로 판정 못 한 수
    fn_sample   int,                            -- 음성 재검증 표본 수
    fn_hit      int,                            -- 그중 실제로는 인기탭이던 수(위음성)
    vantage_dis int,                            -- CF vs 직접 불일치 수
    summary     text,
    alerts      jsonb,                          -- 상세 경고 목록
    worker      text                            -- 실행 호스트
);

create index if not exists cafe_kw_audit_run_idx on public.cafe_kw_audit (run_at desc);

alter table public.cafe_kw_audit enable row level security;

-- 내부 직원만 조회(고객 ERP에는 안 보임). service_key(크롤러)는 RLS 우회라 기록은 항상 가능.
drop policy if exists cafe_kw_audit_read on public.cafe_kw_audit;
create policy cafe_kw_audit_read on public.cafe_kw_audit
    for select to authenticated
    using (exists (select 1 from public.profiles pr
                   where pr.user_id = auth.uid() and pr.role in ('admin', 'manager', 'sales')));

notify pgrst, 'reload schema';
