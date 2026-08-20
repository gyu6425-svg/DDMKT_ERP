-- =====================================================================
-- 카페 댓글 계정추가 UI + Cron 셋업 — DB 스키마 (로드맵 1단계)
--   설계: docs/카페댓글-계정UI-설계.md (독립검증 반영)
--   흐름: UI가 cafe_account_request 에 요청 적재(queued) → 로컬 Cron 핸들러
--         (process_account_requests.py, service_role)가 상태머신으로 처리.
-- ⚠ 이 블록은 docs/_RUN_ALL.sql 끝에도 동일하게 추가해야 함(운영자는 _RUN_ALL.sql 만 실행).
-- 전제: enable-login-rls.sql 의 public.is_internal() 이미 적용.
-- 보안(독립검증 반영):
--   · Cron 핸들러는 SUPABASE_SERVICE_KEY 로 접속 → RLS/컬럼GRANT 전부 우회(모든 필드 기록 가능).
--   · 브라우저(authenticated)는 naver_id·assignments 로 '요청 생성' + user_action 으로 '완료신호'만.
--     port/profile_dir/status/log/lease 는 클라이언트가 못 씀(컬럼 GRANT + INSERT check 로 강제).
--   · naver_id↔업체 매핑은 민감 → 목록을 커밋 SQL/문서에 seed 하지 말 것(런타임 insert 만).
--
-- 적용 이력: 2026-08-20 자체호스팅 VM(db.ddmktcloud.com)에 적용 완료.
-- =====================================================================

-- ── 1) 고정업종을 코드(accounts.py) 대신 DB 로 (기본 NULL) ──────────────
--   ⚠ 기본값을 '' 로 두면 business_for 가 '고정업종 있음'으로 오인해 classify 를 건너뛴다 → 반드시 NULL.
alter table public.cafe_comment_watch
    add column if not exists business text;     -- 전용카페 고정업종(NULL=제목 자동분류)

-- ── 2) 카페별 '댓글 제외' 계정 — 코드맵 COMMENT_EXCLUDE_BY_CAFE 의 DB 이전 ──
--   극성 유지: 기본 포함(전 계정 fan-out) − 여기 등록된 (account,club_id) 만 제외.
--   accounts.py 는 코드맵 ∪ 이 테이블 로 읽되 의미론 동일(하위호환).
create table if not exists public.cafe_comment_exclude (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    account text not null,                      -- 제외할 댓글 계정(accounts.txt name)
    club_id text not null,                      -- 그 카페 clubid
    note text,                                  -- 사유(미가입 등)
    unique (account, club_id)                   -- 중복 방지
);
create index if not exists cce_club_idx on public.cafe_comment_exclude (club_id);
alter table public.cafe_comment_exclude enable row level security;
drop policy if exists "cce 내부 전체" on public.cafe_comment_exclude;
create policy "cce 내부 전체" on public.cafe_comment_exclude
    for all to authenticated
    using (public.is_internal()) with check (public.is_internal());

-- ── 3) 계정 셋업 요청/상태머신 ─────────────────────────────────────────
--   status: queued → prepping → awaiting_login → login_verified → awaiting_join
--           → (join_incomplete ↺) → registering → active_canary → active
--           → error / expired / canceled (teardown)
create table if not exists public.cafe_account_request (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz,
    -- 클라이언트가 쓰는 것(요청 내용) ---------------------------------
    naver_id text not null,                     -- 추가할 네이버 아이디
    assignments jsonb not null default '[]'::jsonb,  -- [{club_id, business, region, keyword}] (cafe=watch 등록분 allowlist)
    -- 완료신호(클라이언트가 버튼으로 set, 핸들러가 소비 후 즉시 클리어) --------
    user_action text,                           -- login_done | join_done | null
    -- 핸들러(cron) 전용 — 클라이언트 쓰기 금지(컬럼 GRANT 로 차단) -----------
    status text not null default 'queued',
    port int,                                   -- 핸들러 생성(9224+; 예약 9222/9223 금지)
    profile_dir text,                           -- 핸들러 생성(chrome_profile_<sanitized-id>)
    stage_detail jsonb not null default '{}'::jsonb,  -- UI 표시용 '코드값'만(미가입 club_id 목록·사유코드)
    processing_by text,                         -- 락: 처리중 세션 id
    lease_until timestamptz,                    -- 락 리스 만료(재진입 방지)
    deadline timestamptz,                       -- 인터랙티브 게이트(awaiting_*) 만료
    log jsonb not null default '[]'::jsonb       -- 감사로그 '코드값'만(원시 HTML/URL/스크린샷/ID 금지)
);
create index if not exists car_status_idx on public.cafe_account_request (status);
create index if not exists car_lease_idx on public.cafe_account_request (lease_until);
alter table public.cafe_account_request enable row level security;

