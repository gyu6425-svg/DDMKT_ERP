-- 카카오(소셜) 로그인 도입 — 서버(DB) 준비. Supabase SQL 에디터에서 1회 실행(멱등, 위→아래 순서 그대로).
--   전략: 카카오 OAuth 신규 유저 → 트리거가 '비활성 스텁 프로필' best-effort 생성(is_active=false, onboarded=false)
--         → 앱 온보딩 폼(고객/기자단·이름/업체명·연락처) → kakao_onboard RPC 가 본인 프로필을 upsert(트리거 실패해도 생성)
--         → 기존 승인 대기 목록(list_pending)에 노출 → 관리자 승인(client_id 연결). 이메일 가입 흐름은 그대로.
--   ⚠️ 이메일 가입(create-customer 함수)은 provider='email' 이라 트리거가 건드리지 않는다(중복 방지).
--   ⚠️ is_internal() 은 반드시 role in ('reporter','viewer') 제외 버전 유지(rls-fix-reporter-scope.sql).
--       카카오로 누구나 reporter 스텁을 만들 수 있으므로, 옛 is_internal()(client_id null=내부)로 되돌리면 안 됨.

-- 1) 프로필: user_id 유니크(자동생성/온보딩 경합 방지) + onboarded 플래그 + email nullable(카카오는 이메일 없을 수 있음)
create unique index if not exists profiles_user_id_key on public.profiles (user_id);
alter table public.profiles add column if not exists onboarded boolean not null default true; -- 기존/이메일가입=true
alter table public.profiles alter column email drop not null;                                  -- 카카오 email null 허용

-- 2) 카카오 OAuth 신규 유저 → 비활성 스텁 프로필 생성(이메일 가입 제외). best-effort: 실패해도 로그인은 막지 않음.
create or replace function public.handle_new_oauth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.raw_app_meta_data->>'provider', '') = 'kakao' then
    begin
      insert into public.profiles (user_id, email, name, role, is_active, onboarded, duties, sheet_categories, client_id, must_change_password)
      values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'nickname', '카카오사용자'),
        'viewer', false, false, '{}', '{}', null, false
      )
      on conflict (user_id) do nothing;
    exception when others then
      null; -- 스텁 생성 실패해도 auth.users 삽입(=로그인)은 유지. 프로필은 온보딩 RPC 가 생성한다.
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_kakao on auth.users;
create trigger on_auth_user_created_kakao
  after insert on auth.users
  for each row execute function public.handle_new_oauth_user();

-- 3) 온보딩 upsert RPC — 본인(auth.uid()) 프로필을 생성/보강. 트리거가 실패했어도 여기서 프로필이 반드시 생긴다.
--    보안: is_active 는 항상 false, client_id 는 항상 null, role 은 viewer/reporter 로만 세팅(권한상승·자가활성화 불가).
--          이미 '활성(승인완료)' 프로필이면 아무것도 안 함(승인된 계정 보호).
create or replace function public.kakao_onboard(p_role text, p_name text, p_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_role  text := case when p_role = 'reporter' then 'reporter' else 'viewer' end;
  v_active boolean;
begin
  if v_uid is null then return; end if;
  select is_active into v_active from public.profiles where user_id = v_uid;
  if v_active is true then return; end if; -- 이미 승인된 계정은 온보딩으로 변경 불가

  insert into public.profiles (user_id, email, name, role, is_active, onboarded, duties, sheet_categories, client_id, signup_company, phone, must_change_password)
  values (
    v_uid,
    (select email from auth.users where id = v_uid),
    coalesce(nullif(p_name, ''), '카카오사용자'),
    v_role, false, true, '{}', '{}', null,
    case when v_role = 'viewer' then nullif(p_name, '') else null end,
    nullif(p_phone, ''),
    false
  )
  on conflict (user_id) do update
    set role           = excluded.role,
        name           = excluded.name,
        signup_company = excluded.signup_company,
        phone          = excluded.phone,
        onboarded      = true;   -- is_active·client_id 는 갱신하지 않음(보존)
end;
$$;

revoke all on function public.kakao_onboard(text, text, text) from public;
grant execute on function public.kakao_onboard(text, text, text) to authenticated;
