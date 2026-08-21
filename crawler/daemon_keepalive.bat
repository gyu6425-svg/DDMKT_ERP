@echo off
REM Start DDMKT daemons if they are NOT already running. Idempotent - safe to run often.
REM
REM Why a scheduled task instead of the Startup folder (measured 2026-08-20):
REM   Windows runs startup items one every ~30s. This PC has 18 startup entries
REM   (AnySign, MagicLine, Veraport, AhnLab, Avast ...) and the Startup FOLDER is last.
REM   Boot 17:48 -> at 18:22 the folder items had still not run. 34 minutes, nothing.
REM   Not blocked - just never reached. Daemons must not sit in that queue.
REM
REM Why PowerShell for detection (two earlier attempts failed):
REM   find     - Git Bash ahead on PATH wins; unix find treats /i as a file and errors
REM   tasklist - does NOT print command lines at all (/v shows the window title)
REM   Both fail the same way: always 'not running' -> a duplicate daemon every run.
REM ASCII + CRLF only (Task Scheduler codepage).
cd /d "%~dp0"

REM ---- cafe_periodic ----
powershell -NoProfile -NonInteractive -Command "if (@(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'cafe_periodic' }).Count -gt 0) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo [keepalive] %date% %time% cafe_periodic ok >> daemon_keepalive.log
) else (
  echo [keepalive] %date% %time% cafe_periodic DOWN - starting >> daemon_keepalive.log
  start "" /min cmd /c "C:\Users\ddmkt\DDMKT_ERP\crawler\cafe_periodic.bat"
)

REM ---- run_listener ----
powershell -NoProfile -NonInteractive -Command "if (@(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'run_listener' }).Count -gt 0) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo [keepalive] %date% %time% run_listener ok >> daemon_keepalive.log
) else (
  echo [keepalive] %date% %time% run_listener DOWN - starting >> daemon_keepalive.log
  start "" /min cmd /c "C:\Users\ddmkt\DDMKT_ERP\crawler\run_listener.bat"
)

REM ---- selfhost_guard ----
powershell -NoProfile -NonInteractive -Command "if (@(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'selfhost_guard' }).Count -gt 0) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo [keepalive] %date% %time% selfhost_guard ok >> daemon_keepalive.log
) else (
  echo [keepalive] %date% %time% selfhost_guard DOWN - starting >> daemon_keepalive.log
  start "" /min cmd /c "C:\Users\ddmkt\DDMKT_ERP\crawler\selfhost_guard.bat"
)

exit /b 0
