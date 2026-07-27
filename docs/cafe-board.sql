-- 카페 순위추적: 게시판(board) 구분 컬럼
-- 동일 카페(마이클의 정보 세상) 안에서 게시판(누수 / 설고점 / 더맨시스템 / 더티클리닉…)별로
-- 순위를 나눠 보기 위한 컬럼. cafe_publish_queue.board / menuid 에서 채운다(cafe_rank_sync.py).
alter table cafe_rank_posts add column if not exists board text;

-- 기존 등록분(전부 누수탐지 글)은 '누수' 게시판으로 채운다. (없는 것만)
update cafe_rank_posts set board = '누수' where board is null;
