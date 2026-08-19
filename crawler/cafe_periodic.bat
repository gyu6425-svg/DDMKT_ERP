@echo off
REM Cafe periodic rank measure - every 30min, new posts only, gated to never overlap blog crawl.
REM   Auto-start = Startup\DDMKT-CafePeriodic.vbs (hidden). Log appended to cafe_periodic.log.
REM   Loop: if python exits for any reason, restart after 60s (survives crashes).
cd /d "%~dp0"
:loop
echo [START] %date% %time% >> cafe_periodic.log
"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" cafe_periodic.py 1800 >> cafe_periodic.log 2>&1
echo [END]   %date% %time% (exit=%errorlevel%) - restart in 60s >> cafe_periodic.log
REM   Wait with ping, not timeout: `timeout` returns INSTANTLY when stdin is not a console
REM   (VBS/service launch). SUB4 measured 429 restarts in ~5 min - 1.3 restarts/sec, each one
REM   hitting the self-hosted backend. ping always waits. Measured 2026-08-19 on main too:
REM   timeout /t 3 with non-console stdin returned in 0.1s; ping -n 4 took 3.1s.
ping -n 61 127.0.0.1 >nul
goto loop
