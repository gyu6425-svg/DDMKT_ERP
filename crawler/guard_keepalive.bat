@echo off
REM Restart selfhost_guard only if it is NOT already running.
REM
REM Why check first: the task's MultipleInstances=IgnoreNew only guards the TASK instance.
REM   wscript launches the loop and exits at once, so every run would spawn another guard.
REM
REM Why PowerShell for the check (two earlier attempts failed, both measured 2026-08-20):
REM   find    - Git Bash ahead on PATH wins, unix find treats /i as a file and errors out
REM   tasklist- does NOT print command lines at all (/v shows the window title)
REM   Both failed the same way: always 'not running' -> a new guard every 15 min.
REM   Win32_Process.CommandLine is the only reliable source here.
REM   NOTE: %% is required. In a .bat a single %python% is expanded as an environment
REM   variable (empty), so the filter became Name like '' and matched nothing -
REM   again 'always not running'. Third trap in the same spot. Measured 2026-08-20.
REM ASCII + CRLF only (Task Scheduler codepage).
cd /d "%~dp0"
powershell -NoProfile -NonInteractive -Command "if (@(Get-CimInstance Win32_Process -Filter \"Name like '%%python%%'\" | Where-Object { $_.CommandLine -match 'selfhost_guard' }).Count -gt 0) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo [keepalive] %date% %time% already running >> guard_keepalive.log
  exit /b 0
)
echo [keepalive] %date% %time% NOT running - starting >> guard_keepalive.log
start "" /min cmd /c "C:\Users\ddmkt\DDMKT_ERP\crawler\selfhost_guard.bat"
exit /b 0
