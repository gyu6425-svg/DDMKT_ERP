@echo off
REM DDMKT blog rank crawler - daily auto-run wrapper (Windows Task Scheduler)
REM   %~dp0 = this bat folder (crawler); fix working dir. logs appended to crawler\crawler_full.log
REM   ASCII-only on purpose: Korean text in a .bat breaks under Task Scheduler codepage (exit 255).
REM   anti-block: wide delay + time-spread (--spread). start 03:00, FINISH BY 08:30.
REM   Launch python in its OWN new console (start /min) so sibling tasks (Today/Place) launching
REM   later cannot deliver a CTRL+C to this long-running crawl (fixes 0xC000013A kills at ~09:20).
REM   deadline 08:30 (was 09:00): finish >30min before Today(09:05)/Place(09:20) so the three
REM   never overlap. The 09:00-09:20 overlap kept killing the Full crawl (0xC000013A / -1073741510).
cd /d "%~dp0"
echo ============================================== >> crawler_full.log
echo [START] %date% %time% >> crawler_full.log
set CRAWL_DELAY=3.5
set CRAWL_REST_EVERY=6
set CRAWL_REST_SEC=40
REM Blog Full crawl, THEN cafe rank crawl sequentially in the same console (chained with &).
REM   The cafe crawl starts only AFTER the blog crawl fully finishes -> never overlaps (anti-block).
REM   Blog finishes by 08:30, cafe is quick, Today starts 09:05 -> all three stay separated.
start "ddmkt-full" /min cmd /c "C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe blog_rank_crawler.py --spread --chunk-size 5 --deadline 08:30 >> crawler_full.log 2>&1 & echo [CAFE-RANK-START] %date% %time% >> crawler_full.log & C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe cafe_rank_crawler.py >> crawler_full.log 2>&1"
