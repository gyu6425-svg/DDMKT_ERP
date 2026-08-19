-- 대행사 본인 화면(고객 포털 '조직 관리') 읽기 권한 — **추가만** 한다. 2026-08-19
--
-- 무엇을 여는가
--   1) clients        : 대행사가 자기 하위 업체 행을 읽을 수 있게(자기 자신은 기존 정책으로 이미 읽힘)
--   2) agency_invites : 대행사가 자기 초대 코드를 읽을 수 있게(하위 업체에게 직접 전달해야 하므로)
--
-- ⚠️ DROP 이 한 줄도 없다. 정책은 PERMISSIVE 라 여러 개가 OR 로 합쳐진다 —
--    '추가'는 기존 접근을 절대 좁히지 않는다. (정책 DROP 만 실행해 전 테이블 락아웃을 낸
--     전례가 있다 — docs/rls-recover-all.sql)
--
-- 열지 않는 것 — 의도적으로 제외한다
--   · cafe_deploy_credentials : 네이버 계정/비번이 평문으로 들어 있다. 대행사에게 절대 열지 않는다.
--   · client_billing          : 계좌·주민번호.
--   · profiles                : 하위 업체의 로그인 계정 정보.
--   · 하위 업체의 계약·토큰·순위 데이터 : 지금 화면(조직 목록)에 필요 없다.
--     필요해지면 그때 '무엇을 왜 보여줄지' 정하고 한 테이블씩 연다. 미리 열어두지 않는다.
--
-- 실행: Supabase > SQL Editor. 재실행해도 안전(멱등).

-- ── 1) 하위 업체 읽기 ────────────────────────────────────────────────────
--   my_client_id() = 내 profiles.client_id (내부 직원은 null → 이 정책은 아무 행도 안 준다).
--   내부 직원은 별도의 전체 접근 정책으로 이미 보이므로 영향 없다.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'clients' and policyname = 'clients 대행사 하위 읽기'
  ) then
    create policy "clients 대행사 하위 읽기" on public.clients
      for select to authenticated
      using (parent_client_id = public.my_client_id());
  end if;
end $$;

-- ── 2) 자기 초대 코드 읽기 ───────────────────────────────────────────────
--   대행사가 하위 업체에게 코드를 직접 전달해야 한다. 남의 코드는 보이지 않는다.
--   발급·폐기는 열지 않는다(select 만) — 소속 근거를 대행사가 스스로 바꾸면 정산 근거가 흔들린다.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'agency_invites' and policyname = 'ai 대행사 본인 읽기'
  ) then
    create policy "ai 대행사 본인 읽기" on public.agency_invites
      for select to authenticated
      using (agency_client_id = public.my_client_id());
  end if;
end $$;

-- ── 확인 ─────────────────────────────────────────────────────────────────
select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public' and tablename in ('clients', 'agency_invites')
 order by tablename, policyname;
--   기존 정책이 그대로 남아 있고(줄 수가 줄지 않았고), 위 두 개가 추가돼 있어야 한다.
