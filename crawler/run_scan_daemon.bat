@echo off
REM 점진 스캔 데몬 - 크래시 재시작 루프. 10시간짜리라 밤중에 죽으면 아침까지 멈춘다.
REM   재개는 자동 - 데몬은 체크포인트를 안 쓰고 매 라운드 DB 캐시를 다시 읽어 남은 것만 고른다.
REM   두 개 뜨는 것은 DB 리스(scan_lease_take)가 막는다. 중복 기동 시 즉시 정상 종료(0)한다.
REM   자동시작이 필요하면 Startup 에 vbs 로 숨겨 띄운다. bat/vbs 는 반드시 CRLF 로 저장할 것.
cd /d "%~dp0"
:loop
echo [START] %date% %time% >> cafe_scan_daemon.log
"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" cafe_scan_daemon.py >> cafe_scan_daemon.log 2>&1
echo [END]   %date% %time% (exit=%errorlevel%) - restart in 60s >> cafe_scan_daemon.log
timeout /t 60 /nobreak >nul
goto loop
