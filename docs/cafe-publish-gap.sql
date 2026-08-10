-- 발행텀·하루상한 — 모델B(dep_) 고객발행 스케줄 제어. SUB2 poller(_dep_cfg)가 읽음.
--   daily_cap: 하루 최대 발행 수(1~10). 도달 시 그날 중단, 다음날 자동 재개.
--   publish_gap_min: 발행 간 최소 간격(분). 0=제한 없음.
-- main 스튜디오 '값 저장하기'가 이 두 컬럼에 upsert. 컬럼 없어도 나머지 설정은 저장됨(앱 폴백), 이 SQL 실행 후 발행텀 저장 활성화.
alter table cafe_studio_settings add column if not exists daily_cap int;
alter table cafe_studio_settings add column if not exists publish_gap_min int;
-- 모든 업체 하루 최대 발행 5건 기본 세팅(미설정분). 이후 스튜디오에서 개별 변경 가능.
update cafe_studio_settings set daily_cap = 5 where daily_cap is null;
