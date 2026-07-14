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
