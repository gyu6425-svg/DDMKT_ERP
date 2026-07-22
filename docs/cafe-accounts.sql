-- 같은 네이버 카페 안의 업체/게시판을 안정적인 company_key로 분리 관리.
-- 계약 전 업체도 등록 가능하며 client_id는 선택 연결이다.
create table if not exists public.cafe_accounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  company_key text not null unique,
  display_name text not null,
  cafe_name text not null default 'ddmkt2',
  club_id text not null default '31754130',
  board_name text not null,
  board_short text not null,
  client_id uuid references public.clients(id) on delete set null,
  active boolean not null default true,
  note text
);

alter table public.cafe_accounts enable row level security;
drop policy if exists "cafe_accounts 내부 전체" on public.cafe_accounts;
create policy "cafe_accounts 내부 전체" on public.cafe_accounts
  for all to authenticated using (public.is_internal()) with check (public.is_internal());

-- 큐에는 manifest의 board 블록과 별도로 조회/동기화용 board 컬럼을 둔다.
alter table public.cafe_publish_queue add column if not exists board text;

alter table public.cafe_rank_posts add column if not exists board text;
alter table public.cafe_rank_posts
  add column if not exists cafe_account_id uuid references public.cafe_accounts(id) on delete set null;
create index if not exists cafe_rank_posts_account_idx on public.cafe_rank_posts(cafe_account_id, published_date desc);

-- 계약 여부와 무관한 기본 운영 업체. client_id는 동일 이름의 고객사가 있으면 연결한다.
insert into public.cafe_accounts(company_key,display_name,cafe_name,club_id,board_name,board_short,client_id)
values
 ('leak','누수','ddmkt2','31754130','누수','누수',(select id from public.clients where company='누수' limit 1)),
 ('dirty','더티클리닉','ddmkt2','31754130','더티클리닉 입주청소','더티클리닉',(select id from public.clients where company='더티클리닉' limit 1)),
 ('seolgo','설고점','ddmkt2','31754130','설고점 소방의 모든 것','설고점',(select id from public.clients where company='설고점' limit 1)),
 ('theman','더맨시스템','ddmkt2','31754130','더맨시스템 시설경호업체','더맨시스템',(select id from public.clients where company='더맨시스템' limit 1))
on conflict(company_key) do update set
 display_name=excluded.display_name,
 cafe_name=excluded.cafe_name,
 club_id=excluded.club_id,
 board_name=excluded.board_name,
 board_short=excluded.board_short,
 client_id=coalesce(public.cafe_accounts.client_id,excluded.client_id);

-- 현재 board 분류를 계정 FK로 연결. 글의 검색 매칭키(cafe_name+article_id)는 변경하지 않는다.
update public.cafe_rank_posts p
set cafe_account_id=a.id
from public.cafe_accounts a
where p.cafe_account_id is null and p.board=a.board_short;