@echo off
REM DDMKT place rank crawler - daily auto-run wrapper (Windows Task Scheduler)
REM   ASCII-only on purpose: Korean text in a .bat breaks under Task Scheduler codepage (exit 255).
REM   measures every place_accounts x place_keywords once per day, upserts today's rank.
cd /d "%~dp0"
echo [PLACE-START] %date% %time% >> crawler.log
"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" -u place_rank_crawler.py >> crawler.log 2>&1
echo [PLACE-END]   %date% %time% (exit=%errorlevel%) >> crawler.log
