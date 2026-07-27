@echo off
REM ===== DDNusu (new leak cafe) autonomous supervisor =====
REM   - ensures headless chrome 9225 (dog6425 profile) is up
REM   - runs listener_ddnusu.py (publishes 10:00-19:00, gap 90-110min)
REM   - auto-restarts listener if it ever dies (30s), and relaunches chrome if the port drops
REM   log: cafe_ddnusu.log
cd /d "%~dp0"
set "PYEXE=py"
where py >nul 2>&1 || set "PYEXE=C:\Users\rlawh\AppData\Local\Programs\Python\Python312\python.exe"
:loop
netstat -ano | findstr ":9225" | findstr LISTENING >nul
if errorlevel 1 (
  echo [CHROME START] %date% %time% >> cafe_ddnusu.log
  start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --remote-debugging-port=9225 --user-data-dir="%~dp0chrome_profile_ddnusu" --window-size=1400,950 --no-first-run --no-default-browser-check "https://cafe.naver.com"
  timeout /t 8 /nobreak >nul
)
echo [LISTENER START] %date% %time% >> cafe_ddnusu.log
"%PYEXE%" -u listener_ddnusu.py >> cafe_ddnusu.log 2>&1
echo [LISTENER END] %date% %time% - restart in 30s >> cafe_ddnusu.log
timeout /t 30 /nobreak >nul
goto loop
