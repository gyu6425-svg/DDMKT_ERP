@echo off
REM DDMKT post-reboot setup - runs automatically at logon (hidden via Startup\DDMKT-PostBoot.vbs).
REM   1) Re-enable crawl scheduled tasks - they come back Disabled after a reboot (verified 2026-07-23).
REM   2) Start the local dev server on :5173 so localhost works right away.
REM   Daemons (run_listener / cafe_periodic) start from their own Startup vbs.
cd /d "%~dp0"
echo ============================================== >> postboot.log
echo [POSTBOOT] %date% %time% >> postboot.log
powershell -NoProfile -Command "foreach($n in 'DDMKT-Crawl-Full','DDMKT-Crawl-Place','DDMKT-Crawl-Today-WD','DDMKT-Crawl-Today-WE'){ try{ Enable-ScheduledTask -TaskName $n -ErrorAction Stop | Out-Null; Write-Output ('enabled ' + $n) } catch { Write-Output ('FAILED ' + $n) } }" >> postboot.log 2>&1
start "" /min cmd /c "cd /d C:\Users\ddmkt\DDMKT_ERP && npm run dev > dev.log 2>&1"
echo [DEV-SERVER-STARTED] %date% %time% >> postboot.log
