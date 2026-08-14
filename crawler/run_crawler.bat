@echo off
REM DDMKT blog rank crawler - daily auto-run wrapper (Windows Task Scheduler)
REM   %~dp0 = this bat folder (crawler); fix working dir. logs appended to crawler\crawler_full.log
REM   ASCII-only on purpose: Korean text in a .bat breaks under Task Scheduler codepage (exit 255).
REM   anti-block: wide delay + time-spread (--spread). start 01:00, blog chunks end by 07:10.
REM   Launch python in its OWN new console (start /min) so sibling tasks (Today/Place) launching
REM   later cannot deliver a CTRL+C to this long-running crawl (fixes 0xC000013A kills at ~09:20).
REM   deadline 07:30 (was 08:00, was 08:30): the cafe rank crawl runs AFTER the blog and must
REM   finish before its own 09:00 hard stop. Measured from crawl_status.recent_runs (real clock,
REM   not the log markers): cafe stage = 17.2 min fixed + 12.0 s per post, i.e. ~15.5 s/post
REM   overall. Post count grows ~18/day. 2026-08-14: 309 posts, blog ended 07:28, cafe 08:47 -
REM   only 12 min of slack. Left at 08:00 the Monday 2026-08-17 run ends 08:57 and any cooldown
REM   pushes it past 09:00, silently dropping the tail. 07:30 moves blog end to ~07:00.
REM   Effect on the blog: --deadline mainly spreads the 15 chunk START times (interval 26.7 ->
REM   24.7 min, so IP rests shrink ~7.5%). It does NOT normally drop posts, BUT there is a real
REM   hard cut in run_spread(): chunks that have not STARTED by (deadline - 20min) are skipped
REM   whole (~85 posts each) with a "deadline exceeded" line. Headroom: worst observed chunk
REM   work total 268 min vs the 370 min budget, so a cut is unlikely at the current load.
REM   Cafe capacity ceiling is ~514 posts; at +18/day that is ~2026-08-25. Fix it properly then
REM   (skip stable cafe posts like the blog does, or move the Full task to 00:15).
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
