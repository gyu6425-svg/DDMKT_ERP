-- 블로그 발행 스튜디오 업체별 저장 설정 — '값 저장하기'. (카페 cafe_studio_settings 미러)
--   blog_accounts(id) 당 1행. 업체명·업종·홈페이지·카카오 + 계정(네이버아이디/게시판/글쓰기주소/상한/텀)
--   + 이미지 프리셋 경로(메인배너·실사·끝배너, R2 cafe-images 버킷의 studio-settings/blogacct-<id>/…).
--   전제: is_internal() (docs/_RUN_ALL.sql / enable-login-rls.sql) 이미 배포.
--   ⚠️ 전부 additive — 기존 스키마/카페 테이블 수정 없음.

create table if not exists public.blog_studio_settings (
    blog_account_id uuid primary key references public.blog_accounts(id) on delete cascade,
    brand           text,
    business        text,
    homepage        text,               -- 본문 끝 링크카드
    kakao_url       text,               -- 본문 끝 상담 CTA
    naver_id        text,               -- 발행 네이버 아이디(표시·참고. 실제 접속은 발행PC 크롬 프로필 세션)
    blog_name       text,               -- 블로그 표시명
    write_url       text,               -- 글쓰기 주소(postwrite)
    main_banner     jsonb not null default '[]'::jsonb,  -- 상단 배너 경로(1장)
    photos          jsonb not null default '[]'::jsonb,  -- 중간 실사 경로(다수)
    banners         jsonb not null default '[]'::jsonb,  -- 끝 배너 경로(≤2)
    daily_cap       integer default 5,  -- 하루 최대 임시저장 수
    publish_gap_min integer default 30, -- 최소 간격(분)
    chrome_port     integer,            -- 이 블로그 전용 로그인/발행 크롬 포트(업체마다 다른 크롬)
    keyword_pool    jsonb not null default '[]'::jsonb,  -- 키워드 보관함
    naver_login_at  timestamptz,        -- 발행PC 로그인 확인 시각(표시용)
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

alter table public.blog_studio_settings enable row level security;
drop policy if exists "bss 내부 전체" on public.blog_studio_settings;
create policy "bss 내부 전체" on public.blog_studio_settings
    for all to authenticated
    using (public.is_internal()) with check (public.is_internal());
