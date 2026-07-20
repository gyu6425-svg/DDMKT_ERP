@echo off
REM ============================================================
REM  Cafe comment automation - START ALL (used by boot autostart)
REM   1) headless Chrome (port 9224)
REM   2) comment listener (posts queued comments)
REM   3) new-post watcher (crawls registered cafes every 5 min)
REM  The watcher's 5-min crawl also keeps the Naver session warm,
REM  so a separate keep-alive is not required.
REM  Requires a one-time Naver login via run_chrome_login.bat.
REM
REM  RULES (learned the hard way - do not break):
REM   - ASCII only. Korean text breaks the cmd/scheduler codepage (exit 255).
REM   - CRLF line endings. LF makes cmd fail to parse; autostart dies silently.
REM   - Strip the trailing backslash from %~dp0. "C:\dir\" inside quotes breaks
REM     cmd parsing, which made cd and start /d silently fail.
REM   - Use ping, not timeout, to wait. timeout aborts when stdin is redirected.
REM   - Start python directly (no nested cmd /k quoting).
REM ============================================================
setlocal
set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set PYTHONUTF8=1
cd /d "%HERE%"

REM Clear a stale profile lock left by an unclean shutdown (Chrome would not start).
if exist "%HERE%\chrome_profile\SingletonLock" del /f /q "%HERE%\chrome_profile\SingletonLock" >nul 2>&1

echo [1/3] starting headless Chrome (port 9224)...
call "%HERE%\run_chrome.bat"
REM wait for the CDP port to open
ping -n 7 127.0.0.1 >nul 2>&1

echo [2/3] starting comment listener...
start "cafe-cmt-listener" /min py comment_listener.py

echo [3/3] starting new-post watcher...
start "cafe-cmt-watcher" /min py watch_new_posts.py

echo.
echo Started: Chrome 9224 + comment listener + new-post watcher.
echo You may close this window. Use stop_all.bat to stop.
ping -n 4 127.0.0.1 >nul 2>&1
endlocal
