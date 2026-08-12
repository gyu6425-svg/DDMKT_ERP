-- 블로그 큐: 저장/발행 선택 (2026-08-12) — 사장님 결정 "보통은 저장인데 발행도 많아서 반반"
--   기존 blog_save_queue 에 mode 를 추가한다. 전부 additive(기존 행은 자동으로 'save').
--
-- 🔴 설계 원칙: 발행을 허용하되 **가드를 걷어내지 않는다.**
--   · 기본값이 'save' 다 → 어디선가 mode 를 안 넣으면 저장으로 떨어진다(fail-closed).
--   · CHECK 제약이 "저장 작업은 절대 '발행됨'으로 기록될 수 없다"를 DB 레벨에서 보증한다.
--     애플리케이션 버그로 발행 경로가 잘못 타더라도, 그 결과를 저장 작업에 기록할 수 없다.
--   · 워커도 BLOG_PUBLISH_ENABLED=1 이 따로 있어야 발행한다(3중 게이트 유지).

alter table public.blog_save_queue
  add column if not exists mode       text not null default 'save',
  add column if not exists posted_url text,          -- 발행 성공 시 글 URL(logNo). 저장 작업은 항상 NULL.
  add column if not exists posted_at  timestamptz;

-- mode 값 제한
alter table public.blog_save_queue drop constraint if exists bsq_mode_chk;
alter table public.blog_save_queue
  add constraint bsq_mode_chk check (mode in ('save', 'publish'));

-- 상태값에 'posted' 추가(발행 완료). 기존 CHECK 를 교체한다.
alter table public.blog_save_queue drop constraint if exists bsq_status_chk;
alter table public.blog_save_queue
  add constraint bsq_status_chk check (status in ('pending','processing','saved','posted','fail'));

-- 🔴 핵심 보증 — 저장 작업은 '발행됨' 으로 기록될 수 없다.
--   발행 결과(posted / posted_url)는 mode='publish' 인 행에만 존재할 수 있다.
alter table public.blog_save_queue drop constraint if exists bsq_posted_requires_publish;
alter table public.blog_save_queue
  add constraint bsq_posted_requires_publish
  check (
    (status <> 'posted' or mode = 'publish')
    and (posted_url is null or mode = 'publish')
  );

create index if not exists bsq_mode_status_idx on public.blog_save_queue (mode, status, created_at);

-- 롤백:
--   alter table public.blog_save_queue drop constraint bsq_posted_requires_publish;
--   alter table public.blog_save_queue drop constraint bsq_mode_chk;
--   alter table public.blog_save_queue drop constraint bsq_status_chk;
--   alter table public.blog_save_queue
--     add constraint bsq_status_chk check (status in ('pending','processing','saved','fail'));
--   alter table public.blog_save_queue drop column mode, drop column posted_url, drop column posted_at;
--   drop index bsq_mode_status_idx;

notify pgrst, 'reload schema';