-- RLS: 내부 조회(전체). 세부 쓰기 제약은 아래 정책 + 컬럼 GRANT 로.
drop policy if exists "car 내부 조회" on public.cafe_account_request;
create policy "car 내부 조회" on public.cafe_account_request
    for select to authenticated
    using (public.is_internal());

-- 등록: 내부만, 그리고 '안전한 초기상태'로만 생성 강제.
--   status=queued 고정, 핸들러 전용필드(port/profile/lease/processing)는 비워서만 insert.
--   (blog_account_requests 의 'status=pending 강제' 패턴과 동일.)
drop policy if exists "car 내부 등록" on public.cafe_account_request;
create policy "car 내부 등록" on public.cafe_account_request
    for insert to authenticated
    with check (
        public.is_internal()
        and status = 'queued'
        and port is null
        and profile_dir is null
        and processing_by is null
        and lease_until is null
    );

-- 갱신: 내부만(행 범위). '어떤 컬럼'을 바꿀 수 있는지는 컬럼 GRANT 로 제한(아래).
drop policy if exists "car 내부 갱신" on public.cafe_account_request;
create policy "car 내부 갱신" on public.cafe_account_request
    for update to authenticated
    using (public.is_internal())
    with check (public.is_internal());

-- ── 4) 컬럼-레벨 GRANT: 브라우저(authenticated)는 user_action 만 UPDATE 가능 ──
--   status/port/profile_dir/stage_detail/log/processing_by/lease_until/deadline 은
--   Cron 핸들러(service_role, RLS/GRANT 우회)만 쓴다 → 브라우저 명령주입 차단(독립검증 M1/M2).
revoke update on public.cafe_account_request from authenticated;
grant  update (user_action) on public.cafe_account_request to authenticated;
-- ★ INSERT 도 반드시 먼저 revoke — 컬럼 GRANT 는 '더하기'라서, 테이블 단위 INSERT 가 이미 있으면
--   아무 제한도 하지 못한다. Supabase 는 public 스키마 전체에 authenticated 기본권한을 준다.
--   (2026-08-20 적용 중 실측: revoke 전 authenticated 의 INSERT 가능 컬럼이 14개 전부였다.
--    RLS INSERT check 가 status·port·profile_dir·processing_by·lease_until 은 막지만
--    log·stage_detail·deadline 은 안 막으므로, 감사로그 위조와 만료시각 연장이 가능했다.)
revoke insert on public.cafe_account_request from authenticated;
grant  insert (naver_id, assignments, user_action) on public.cafe_account_request to authenticated;
grant  select on public.cafe_account_request to authenticated;
--   DELETE 는 RLS 에 정책이 없어 차단된다(정책 없음 = 거부). TRUNCATE 는 RLS 대상이 아니지만
--   이 스키마 전체에 걸린 기본권한이라 이 테이블만의 문제가 아니다(별건).

-- =====================================================================
-- 적용 후 확인:
--   select column_name from information_schema.columns
--     where table_name='cafe_comment_watch' and column_name='business';   -- business 존재
--   \d+ public.cafe_account_request                                        -- 컬럼/정책 확인
-- 다음 단계(로드맵 2): process_account_requests.py (결정적 핸들러, 락/리스, teardown).
-- =====================================================================
