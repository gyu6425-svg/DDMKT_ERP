-- 카카오 가입도 '승인 대기'로 들어오게 — kakao_onboard 재정의
--
-- 왜 필요한가 (실측 2026-08-13)
--   이메일 가입(아이디·비번)은 Edge Function 이 is_active=false 로 만들어 승인 대기에 쌓인다.
--   그런데 카카오 가입은 이 DB 함수를 타는데, 배포된 버전이 계정을 곧바로 활성화하고 있었다.
--     profiles 에 is_active=false 인 행이 한 건도 없음(승인 대기 목록은 그것만 본다)
--     미담공장 08-13 04:28 · is_active=true · onboarded=true · client_id 까지 연결됨
--     훼미리홈데코 · 스마트비즈 · 어퍼모스트 · 올스마케팅 모두 동일
--   그래서 "가입은 계속 들어오는데 승인 요청은 한 번도 안 왔다"가 됐다.
--
-- 저장소의 docs/kakao-login.sql 과 다른 점
--   그 파일의 kakao_onboard 는 인자가 3개(p_role·p_name·p_phone)이고 is_agency 를 안 다룬다.
--   실제 DB 에는 대행사 여부를 저장하는 4-인자 버전이 올라가 있다(미담공장 is_agency=true 가 증거).
--   앱도 4개를 넘긴다(src/api/auth.ts submitKakaoOnboarding).
--   그래서 4-인자 형태는 그대로 두고 '활성화하지 않는다'만 고친다.
--
-- 안전
--   · 이미 활성인 계정은 건드리지 않는다(맨 위 guard + on conflict 에서 is_active 미갱신).
--     이미 쓰고 있는 고객이 이 SQL 때문에 로그아웃되는 일은 없다.
--   · 권한 상승 불가: role 은 viewer/reporter 로만, client_id 는 항상 null.
--   · 여러 번 실행해도 안전(create or replace).

create or replace function public.kakao_onboard(
  p_role text,
  p_name text,
  p_phone text,
  p_is_agency boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid    := auth.uid();
  v_role   text    := case when p_role = 'reporter' then 'reporter' else 'viewer' end;
  v_agency boolean := case when v_role = 'viewer' then coalesce(p_is_agency, false) else false end;
  v_active boolean;
begin
  if v_uid is null then return; end if;

  -- 이미 승인된 계정은 온보딩으로 값을 바꿀 수 없다(자가 권한변경 차단).
  select is_active into v_active from public.profiles where user_id = v_uid;
  if v_active is true then return; end if;

  insert into public.profiles (
    user_id, email, name, role,
    is_active,          -- ★ 항상 false — 관리자 승인 전에는 활성화하지 않는다
    onboarded, duties, sheet_categories,
    client_id,          -- ★ 항상 null — 업체 연결은 승인할 때 관리자가 고른다
    signup_company, phone, is_agency, must_change_password
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
    false
  )
  on conflict (user_id) do update
    set role           = excluded.role,
        name           = excluded.name,
        signup_company = excluded.signup_company,
        phone          = excluded.phone,
        is_agency      = excluded.is_agency,
        onboarded      = true;
        -- is_active·client_id 는 일부러 갱신하지 않는다(승인 결과 보존).
end;
$$;

revoke all on function public.kakao_onboard(text, text, text, boolean) from public;
grant execute on function public.kakao_onboard(text, text, text, boolean) to authenticated;

-- 확인 — 실행 후 아래가 false 여야 한다(신규 카카오 가입이 승인 대기로 들어온다).
--   select prosrc like '%is_active%true%' from pg_proc where proname = 'kakao_onboard';
