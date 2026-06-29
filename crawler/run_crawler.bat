@echo off
REM DDMKT blog rank crawler - daily auto-run wrapper (Windows Task Scheduler)
REM   %~dp0 = this bat folder (crawler); fix working dir
REM   logs appended to crawler\crawler.log
REM   ASCII-only on purpose: Korean text in a .bat breaks under Task Scheduler codepage (exit 255).
cd /d "%~dp0"
echo ============================================== >> crawler.log
echo [START] %date% %time% >> crawler.log
REM anti-block: wide delay + time-spread (--spread). start 04:00, finish before 09:00(-20m).
REM   blogtab uses official API + 5 posts + chunks of 5 blogs + gaps = effectively no block.
set CRAWL_DELAY=3.5
set CRAWL_REST_EVERY=6
set CRAWL_REST_SEC=40
"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" blog_rank_crawler.py --spread --chunk-size 5 --deadline 09:00 >> crawler.log 2>&1
echo [END]   %date% %time% (exit=%errorlevel%) >> crawler.log
