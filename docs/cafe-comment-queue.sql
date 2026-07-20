-- 카페 댓글 자동화 대기열 — 웹 '댓글 예약' 버튼이 적재 → 로컬 데몬(comment_listener.py)이 폴링해
--   대상 글(article_url)에 댓글을 작성한다. cafe_publish_queue 와 동형(내부 전용, 이미지 없음=텍스트만).
-- 전제: enable-login-rls.sql / reporter-erp-rls.sql (is_internal 강화판) 적용.
-- ⚠️ 이 블록은 docs/_RUN_ALL.sql 끝에도 동일하게 들어가야 함(운영자는 _RUN_ALL.sql 만 실행).

create table if not exists public.cafe_comment_queue (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    account text,                              -- 댓글 달 계정명(accounts.txt 의 name; null=기본 계정)
    article_url text not null,                 -- 댓글 달 카페 글 주소(전체 URL)
    body text not null,                        -- 댓글 내용(텍스트)
    status text not null default 'pending',    -- pending | processing | done | fail
    posted_url text,                           -- 댓글 작성 확인된 글 URL(검증 후 기록)
    reason text,                               -- 실패 사유
    scheduled_at timestamptz,                  -- 예약/간격 제어(선택)
    done_at timestamptz
);
-- 이미 만들어진 테이블에도 계정 컬럼 추가(멀티계정) — create if not exists 는 기존 테이블에 무효라 필요.
alter table public.cafe_comment_queue add column if not exists account text;
-- 대댓글(답글) 대상 — 비어 있으면 일반 댓글, 값이 있으면 '그 텍스트를 가진 댓글'에 답글을 단다.
--   대상 식별을 본문 텍스트로 하는 이유: 우리가 단 댓글 문구를 이미 알고 있어 닉네임 매핑이 필요 없다.
alter table public.cafe_comment_queue add column if not exists reply_to_body text;
create index if not exists ccq_status_idx on public.cafe_comment_queue (status, created_at);
-- 계정별 중복판정/조회용
create index if not exists ccq_account_status_idx on public.cafe_comment_queue (account, status, created_at);
alter table public.cafe_comment_queue enable row level security;

drop policy if exists "ccq 내부 전체" on public.cafe_comment_queue;
create policy "ccq 내부 전체" on public.cafe_comment_queue
    for all to authenticated
    using (public.is_internal()) with check (public.is_internal());
