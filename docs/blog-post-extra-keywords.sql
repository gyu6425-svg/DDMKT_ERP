-- 블로그 순위 트래커: 글별 '추가 검색 키워드'(우측 1,2,3 슬롯) 저장 + 매 크롤 측정.
--   자동 키워드(keyword/keyword_manual)는 통합/블로그탭 그대로. 여기서 검색해둔 키워드는
--   이 컬럼에 저장돼 다음 크롤부터 함께 측정된다.
--   형태: [{ "keyword": "남구 부부심리상담",
--            "measurements": [{ "date":"2026-07-31","ti":3,"ti_status":"ok","bl":3,"bl_status":"ok" }] }, ...]  (글당 최대 3개)
alter table public.blog_posts
    add column if not exists extra_keywords jsonb;

comment on column public.blog_posts.extra_keywords is
    '트래커 우측에서 검색해 저장한 추가 키워드(최대 3). 크롤러가 매일 함께 측정. [{keyword,measurements[]}]';
