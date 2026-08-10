-- 신규 고객(모델B) 대상 카페 clubid — SUB2 가 이 값으로 write URL 조립해 고객 카페에 발행.
--   write URL = https://cafe.naver.com/ca-fe/cafes/{clubid}/articles/write?boardType=L
--   board_name(게시판)은 기존 컬럼 사용(매니페스트 board 정확일치). cafe_name 은 표시용.
alter table public.cafe_deploy_requests
    add column if not exists cafe_clubid text;

comment on column public.cafe_deploy_requests.cafe_clubid is
    '고객 카페 clubid(숫자). SUB2 가 write URL 조립용. 온보딩 때 담당자가 입력.';
