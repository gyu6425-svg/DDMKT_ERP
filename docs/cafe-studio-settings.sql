-- 카페 자동발행 스튜디오: 업체별 발행 설정 저장('값 저장하기').
--   저장 항목: 업체명·업종·홈페이지·유형(지역형/키워드형)·실사사진·마지막배너(스토리지 경로).
--   한 번 저장하면 그 업체 재선택 시 자동 복원. client_id 당 1행(upsert).
create table if not exists public.cafe_studio_settings (
    client_id   uuid primary key,
    brand       text,                 -- 업체명
    business    text,                 -- 업종
    homepage    text,                 -- 홈페이지·링크
    deploy_type text,                 -- 지역형 | 키워드형
    photos      jsonb,                -- 실사사진 storage 경로 배열 (cafe-images 버킷)
    banners     jsonb,                -- 마지막 배너 storage 경로 배열
    updated_at  timestamptz not null default now()
);

alter table public.cafe_studio_settings enable row level security;

-- 내부(담당자)는 전체, 고객은 본인(client_id) 것만 읽고 쓴다. is_internal()/my_client_id() 전제.
drop policy if exists "css 내부 전체" on public.cafe_studio_settings;
create policy "css 내부 전체" on public.cafe_studio_settings
    for all to authenticated using (public.is_internal()) with check (public.is_internal());

drop policy if exists "css 고객 본인" on public.cafe_studio_settings;
create policy "css 고객 본인" on public.cafe_studio_settings
    for all to authenticated using (client_id = public.my_client_id()) with check (client_id = public.my_client_id());

comment on table public.cafe_studio_settings is '카페 발행 스튜디오 업체별 저장 설정(업체명·업종·홈페이지·유형·실사·배너). client_id당 1행.';

-- 2026-07-31: 발행에 재사용할 네이버 로그인 + 발행 게시판 정보 저장(멱등).
alter table public.cafe_studio_settings add column if not exists naver_id   text;  -- 발행 네이버 아이디
alter table public.cafe_studio_settings add column if not exists naver_pw   text;  -- 발행 네이버 비밀번호
alter table public.cafe_studio_settings add column if not exists board_name text;  -- 발행 게시판 이름
alter table public.cafe_studio_settings add column if not exists board_url  text;  -- 발행 게시판 주소
alter table public.cafe_studio_settings add column if not exists kakao_url  text;  -- 카카오톡 상담 링크(본문 끝 CTA)
