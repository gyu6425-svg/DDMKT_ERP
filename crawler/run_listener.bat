@echo off
REM 즉시 검색 리스너 - PC IP로 네이버 측정(검색 버튼용). 상시 실행(로그온 시 시작).
REM   자동시작 = Startup 폴더의 DDMKT-Listener.vbs(숨김 실행). 로그는 listener.log 에 누적.
REM   아래 루프: 파이썬이 어떤 이유로 종료돼도 30초 후 자동 재시작(예약작업 재시작 대체).
cd /d "%~dp0"
:loop
echo [START] %date% %time% >> listener.log
"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" run_listener.py >> listener.log 2>&1
echo [END]   %date% %time% (exit=%errorlevel%) - 30s 후 재시작 >> listener.log
REM   Wait with ping, not timeout: timeout returns INSTANTLY when stdin is not a console
REM   (VBS launch). SUB4 measured 1.3 restarts/sec - 429 in 5 min, each hitting the backend.
REM   Reproduced on main 2026-08-19: timeout /t 3 = 0.1s, ping -n 4 = 3.1s.
ping -n 31 127.0.0.1 >nul
goto loop
