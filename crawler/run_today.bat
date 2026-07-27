@echo off
REM DDMKT today-post crawler wrapper (Windows Task Scheduler)
REM   ASCII-only: Korean in a .bat breaks Task Scheduler codepage (exit 255).
REM   Launch python in its OWN new console (start /min) so this task cannot deliver a
REM   CTRL+C to a sibling crawl (e.g. the 03:00 Full crawl) sharing the session console.
cd /d "%~dp0"
echo [TODAY-START] %date% %time% >> crawler_today.log
start "ddmkt-today" /min cmd /c "C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe -u crawl_bydate.py 1 >> crawler_today.log 2>&1"
