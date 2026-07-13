@echo off
REM DDMKT blog rank crawler - daily auto-run wrapper (Windows Task Scheduler)
REM   %~dp0 = this bat folder (crawler); fix working dir. logs appended to crawler\crawler.log
REM   ASCII-only on purpose: Korean text in a .bat breaks under Task Scheduler codepage (exit 255).
REM   anti-block: wide delay + time-spread (--spread). start 03:00, finish before 09:00.
REM   Launch python in its OWN new console (start /min) so sibling tasks (Today/Place) launching
REM   later cannot deliver a CTRL+C to this long-running crawl (fixes 0xC000013A kills at ~09:20).
cd /d "%~dp0"
echo ============================================== >> crawler.log
echo [START] %date% %time% >> crawler.log
set CRAWL_DELAY=3.5
set CRAWL_REST_EVERY=6
set CRAWL_REST_SEC=40
start "ddmkt-full" /min cmd /c "C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe blog_rank_crawler.py --spread --chunk-size 5 --deadline 09:00 >> crawler.log 2>&1"
