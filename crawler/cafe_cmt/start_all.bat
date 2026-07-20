@echo off
REM ============================================================
REM  Cafe comment automation - START ALL (used by boot autostart)
REM   1) one headless Chrome per account listed in accounts.txt
REM   2) comment listener (posts queued comments, picks the account's Chrome)
REM   3) new-post watcher (crawls registered cafes every 5 min, per account)
REM  The watcher's 5-min crawl also keeps the Naver session warm.
REM  Each account needs a one-time login: run_chrome_login.bat <account>
REM
REM  RULES (learned the hard way - do not break):
REM   - ASCII only. Korean text breaks the cmd/scheduler codepage (exit 255).
REM   - CRLF line endings. LF makes cmd fail to parse; autostart dies silently.
REM   - Strip the trailing backslash from %~dp0. "C:\dir\" inside quotes breaks
REM     cmd parsing, which made cd and start /d silently fail.
REM   - Use ping, not timeout, to wait. timeout aborts when stdin is redirected.
REM   - Start python directly (no nested cmd /k quoting).
REM ============================================================
setlocal enabledelayedexpansion
set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set PYTHONUTF8=1
cd /d "%HERE%"

echo [1/4] starting one headless Chrome per account...
if exist "%HERE%\accounts.txt" (
  REM tokens=1,3 -> %%a = name, %%b = profile dir. delims includes a space so
  REM "name, port, profile" style lines do not carry a leading space.
  for /f "usebackq eol=# tokens=1,3 delims=, " %%a in ("%HERE%\accounts.txt") do (
    set "P=%%b"
    REM a 2-field line leaves %%b unsubstituted (literal), so check for that too
    if "!P!"=="" set "P=chrome_profile"
    if "!P!"=="%%b" if not exist "%HERE%\!P!" set "P=chrome_profile"
    REM clear a stale profile lock left by an unclean shutdown
    if exist "%HERE%\!P!\SingletonLock" del /f /q "%HERE%\!P!\SingletonLock" >nul 2>&1
    echo   - account %%a
    call "%HERE%\run_chrome.bat" %%a
    set "P="
  )
) else (
  if exist "%HERE%\chrome_profile\SingletonLock" del /f /q "%HERE%\chrome_profile\SingletonLock" >nul 2>&1
  call "%HERE%\run_chrome.bat"
)
REM wait for the CDP ports to open
ping -n 9 127.0.0.1 >nul 2>&1

echo [2/4] starting comment listener...
start "cafe-cmt-listener" /min py comment_listener.py

echo [3/4] starting new-post watcher...
start "cafe-cmt-watcher" /min py watch_new_posts.py

REM Reply scheduler was missing here, so after any reboot replies stopped silently
REM while comments kept working - and nothing reported it.
echo [4/4] starting reply scheduler...
start "cafe-cmt-reply" /min py reply_scheduler.py

echo.
echo Started: Chrome per account + comment listener + watcher + reply scheduler.
echo You may close this window. Use stop_all.bat to stop.
ping -n 4 127.0.0.1 >nul 2>&1
endlocal
