# -*- coding: utf-8 -*-
"""더반클린 입주청소(durban) 매일 자동생성 — 예약작업이 매일 호출.
   ★★sub2는 네이버 순위 크롤/측정 절대 금지(main과 IP충돌)★★ → search.naver 스캔 안 함.
   사전검증 지역 목록(CURATED)에서만 발행. 노출 측정은 main 크롤러가 함.
   FRESH_REGIONS=1: 이미 durban 큐에 넣은 지역은 제외(재발행 방지). 발행은 run_cafe_listener_durban.bat 이 10~19시에.
   ※ 구 gen(cafe_auto_publish_durban.py=스캔방식)은 폐기. 이 파일이 ddclean(CURATED)로 대체."""
import os, sys, random
CAFE = os.path.dirname(os.path.abspath(__file__))
os.environ['CAFE_COMPANY'] = 'durban'
os.environ['CAFE_BOARD'] = '더반클린 입주청소'
os.environ['CAFE_FRESH_REGIONS'] = '1'
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, CAFE); os.chdir(CAFE)
import cafe_auto_publish_ddclean as D

DAILY_TARGET = 8   # 하루 큐 목표(리스너 간격 60~90분이 실제 발행을 6~8개로 캡)

# 사전검증 수도권 지역(스캔 없이 이 목록만). 상단 배너는 지역→경기/인천/서울 CTA 자동 매칭.
#   ※ 노출 안 되는 지역은 main 측정 보고 여기서 빼면 됨.
CURATED = [
    # 서울 자치구
    '강서구', '광진구', '송파', '강동', '마포', '영등포', '양천', '노원',
    # 경기 시(→ 경기 배너)
    '과천', '수원', '성남', '용인', '안양', '부천', '고양', '하남', '광명', '안산',
    '화성', '김포', '남양주', '의왕', '군포', '시흥', '의정부', '파주', '구리', '오산', '평택',
    # 신도시(이미 동네급)
    '분당', '판교', '동탄', '위례', '미사', '일산',
    # 인천(→ 인천 배너)
    '인천 서구', '인천 남동구', '인천 연수구', '인천 부평', '인천 계양구',
]


def main():
    done = D.published_regions()   # FRESH 모드 → durban 큐에 이미 있는 지역만 제외
    def is_done(r):
        base = r[:-1] if (r.endswith('구') and r[:-1] in D.SEOUL_GU) else r
        return r in done or base in done
    todo = [r for r in CURATED if not is_done(r)]
    random.shuffle(todo)
    D._log(f"=== 더반 매일 자동생성(스캔 없음·사전검증 지역) · 후보 {len(todo)}개 · 목표 {DAILY_TARGET}건 ===")
    made = 0
    for reg in todo:
        if made >= DAILY_TARGET:
            break
        try:
            D.make_and_queue(reg, popular_verified=True)   # 스캔 없이 사전검증분으로 큐 적재
            made += 1
        except Exception as e:
            D._log(f"  skip {reg}: {str(e)[:70]}")
    D._log(f"=== 완료: {made}건 큐 적재. run_cafe_listener_durban 가 10~19시에 발행 ===")


if __name__ == '__main__':
    main()
