@echo off
REM [first time only] Visible Chrome for Naver login (cafe comment automation).
REM   Log in here; the session is saved into chrome_profile/.
REM   IMPORTANT: check "Keep me logged in" on the Naver login page, otherwise the
REM   session cookie dies when Chrome closes.
REM   Port 9224 / its own user-data-dir (independent from publish 9223).
REM   NOTE: this file must stay ASCII + CRLF (see docs ops guide).
cd /d "%~dp0"
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 --remote-debugging-port=9224 --user-data-dir="%~dp0chrome_profile" ^
 --window-size=1400,950 --no-first-run --no-default-browser-check ^
 "https://nid.naver.com/nidlogin.login"
