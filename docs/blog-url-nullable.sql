-- 블로그 관리시트: URL 없이도 업체를 여러 개 등록할 수 있게 (blog_url NOT NULL 해제)
--
-- 증상 (실측 2026-08-18)
--   블로그 관리시트에서 업체를 추가하면
--     등록 실패: duplicate key value violates unique constraint "blog_accounts_blog_url_key"
--
-- 원인
--   blog_accounts.blog_url 은 NOT NULL + UNIQUE 다.
--   발행 URL 을 안 적으면 앱이 빈 문자열('')로 넣는데, ''도 '값'이라 UNIQUE 에 걸린다.
--   → 'URL 없는 업체'는 전체 통틀어 딱 하나만 존재할 수 있다.
--   실제로 금융책사(2026-08-07 등록)가 그 자리를 차지하고 있어서, 그 뒤로 URL 없이
--   등록하려는 시도가 전부 실패했다.
--
-- 고치는 방법
--   NULL 을 허용한다. Postgres 의 UNIQUE 는 NULL 을 서로 다른 값으로 보므로
--   'URL 미정' 업체가 몇 개든 공존한다. 반면 진짜 URL 의 중복은 그대로 막힌다
--   (같은 블로그를 두 업체로 만드는 사고 방지 — 이건 계속 막혀야 한다).
--
-- 안전
--   · UNIQUE 제약은 건드리지 않는다. 실제 URL 중복 방지는 그대로 살아 있다.
--   · 기존 ''(빈 문자열) 행은 NULL 로 정규화 — 표시·크롤 판정은 이미 빈 값을 걸러낸다
--     (SheetTab isUrlPending: http 로 시작하지 않으면 '미입력'으로 취급).
--   · 여러 번 실행해도 안전.

alter table public.blog_accounts alter column blog_url drop not null;

update public.blog_accounts
   set blog_url = null
 where blog_url is not null
   and btrim(blog_url) = '';

-- 확인
--   ① is_nullable = YES 여야 한다
select column_name, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'blog_accounts' and column_name = 'blog_url';
--   ② URL 미정 업체 목록(이제 여러 건 공존 가능)
select id, name, client_id, blog_url
  from public.blog_accounts
 where blog_url is null
 order by created_at;
