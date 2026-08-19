-- 초대 코드로 대행사 하위 붙이기 — 검증 함수 · 소속 확정 함수 · 카카오 온보딩 확장. 2026-08-19
--
-- 배경: docs/agency-org-phase1.sql 이 agency_invites 테이블과 profiles.signup_invite_code 를 만들었지만
--   '코드를 입력받아 해석하고, 승인 때 parent_client_id 로 확정하는' 경로가 없었다.
--   그래서 대행사 하위 업체가 가입할 방법이 실제로는 없었다(가입폼에 칸조차 없음).
--
-- ⚠️ RLS 정책은 한 줄도 DROP 하지 않는다. 함수만 추가/교체한다.
--    (정책 DROP 만 실행해 전 테이블 락아웃을 낸 전례 — docs/rls-recover-all.sql)
--
-- 왜 코드 검증을 DB 함수로 두는가
--   agency_invites 는 내부 직원만 읽을 수 있다(RLS). 가입은 로그인 전(공개)이라 테이블을 직접 못 읽는다.
--   RLS 를 공개로 여는 것은 전 대행사 코드 목록이 통째로 노출된다는 뜻이라 하면 안 된다.
--   → security definer 함수로 "이 코드 하나가 유효한가"만 묻게 한다. 목록은 못 본다.
--
-- 실행: Supabase > SQL Editor. 재실행해도 안전(멱등).

-- ── 1) 코드 해석 ─────────────────────────────────────────────────────────
--   입력 정규화(대문자·공백제거·DD- 접두 자동보정) 후 유효성 검사.
--   유효하면 {code, agency_client_id, agency} jsonb, 무효면 사람이 읽을 수 있는 예외.
create or replace function public.resolve_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_code text;
  v      record;
  v_name text;
begin
  v_code := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  if v_code = '' then
    return null;                         -- 코드 미입력 = 직거래 가입. 오류가 아니다.
  end if;

  select * into v from public.agency_invites where code = v_code;
  -- 'DD-' 를 빼고 적는 사람이 반드시 나온다. 한 번 더 시도한다.
  if not found and v_code not like 'DD-%' then
    select * into v from public.agency_invites where code = 'DD-' || v_code;
  end if;
  if not found then
    raise exception '초대 코드를 찾을 수 없습니다 — 대행사에서 받은 코드를 다시 확인하세요' using errcode = '22023';
  end if;
  if not v.active then
    raise exception '폐기된 초대 코드입니다 — 대행사에 새 코드를 요청하세요' using errcode = '22023';
  end if;
  if v.expires_at is not null and v.expires_at < now() then
    raise exception '만료된 초대 코드입니다(만료 %)', to_char(v.expires_at, 'YYYY-MM-DD') using errcode = '22023';
  end if;
  if v.max_uses is not null and v.used_count >= v.max_uses then
    raise exception '초대 코드 사용 한도를 다 썼습니다(%/%건) — 대행사에 새 코드를 요청하세요',
      v.used_count, v.max_uses using errcode = '22023';
  end if;

  select company into v_name from public.clients
   where id = v.agency_client_id and coalesce(is_agency, false);
  if v_name is null then
    raise exception '이 코드의 대행사가 더 이상 유효하지 않습니다 — 담당자에게 문의하세요' using errcode = '22023';
  end if;

  return jsonb_build_object('code', v.code, 'agency_client_id', v.agency_client_id, 'agency', v_name);
end $fn$;

-- 공개 노출 금지. 서비스롤(Edge Function)만 직접 호출한다.
--   ※ kakao_onboard 는 security definer 라 내부 호출에 별도 권한이 필요 없다.
revoke all on function public.resolve_invite(text) from public, anon, authenticated;
grant execute on function public.resolve_invite(text) to service_role;

