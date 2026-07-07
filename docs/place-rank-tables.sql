-- 플레이스 순위 트래커 테이블. Supabase SQL 편집기에서 1회 실행.
--   place_accounts = 추적 업체(플레이스 URL/place_id), place_keywords = 업체별 키워드 + 날짜별 순위(measurements).

create table if not exists place_accounts (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references clients(id) on delete set null,  -- 고객사 연결(선택)
    name text,                       -- 업체명
    place_url text,                  -- https://m.place.naver.com/.../1696402748/home
    place_id text,                   -- 1696402748 (URL에서 추출)
    is_active boolean default true,
    created_at timestamptz default now()
);

create table if not exists place_keywords (
    id uuid primary key default gen_random_uuid(),
    place_account_id uuid references place_accounts(id) on delete cascade,
    keyword text,                    -- "인천 내성발톱"
    measurements jsonb default '[]', -- [{"date":"2026-07-07","rank":7,"status":"ok"}]  status: ok|out|fail
    created_at timestamptz default now(),
    unique (place_account_id, keyword)
);

alter table place_accounts enable row level security;
alter table place_keywords enable row level security;

-- 내부 직원(회사 계정)만 전체 접근. is_internal()는 로그인 RLS에서 이미 생성됨.
drop policy if exists place_accounts_internal on place_accounts;
create policy place_accounts_internal on place_accounts for all using (is_internal()) with check (is_internal());
drop policy if exists place_keywords_internal on place_keywords;
create policy place_keywords_internal on place_keywords for all using (is_internal()) with check (is_internal());
