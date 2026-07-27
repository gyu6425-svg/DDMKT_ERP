-- 카페 고객 뷰 RLS — 고객(본인 업체)이 자기 카페의 관리 시트·순위 트래커를 읽게.
--   기존 정책은 is_internal() '내부 전체' 뿐 → 고객 로그인은 0행(고객 카페 배포 화면이 항상 '등록된 카페 없음').
--   패턴: 블로그 '고객 본인 읽기'와 동일 — client_id = public.my_client_id().
--   Supabase > SQL Editor 에서 1회 실행. (읽기 전용 정책이라 고객은 수정 불가)

-- cafe_accounts: 본인 업체(client_id)만 조회
drop policy if exists "cafe_accounts 고객 본인 읽기" on public.cafe_accounts;
create policy "cafe_accounts 고객 본인 읽기" on public.cafe_accounts
  for select to authenticated
  using (client_id = public.my_client_id());

-- cafe_rank_posts: 본인 업체 카페 계정(cafe_account_id)의 글만 조회
drop policy if exists "crp 고객 본인 읽기" on public.cafe_rank_posts;
create policy "crp 고객 본인 읽기" on public.cafe_rank_posts
  for select to authenticated
  using (exists (
    select 1 from public.cafe_accounts ca
    where ca.id = public.cafe_rank_posts.cafe_account_id
      and ca.client_id = public.my_client_id()));
