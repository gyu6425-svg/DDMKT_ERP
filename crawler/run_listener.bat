@echo off
REM 즉시 검색 리스너 - PC IP로 네이버 측정(검색 버튼용). 상시 실행(로그온 시 시작 권장).
REM   작업 스케줄러: 트리거=로그온, 동작=이 파일. 로그는 listener.log 에 누적.
cd /d "%~dp0"
echo [START] %date% %time% >> listener.log
"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" run_listener.py >> listener.log 2>&1
echo [END]   %date% %time% (exit=%errorlevel%) >> listener.log
