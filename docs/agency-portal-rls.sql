-- 대행사 본인 화면(고객 포털 '조직 관리') 읽기 권한 — **추가만** 한다. 2026-08-19
--
-- 무엇을 여는가
--   1) clients        : 대행사가 자기 하위 업체 행을 읽을 수 있게(자기 자신은 기존 정책으로 이미 읽힘)
--   2) agency_invites : 대행사가 자기 초대 코드를 읽을 수 있게(하위 업체에게 직접 전달해야 하므로)
--
-- ⚠️ 기존 정책은 한 줄도 건드리지 않는다. drop 하는 것은 **이 파일이 만든 두 정책뿐**이고
--    (재실행을 위해서다), 이름이 ASCII 라 기존 한글 정책과 절대 겹치지 않는다.
--    정책은 PERMISSIVE 라 여러 개가 OR 로 합쳐진다 — '추가'는 기존 접근을 좁히지 않는다.
--    (정책 DROP 만 실행해 전 테이블 락아웃을 낸 전례 — docs/rls-recover-all.sql)
--
-- 열지 않는 것 — 의도적으로 제외한다
--   · cafe_deploy_credentials : 네이버 계정/비번 평문. 대행사에게 절대 열지 않는다.
--   · client_billing          : 계좌·주민번호.
--   · profiles                : 하위 업체의 로그인 계정 정보.
--   · 하위 업체의 계약·토큰·순위 : 지금 화면에 필요 없다. 필요해지면 한 테이블씩 연다.
--
-- 실행: SQL Editor 에 **전체를 한 번에** 붙여넣고 실행. 재실행해도 안전.
--
-- 적용 이력 (2026-08-19)
--   · 클라우드 · VM 자체호스팅 둘 다 적용 완료. 대행사 세션으로 하위 업체·초대 코드가
--     보이는 것, 하위 업체 세션에서는 남의 조직이 안 보이는 것까지 확인했다.
--   · 클라우드에는 같은 정의의 한글 이름 정책("clients 대행사 하위 읽기",
--     "ai 대행사 본인 읽기")이 먼저 들어가 있어 지금은 **같은 내용이 두 벌** 있다.
--     PERMISSIVE 라 OR 로 합쳐질 뿐 동작·성능에 문제는 없다. 굳이 지우지 않는다
--     (정책 DROP 은 이 저장소에서 사고를 낸 적이 있다 — docs/rls-recover-all.sql).

-- ── 0) 전제 확인 ─────────────────────────────────────────────────────────
--   my_client_id() 가 없으면 아래 두 정책은 만들어져도 아무 행도 통과시키지 못한다.
--   여기서 먼저 걸러야 "실행은 됐는데 화면은 그대로"가 안 생긴다.
select
  to_regprocedure('public.my_client_id()')       as my_client_id_함수,
  to_regclass('public.agency_invites')           as agency_invites_테이블,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='clients' and column_name='parent_client_id')
                                                 as parent_client_id_컬럼;
--   셋 다 null/0 이 아니어야 한다. 하나라도 비면 앞 단계 SQL(agency-org-phase1)이 안 들어간 것이다.

-- ── 1) 하위 업체 읽기 ────────────────────────────────────────────────────
drop policy if exists clients_agency_children_select on public.clients;
create policy clients_agency_children_select on public.clients
  for select to authenticated
  using (parent_client_id = public.my_client_id());

-- ── 2) 자기 초대 코드 읽기 ───────────────────────────────────────────────
--   select 만 연다. 발급·폐기까지 열면 대행사가 소속 근거를 스스로 바꿀 수 있어 정산이 흔들린다.
drop policy if exists agency_invites_own_select on public.agency_invites;
create policy agency_invites_own_select on public.agency_invites
  for select to authenticated
  using (agency_client_id = public.my_client_id());

-- ── 3) 확인 — 이 두 줄이 반드시 나와야 한다 ──────────────────────────────
select tablename, policyname, cmd, permissive, roles::text, qual
  from pg_policies
 where schemaname = 'public'
   and policyname in ('clients_agency_children_select', 'agency_invites_own_select')
 order by tablename;

-- ── 4) 기존 정책이 그대로인지 확인(줄 수가 줄면 안 된다) ─────────────────
select tablename, count(*) as 정책수
  from pg_policies
 where schemaname = 'public' and tablename in ('clients', 'agency_invites')
 group by tablename order by tablename;
