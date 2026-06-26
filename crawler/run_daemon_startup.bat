@echo off
REM DDMKT 크롤 통합 데몬 — 로그인 시 자동 실행(시작프로그램에 이 파일 바로가기/복사).
REM 평일 04~09 전체크롤 / 매일 09~24 당일글 / 10분 차단확인. 창은 최소화로 뜸.
cd /d "C:\Users\ddmkt\DDMKT_ERP\crawler"
start "" /min cmd /c "\"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe\" -u run_daemon.py >> daemon.log 2>&1"
