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

-- =====================================================================
-- 진행 건수 카운트 RPC — 기자단 등록 업체(계약 관리 미연동)용
-- 글 보고 승인 시 계약이 없으므로 블로그 자체 잔여(remain_count)를 -1 한다(진행 +1).
-- 외주비는 잡지 않는다(계약 관리 통합 시 별도 등록).
--
-- 단일 UPDATE 문이라 read-modify-write 경합이 없다(동시 승인해도 카운트 유실 없음).
-- SECURITY INVOKER(기본) — RLS가 그대로 적용되므로 blog_accounts update 권한이 있는
--   내부 직원만 실제로 감소시킬 수 있다. 기자단이 호출해도 0행(자기 진행 조작 불가).
--
-- '기자단 등록 업체' 판정을 이 함수 안에 둔다 — 앱과 DB가 서로 다른 정의를 갖지 않도록
--   단일 진실 지점으로. (client_id is null 이라고 다 해당되는 게 아니다: 시트 붙여넣기로
--   등록한 기존 브랜드 블로그도 client_id 가 비어 있을 수 있어 신청 이력까지 확인한다.)
--
-- 반환(jsonb):
--   {"matched": false}                          → 기자단 등록 업체가 아님(호출측은 기존 동작 유지)
--   {"matched": true, "counted": false}          → 대상이지만 차감 안 됨(계약 건수 미입력 또는 잔여 0 소진)
--   {"matched": true, "counted": true, "remain": n} → 잔여 1 차감됨
-- =====================================================================
create or replace function public.count_blog_progress(p_blog_account_id uuid)
returns jsonb
language plpgsql
as $$
declare
    v_matched boolean;
    v_remain integer;
begin
    select true into v_matched
      from public.blog_accounts a
     where a.id = p_blog_account_id
       and a.client_id is null
       and exists (
           select 1 from public.blog_account_requests r
            where r.blog_account_id = a.id and r.status = 'approved'
       );
    if not coalesce(v_matched, false) then
        return jsonb_build_object('matched', false);
    end if;

    -- 잔여가 남아있을 때만 차감 — 이미 0이면 0행(음수 방지 + '차감했다'는 거짓 보고 방지).
    update public.blog_accounts
       set remain_count = coalesce(remain_count, goal_count) - 1
     where id = p_blog_account_id
       and coalesce(remain_count, goal_count) > 0
    returning remain_count into v_remain;

    return jsonb_build_object('matched', true, 'counted', v_remain is not null, 'remain', v_remain);
end;
$$;

grant execute on function public.count_blog_progress(uuid) to authenticated;

-- PostgREST 스키마 캐시 갱신 — 새 테이블/함수가 즉시 API에 잡히도록
--   ("Could not find the table ... in the schema cache" 오류 방지).
notify pgrst, 'reload schema';
