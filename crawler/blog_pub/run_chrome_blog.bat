@echo off
REM [DAILY] Headless Chrome for blog auto-save (CDP port 9225, own profile).
REM   Session comes from chrome_profile\ created by run_chrome_blog_login.bat.
REM   If the session expires, run run_chrome_blog_login.bat again (no auto re-login:
REM   captcha / 2FA / account-lock risk).
REM   NOTE: ASCII-only comments on purpose (codepage 949 breaks Korean in .bat).
cd /d "%~dp0"
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 --headless=new --remote-debugging-port=9225 --user-data-dir="%~dp0chrome_profile" ^
 --window-size=1400,950 --no-first-run --no-default-browser-check ^
 "https://blog.naver.com"
