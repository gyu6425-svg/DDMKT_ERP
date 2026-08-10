-- 블로그 자동 "임시저장" 대기열 — 웹(블로그 작성기)이 적재 → SUB1 데몬(blog_save_listener.py)이
--   폴링해 네이버 블로그 스마트에디터에 본문/이미지를 채우고 **'저장'(임시저장)까지만** 수행한다.
--   ⚠️ 발행(공개/비공개/예약)은 이 파이프라인의 범위가 아니다. 사람이 임시저장함에서 검수 후 직접 발행한다.
--
-- 카페(cafe_publish_queue)와의 의도적 차이 — 이게 곧 안전장치다:
--   · status 에 'posted'/'done' 이 없다. CHECK 제약이 'posted' insert 를 DB 레벨에서 거부한다.
--   · posted_url 컬럼이 없다. 발행 결과를 기록할 자리 자체가 스키마에 존재하지 않는다.
--   · 파티션 키가 board(게시판)가 아니라 blog_id(블로그 계정). 블로그는 계정=크롬프로필=포트 1:1:1 이다.
--   · 큐를 카페와 절대 공유하지 않는다 — cafe_publish_queue 는 board NULL 행을
--     CAFE_CLAIM_NULL_BOARD=1 인 PC 가 집어가므로, 블로그 원고가 카페에 발행되는 사고 경로가 된다.
--
-- 전제: enable-login-rls.sql / reporter-erp-rls.sql (is_internal 강화판) 적용.

create table if not exists public.blog_save_queue (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),

    blog_account_id uuid references public.blog_accounts(id) on delete set null,
    blog_id text not null,                     -- 네이버 블로그 아이디(예: puleenbe). 워커 소유 파티션 키.
    title text not null,
    manifest jsonb not null default '[]',      -- [{type:'image',path} | {type:'text',text}] 저장 순서(위→아래)

    status text not null default 'pending',    -- pending | processing | saved | fail  (posted/done 없음 — 의도적)
    reason text,                               -- 실패 사유 / 경고
    attempts int not null default 0,           -- 일시오류 재시도 횟수. BLOG_MAX_ATTEMPTS(기본 3) 넘으면 fail.
    claimed_at timestamptz,                    -- 워커가 processing 으로 집은 시각(좀비 판별 근거)
    saved_at timestamptz,                      -- 임시저장 완료 시각
    draft_seq int,                             -- 저장 직후 에디터 헤더의 '저장 N' 카운터 값(사람이 찾을 단서)

    keyword text,
    region text,
    source_output_id uuid references public.blog_outputs(id) on delete set null,  -- 원고 출처(작성기 갤러리)

    -- ⚠️ WITHOUT time zone — cafe-gen-scheduled.sql 과 동일하게 'KST 벽시계' naive 문자열 규약.
    scheduled_at timestamp,

    constraint bsq_status_chk check (status in ('pending','processing','saved','fail'))
);

create index if not exists bsq_status_idx on public.blog_save_queue (status, created_at);
create index if not exists bsq_blog_status_idx on public.blog_save_queue (blog_id, status, created_at);

-- 같은 블로그에 같은 제목이 '진행 중'으로 두 번 들어가는 것 차단(cpq_active_dedup_idx 대응).
--   done/fail 된 과거 건의 재저장은 막지 않는다.
create unique index if not exists bsq_active_dedup_idx
  on public.blog_save_queue (blog_id, title)
 where status in ('pending','processing');

alter table public.blog_save_queue enable row level security;
drop policy if exists "bsq 내부 전체" on public.blog_save_queue;
create policy "bsq 내부 전체" on public.blog_save_queue
    for all to authenticated
    using (public.is_internal()) with check (public.is_internal());

-- 블로그 저장용 이미지 버킷(private) — 웹이 업로드, SUB1 데몬이 다운로드.
--   ⚠️ cafe-images 를 재사용하지 않는다(버킷도 격리 → 카페 발행기가 블로그 이미지를 집을 수 없음).
insert into storage.buckets (id, name, public)
values ('blog-save-images', 'blog-save-images', false)
on conflict (id) do nothing;

drop policy if exists "storage blog-save 내부" on storage.objects;
create policy "storage blog-save 내부" on storage.objects
    for all to authenticated
    using (bucket_id = 'blog-save-images' and public.is_internal())
    with check (bucket_id = 'blog-save-images' and public.is_internal());

-- 롤백:
--   drop policy "storage blog-save 내부" on storage.objects;
--   drop table public.blog_save_queue;
--   delete from storage.buckets where id = 'blog-save-images';

notify pgrst, 'reload schema';
