# -*- coding: utf-8 -*-
"""더반클린(입주청소) 전용 리스너 런처 — 더반카페(31761053)/black4458/크롬 9226.
   매일 10:00~19:00, 간격 60~90분(하루 6~8개), 글 1건 7~10분 느린작성(사람같이).
   ★ 포트 9226 = theman(9224)·nusu(9223)·ddnusu(9225)와 완전분리(충돌 0).
   run_cafe_listener_durban.bat 이 이 파일을 자동재시작 루프로 돌린다. 프로세스명으로 watchdog 식별."""
import os, sys
CAFE = os.path.dirname(os.path.abspath(__file__))
os.environ['CAFE_CDP'] = 'http://127.0.0.1:9226'
os.environ['CAFE_WRITE_URL'] = 'https://cafe.naver.com/ca-fe/cafes/31761053/menus/2/articles/write?boardType=L'
os.environ['CAFE_BOARDS'] = '더반클린 입주청소'   # 이 게시판 잡만 발행
os.environ['CAFE_BOARD'] = '더반클린 입주청소'
os.environ['CAFE_CLAIM_NULL_BOARD'] = '0'
os.environ['CAFE_NO_SEND'] = '0'                   # 실제 등록(자율발행)
os.environ['CAFE_START_AT'] = '10:00'              # 이 시각 이전엔 발행 안 함(매일)
os.environ['CAFE_STOP_AT'] = '19:00'               # 이 시각 이후엔 발행 안 함(매일)
os.environ['CAFE_MIN_GAP_MIN'] = '60'              # 간격 60~90분 → 9시간에 6~8개
os.environ['CAFE_MAX_GAP_MIN'] = '90'
os.environ['CAFE_MIN_SECONDS'] = '420'             # 글 1건 작성 7~10분(사람처럼 천천히)
os.environ['CAFE_MAX_SECONDS'] = '600'
sys.argv = ['publish_listener.py']
sys.path.insert(0, CAFE); os.chdir(CAFE)
import runpy
runpy.run_path(os.path.join(CAFE, 'publish_listener.py'), run_name='__main__')
