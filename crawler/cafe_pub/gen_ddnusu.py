# -*- coding: utf-8 -*-
"""새 누수 카페(leak3) 매일 자동생성 — 예약작업이 매일 호출.
   ★★sub2는 네이버 순위 크롤/측정 절대 금지(main과 IP충돌)★★ → 여기서는 search.naver 스캔을 절대 안 한다.
   대신 '사전 검증된 인기글 지역 목록(CURATED)'에서만 발행한다. 노출 측정은 main 크롤러가 자동으로 함.
   FRESH_REGIONS=1: 이미 leak3 큐에 넣은 지역은 제외(재발행 방지). 발행은 listener_ddnusu 가 10~19시에."""
import os, sys, random
CAFE = os.path.dirname(os.path.abspath(__file__))
os.environ['CAFE_COMPANY'] = 'leak3'
os.environ['CAFE_BOARD'] = '누수탐지 후기·시공사례'
os.environ['CAFE_FRESH_REGIONS'] = '1'
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, CAFE); os.chdir(CAFE)
import cafe_auto_publish_nusu2 as N

DAILY_TARGET = 8   # 하루 큐 목표(리스너 간격이 실제 발행을 5~6개로 캡, 초과분은 다음날 버퍼)

# 사전 검증된 인기글 지역(스캔 없이 이 목록만). 서울 자치구는 확인된 형태로(구/짧은형).
#   ※ 노출 안 되는 지역은 main 측정 데이터 보고 이 목록에서 빼면 된다(스캔 대체).
CURATED = [
    # 서울 자치구(확인된 형태)
    '광진구', '강서구', '영등포',
    # 수도권 시·신도시(구 누수카페에서 인기글 검증됐던 지역들)
    '과천', '안산', '용인', '부천', '고양', '성남', '안양', '평택', '시흥', '김포', '화성',
    '남양주', '의정부', '파주', '광명', '군포', '의왕', '하남', '구리', '오산', '이천',
    '안성', '수원', '일산', '분당', '청라', '송도', '미사', '위례', '판교', '동탄',
    '영종', '배곧', '별내', '운정', '인천 서구', '인천 남동구', '인천 부평', '인천 계양구',
    '인천 연수구', '인천 미추홀구',
]


def main():
    done = N.published_regions()   # FRESH 모드 → leak3 큐에 이미 있는 지역만 제외
    def is_done(r):
        base = r[:-1] if (r.endswith('구') and r[:-1] in N.SEOUL_GU) else r
        return r in done or base in done
    todo = [r for r in CURATED if not is_done(r)]
    random.shuffle(todo)
    N._log(f"=== 매일 자동생성(스캔 없음·사전검증 지역) · 후보 {len(todo)}개 · 목표 {DAILY_TARGET}건 ===")
    made = 0
    for reg in todo:
        if made >= DAILY_TARGET:
            break
        try:
            N.make_and_queue(reg, popular_verified=True)   # 스캔 없이 사전검증분으로 큐 적재
            made += 1
        except Exception as e:
            N._log(f"  skip {reg}: {str(e)[:70]}")
    N._log(f"=== 완료: {made}건 큐 적재. listener_ddnusu 가 10~19시에 발행 ===")


if __name__ == '__main__':
    main()
