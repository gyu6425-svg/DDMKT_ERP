@echo off
REM DDMKT one-off backfill crawl - manual full re-measure of last 90 days (--force).
REM   ASCII-only (Korean in a .bat breaks Task Scheduler codepage / exit 255).
REM   Own new console (start /min) so it survives session close and cannot be CTRL+C killed by
REM   sibling scheduled crawls (Today/Place/Full). Round-robin, 90-day window, force re-measure.
cd /d "%~dp0"
echo ============================================== >> crawler.log
echo [BACKFILL-START] %date% %time% >> crawler.log
set CRAWL_DELAY=3.5
set CRAWL_REST_EVERY=6
set CRAWL_REST_SEC=40
start "ddmkt-backfill" /min cmd /c "C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe -u blog_rank_crawler.py --force >> crawler.log 2>&1"
