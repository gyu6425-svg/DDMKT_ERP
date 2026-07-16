-- 카페 순위 추적 — 자사 카페 글의 네이버 통합탭 순위 측정 저장.
--   블로그(blog_posts) 패턴 복제하되 플레이스처럼 얇게(계정 테이블 없음, 단일 카페).
--   측정 = 통합탭(ti)만. 카페 전용탭(ssc=tab.m_cafe.all)은 봇 GET 파싱 불가라 미측정.
--   measurements 기록은 크롤러(service_role)만. 웹은 행 등록/삭제 + keyword_manual 수정.

create table if not exists public.cafe_rank_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  club_id text,                      -- 숫자 클럽ID (예: 31754130) — 발행 URL 유래
  cafe_name text,                    -- vanity 슬러그 (예: ddmkt2) — SERP 매칭키
  article_id text not null,          -- 글 번호 (예: 13)
  post_url text,                     -- 원본 글 URL
  title text,
  keyword text,                      -- 자동/생성기 유래 측정 키워드
  keyword_manual text,               -- 수동 보정(있으면 크롤이 우선 사용)
  published_date date,
  excluded boolean not null default false,   -- 트래커 소프트 삭제(측정 제외)
  client_id uuid references public.clients(id) on delete set null,
  -- 측정 누적: [{date, ti, ti_status}]  (ti=통합탭 순위, status=ok|out|fail)
  measurements jsonb not null default '[]'::jsonb,
  unique (cafe_name, article_id)
);

create index if not exists cafe_rank_posts_pub_idx on public.cafe_rank_posts (published_date desc);

alter table public.cafe_rank_posts enable row level security;

-- 내부 직원 전체 접근(크롤러는 service_role 로 RLS 우회하여 measurements 기록).
drop policy if exists "crp 내부 전체" on public.cafe_rank_posts;
create policy "crp 내부 전체" on public.cafe_rank_posts
  for all to authenticated
  using (public.is_internal())
  with check (public.is_internal());
