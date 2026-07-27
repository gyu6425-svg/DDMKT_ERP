# -*- coding: utf-8 -*-
"""새 누수 카페(누수탐지 상담소, clubid 31762300 / 계정 dog6425 / 크롬 9225) 전용 리스너 런처.
   매일 10:00~19:00 사이에만, 간격 90~110분(하루 5~6개) 자동 발행. board명 가운뎃점 안전하게 os.environ 세팅.
   run_ddnusu_supervisor.bat 이 이 파일을 자동재시작 루프로 돌린다."""
import os, sys
CAFE = os.path.dirname(os.path.abspath(__file__))
os.environ['CAFE_CDP'] = 'http://127.0.0.1:9225'
os.environ['CAFE_WRITE_URL'] = 'https://cafe.naver.com/ca-fe/cafes/31762300/menus/2/articles/write?boardType=L'
os.environ['CAFE_BOARDS'] = '누수탐지 후기·시공사례'   # 이 게시판 잡만 발행
os.environ['CAFE_START_AT'] = '10:00'                  # 이 시각 이전엔 발행 안 함(매일)
os.environ['CAFE_STOP_AT'] = '19:00'                   # 이 시각 이후엔 발행 안 함(매일)
os.environ['CAFE_MIN_GAP_MIN'] = '90'                  # 간격 90~110분 → 9시간에 5~6개
os.environ['CAFE_MAX_GAP_MIN'] = '110'
sys.argv = ['publish_listener.py']
sys.path.insert(0, CAFE); os.chdir(CAFE)
import runpy
runpy.run_path(os.path.join(CAFE, 'publish_listener.py'), run_name='__main__')
