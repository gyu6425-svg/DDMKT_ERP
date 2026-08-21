@echo off
REM Instant search listener - measures via this PC's IP (search button). Always on.
REM   Started by daemon_keepalive.bat (scheduled task, every 5 min) when not already running.
REM   Loop below: if python exits for any reason, restart after 30s.
REM   Wait with ping, not timeout: timeout returns INSTANTLY when stdin is not a console
REM   (VBS/task launch). SUB4 measured 1.3 restarts/sec - 429 in 5 min, each hitting the backend.
REM   Reproduced on main 2026-08-19: timeout /t 3 = 0.1s, ping -n 4 = 3.1s.
REM   ASCII + CRLF only: Korean here breaks under the Task Scheduler codepage (949).
REM   Was UTF-8 Korean until 2026-08-21. The watchdog relaunches THIS file, so a codepage
REM   break would silently kill the only recovery path. Log stays at listener.log.
cd /d "%~dp0"
:loop
echo [START] %date% %time% >> listener.log
"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" run_listener.py >> listener.log 2>&1
echo [END]   %date% %time% (exit=%errorlevel%) - restart in 30s >> listener.log
ping -n 31 127.0.0.1 >nul
goto loop
