-- 대행사(agency) 구분 — 대행사는 카페 배포 단가가 35,000원(일반 고객 15,000). 회원가입 시 체크 → 프로필·거래처에 저장.
--   Supabase SQL 에디터에서 1회 실행(멱등). ⚠️ create-customer Edge Function 재배포도 필요(signup·approve_signup에 is_agency 반영).

-- 1) 컬럼 추가 — 가입 프로필(신청값) + 거래처(계약·단가 판단 기준).
alter table public.profiles add column if not exists is_agency boolean not null default false;
alter table public.clients  add column if not exists is_agency boolean not null default false;

-- 2) 카카오 온보딩 RPC — is_agency 파라미터 추가(4-arg 오버로드). 기존 3-arg 는 그대로 두어 배포 중 호환.
--    보안: is_active/client_id 불변, role viewer/reporter 제한, 기자단은 is_agency=false 강제.
create or replace function public.kakao_onboard(p_role text, p_name text, p_phone text, p_is_agency boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_role  text := case when p_role = 'reporter' then 'reporter' else 'viewer' end;
  v_active boolean;
  v_agency boolean := case when p_role = 'reporter' then false else coalesce(p_is_agency, false) end;
begin
  if v_uid is null then return; end if;
  select is_active into v_active from public.profiles where user_id = v_uid;
  if v_active is true then return; end if;

  insert into public.profiles (user_id, email, name, role, is_active, onboarded, duties, sheet_categories, client_id, signup_company, phone, must_change_password, is_agency)
  values (
    v_uid,
    (select email from auth.users where id = v_uid),
    coalesce(nullif(p_name, ''), '카카오사용자'),
    v_role, false, true, '{}', '{}', null,
    case when v_role = 'viewer' then nullif(p_name, '') else null end,
    nullif(p_phone, ''), false, v_agency
  )
  on conflict (user_id) do update
    set role           = excluded.role,
        name           = excluded.name,
        signup_company = excluded.signup_company,
        phone          = excluded.phone,
        onboarded      = true,
        is_agency      = v_agency;
end;
$$;

revoke all on function public.kakao_onboard(text, text, text, boolean) from public;
grant execute on function public.kakao_onboard(text, text, text, boolean) to authenticated;
