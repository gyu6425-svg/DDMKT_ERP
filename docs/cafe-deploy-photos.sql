
-- ============================================================================
-- 카페 배포 접수 사진 업로드 — deploy-intake 스토리지 버킷 + RLS + photos 컬럼
--   고객이 접수 폼에서 메인배너/실사사진/배너를 올리면 본인 client_id 폴더에 저장.
--   내부(is_internal)는 전체 조회·삭제(발행 후 삭제 = 스토리지 회전).
-- ⚠️ 공유 DB — main 에서 검토 후 1회 실행. 재실행 안전(begin/commit + drop→create).
-- 전제: enable-login-rls.sql(is_internal/my_client_id), cafe-deploy-requests.sql 적용됨.
-- ============================================================================
begin;

-- 1) 접수 사진 컬럼(경로 저장): {"main":[...],"real":[...],"banner":[...]}
alter table public.cafe_deploy_requests
  add column if not exists photos jsonb;

-- 2) 비공개 버킷 생성(멱등). 조회는 서명URL로.
insert into storage.buckets (id, name, public)
  values ('deploy-intake', 'deploy-intake', false)
  on conflict (id) do nothing;

-- 3) 스토리지 RLS — 최상위 폴더 = client_id.
drop policy if exists "cdp 고객 업로드" on storage.objects;
drop policy if exists "cdp 고객 조회"  on storage.objects;
drop policy if exists "cdp 내부 조회"  on storage.objects;
drop policy if exists "cdp 삭제"       on storage.objects;

-- 고객: 본인 client_id 폴더에만 업로드/조회.
create policy "cdp 고객 업로드" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'deploy-intake'
              and (storage.foldername(name))[1] = public.my_client_id()::text);
create policy "cdp 고객 조회" on storage.objects
  for select to authenticated
  using (bucket_id = 'deploy-intake'
         and (storage.foldername(name))[1] = public.my_client_id()::text);
-- 내부: 전체 조회(자료 수신).
create policy "cdp 내부 조회" on storage.objects
  for select to authenticated
  using (bucket_id = 'deploy-intake' and public.is_internal());
-- 삭제: 내부(발행 후 정리) 또는 본인 폴더.
create policy "cdp 삭제" on storage.objects
  for delete to authenticated
  using (bucket_id = 'deploy-intake'
         and (public.is_internal()
              or (storage.foldername(name))[1] = public.my_client_id()::text));

commit;

-- 롤백:
-- begin;
--   drop policy if exists "cdp 고객 업로드" on storage.objects;
--   drop policy if exists "cdp 고객 조회"  on storage.objects;
--   drop policy if exists "cdp 내부 조회"  on storage.objects;
--   drop policy if exists "cdp 삭제"       on storage.objects;
--   alter table public.cafe_deploy_requests drop column if exists photos;
--   delete from storage.buckets where id = 'deploy-intake';
-- commit;