-- ── 2) 소속 확정 ─────────────────────────────────────────────────────────
--   승인 시점에 호출: 업체를 대행사 하위로 붙이고 코드 사용 횟수를 올린다.
--   ★ used_count 는 '가입 신청'이 아니라 '승인'에서 올린다 — 거절된 신청이 한도를 갉아먹으면 안 된다.
--   ★ 증가는 여기서만 한다(update ... +1). REST PATCH 로는 원자적 증가가 안 돼 두 승인이 겹치면 하나가 묻힌다.
create or replace function public.agency_attach_child(
  p_client_id        uuid,
  p_agency_client_id uuid,
  p_code             text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_parent uuid;
begin
  if p_client_id is null or p_agency_client_id is null then return; end if;
  if p_client_id = p_agency_client_id then
    raise exception '자기 자신을 상위로 지정할 수 없습니다' using errcode = '22023';
  end if;
  if exists (select 1 from public.clients where id = p_client_id and coalesce(is_agency, false)) then
    raise exception '대행사로 등록된 업체는 다른 대행사 하위로 붙일 수 없습니다 — 대행사 표시를 먼저 해제하세요'
      using errcode = '22023';
  end if;

  select parent_client_id into v_parent from public.clients where id = p_client_id;
  if v_parent is not null and v_parent <> p_agency_client_id then
    raise exception '이미 다른 대행사 소속입니다 — 조직 트리에서 소속을 먼저 해제하세요' using errcode = '22023';
  end if;

  if v_parent is null then
    -- clients_tree_guard 트리거가 '상위는 대행사여야 한다'를 여기서 다시 검증한다.
    update public.clients set parent_client_id = p_agency_client_id where id = p_client_id;

    -- 이미 붙어 있던 업체를 다시 승인하는 경우엔 카운트하지 않는다(중복 집계 방지).
    if p_code is not null then
      update public.agency_invites set used_count = used_count + 1 where code = upper(p_code);
    end if;
  end if;
end $fn$;

revoke all on function public.agency_attach_child(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.agency_attach_child(uuid, uuid, text) to service_role;

-- ── 3) 카카오 온보딩 — 초대 코드 인자 추가 ───────────────────────────────
--   기존 4-인자 버전을 남긴 채 5-인자(기본값)를 만들면 4개 인자 호출이 **모호(ambiguous)** 해져
--   카카오 가입이 통째로 실패한다. 그래서 옛 시그니처를 먼저 지운다.
--   ※ 배포 순서 안전: 5-인자는 p_invite_code 에 기본값이 있어, 아직 옛 앱(4개 전달)이 떠 있어도 그대로 동작한다.
drop function if exists public.kakao_onboard(text, text, text);
drop function if exists public.kakao_onboard(text, text, text, boolean);

create or replace function public.kakao_onboard(
  p_role        text,
  p_name        text,
  p_phone       text,
  p_is_agency   boolean default false,
  p_invite_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid    := auth.uid();
  v_role   text    := case when p_role = 'reporter' then 'reporter' else 'viewer' end;
  v_agency boolean := case when v_role = 'viewer' then coalesce(p_is_agency, false) else false end;
  v_active boolean;
  v_inv    jsonb;
begin
  if v_uid is null then return; end if;

  -- 이미 승인된 계정은 온보딩으로 값을 바꿀 수 없다(자가 권한변경 차단).
  select is_active into v_active from public.profiles where user_id = v_uid;
  if v_active is true then return; end if;

  -- 초대 코드는 고객만. 대행사가 남의 코드로 들어오면 2단 구조가 깨진다(트리 가드와 같은 규칙).
  if v_role = 'viewer' and coalesce(nullif(p_invite_code, ''), '') <> '' then
    if v_agency then
      raise exception '대행사는 초대 코드로 가입할 수 없습니다 — 둘 중 하나만 선택하세요' using errcode = '22023';
    end if;
    v_inv := public.resolve_invite(p_invite_code);   -- 무효면 여기서 예외 → 가입 자체가 막힌다
  end if;

  insert into public.profiles (
    user_id, email, name, role,
    is_active,          -- ★ 항상 false — 관리자 승인 전에는 활성화하지 않는다
    onboarded, duties, sheet_categories,
    client_id,          -- ★ 항상 null — 업체 연결은 승인할 때 관리자가 고른다
    signup_company, phone, is_agency, must_change_password,
    signup_invite_code, signup_agency_client_id
  )
  values (
    v_uid,
    (select email from auth.users where id = v_uid),
    coalesce(nullif(p_name, ''), '카카오사용자'),
    v_role,
    false,
    true, '{}', '{}',
    null,
    case when v_role = 'viewer' then nullif(p_name, '') else null end,
    nullif(p_phone, ''),
    v_agency,
    false,
    v_inv->>'code',
    (v_inv->>'agency_client_id')::uuid
  )
  on conflict (user_id) do update
    set role                    = excluded.role,
        name                    = excluded.name,
        signup_company          = excluded.signup_company,
        phone                   = excluded.phone,
        is_agency               = excluded.is_agency,
        signup_invite_code      = excluded.signup_invite_code,
        signup_agency_client_id = excluded.signup_agency_client_id,
        onboarded               = true;
        -- is_active·client_id 는 일부러 갱신하지 않는다(승인 결과 보존).
end $fn$;

revoke all on function public.kakao_onboard(text, text, text, boolean, text) from public, anon;
grant execute on function public.kakao_onboard(text, text, text, boolean, text) to authenticated;

-- ── 확인 ─────────────────────────────────────────────────────────────────
select proname, pg_get_function_identity_arguments(oid) as 인자
  from pg_proc where proname in ('kakao_onboard', 'resolve_invite', 'agency_attach_child')
 order by proname;
--   kakao_onboard 는 5-인자 한 줄만 나와야 한다(옛 3·4-인자가 남아 있으면 호출이 모호해진다).

select code,
       (select company from public.clients c where c.id = i.agency_client_id) as 대행사,
       used_count, max_uses, active
  from public.agency_invites i
 order by created_at desc;
