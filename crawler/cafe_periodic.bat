@echo off
REM Cafe periodic rank measure - every 30min, new posts only, gated to never overlap blog crawl.
REM   Auto-start = Startup\DDMKT-CafePeriodic.vbs (hidden). Log appended to cafe_periodic.log.
REM   Loop: if python exits for any reason, restart after 60s (survives crashes).
cd /d "%~dp0"
:loop
echo [START] %date% %time% >> cafe_periodic.log
"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" cafe_periodic.py 1800 >> cafe_periodic.log 2>&1
echo [END]   %date% %time% (exit=%errorlevel%) - restart in 60s >> cafe_periodic.log
timeout /t 60 /nobreak >nul
goto loop
