-- 기존 sales_people 테이블에 ERP가 사용하는 컬럼 추가(없을 때만).
-- 기존 데이터/행은 그대로 유지됩니다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

alter table public.sales_people
    add column if not exists commission_rate numeric default 0,
    add column if not exists is_active boolean default true;

-- (선택) 기존 영업자들의 is_active 가 null 이면 true 로 채움
update public.sales_people set is_active = true where is_active is null;
