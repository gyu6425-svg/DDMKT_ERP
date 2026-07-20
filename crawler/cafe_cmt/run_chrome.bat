@echo off
REM [normal ops] Headless Chrome for cafe comment automation (no visible window).
REM   Reuses the logged-in session in chrome_profile/. If the session expires,
REM   run run_chrome_login.bat once to log in again.
REM   Port 9224 (separate from publish 9223 and kakao 9222).
REM   NOTE: this file must stay ASCII + CRLF (see docs ops guide).
cd /d "%~dp0"
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 --headless=new --remote-debugging-port=9224 --user-data-dir="%~dp0chrome_profile" ^
 --window-size=1400,950 --no-first-run --no-default-browser-check ^
 "https://cafe.naver.com"
