@echo off
REM DDMKT blog rank crawler - daily auto-run wrapper (Windows Task Scheduler)
REM   %~dp0 = this bat folder (crawler); fix working dir. logs appended to crawler\crawler_full.log
REM   ASCII-only on purpose: Korean text in a .bat breaks under Task Scheduler codepage (exit 255).
REM   anti-block: wide delay + time-spread (--spread). start 01:00, blog chunks end by 07:10.
REM   Launch python in its OWN new console (start /min) so sibling tasks (Today/Place) launching
REM   later cannot deliver a CTRL+C to this long-running crawl (fixes 0xC000013A kills at ~09:20).
REM   deadline 07:30 (was 08:00, was 08:30): the cafe rank crawl runs AFTER the blog and must
REM   finish before its own 09:00 hard stop. Measured: ~13.2 s per cafe post, and the cafe post
REM   count grows ~20/day (2026-08-14: 309 posts, ended 08:47 - only 12 min of slack left).
REM   At that growth the Monday 2026-08-17 run would have crossed 09:00 and dropped posts.
REM   Blog is NOT cut by this: --deadline only spreads the 15 chunk START times, so the same
REM   ~1300 posts still get measured with slightly shorter IP rests (~27min -> ~25min per chunk).
REM   finish >30min before Today(09:05)/Place(09:20) so the three
REM   never overlap. The 09:00-09:20 overlap kept killing the Full crawl (0xC000013A / -1073741510).
cd /d "%~dp0"
echo ============================================== >> crawler_full.log
echo [START] %date% %time% >> crawler_full.log
set CRAWL_DELAY=3.5
set CRAWL_REST_EVERY=6
set CRAWL_REST_SEC=40
REM Blog Full crawl, THEN sync published cafe posts, THEN cafe rank crawl sequentially.
REM   The cafe crawl starts only AFTER the blog crawl fully finishes -> never overlaps (anti-block).
REM   Blog ends ~07:30, cafe gets ~90min before its 09:00 stop, Today starts 09:05 -> separated.
REM   cmd /v:on + !date! !time! : the stage markers must expand WHEN they run. With %time% the
REM   whole line is parsed once at launch, so all three markers printed 01:00 and the morning
REM   report could not tell how long the blog vs the cafe stage actually took.
start "ddmkt-full" /min cmd /v:on /c "C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe blog_rank_crawler.py --spread --chunk-size 5 --deadline 07:30 >> crawler_full.log 2>&1 & echo [CAFE-SYNC-START] !date! !time! >> crawler_full.log & C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe cafe_rank_sync.py >> crawler_full.log 2>&1 & echo [CAFE-RANK-START] !date! !time! >> crawler_full.log & C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe cafe_rank_crawler.py >> crawler_full.log 2>&1"
