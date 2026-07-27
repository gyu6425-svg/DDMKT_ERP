@echo off
REM DDMKT place rank crawler - daily auto-run wrapper (Windows Task Scheduler)
REM   ASCII-only on purpose: Korean text in a .bat breaks under Task Scheduler codepage (exit 255).
REM   Launch python in its OWN new console (start /min) so this task cannot deliver a
REM   CTRL+C to a sibling crawl that shares the interactive session console.
REM   This is what fixed the 0xC000013A kills (Place/Today launching killed the 03:00 Full crawl).
cd /d "%~dp0"
echo [PLACE-START] %date% %time% >> crawler_place.log
start "ddmkt-place" /min cmd /c "C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe -u place_rank_crawler.py >> crawler_place.log 2>&1"
