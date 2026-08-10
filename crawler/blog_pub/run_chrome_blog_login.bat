@echo off
REM [ONE-TIME] Blog auto-save: manual login window. Run this ONCE per blog account.
REM   Opens a VISIBLE Chrome on CDP port 9235 with its own profile (blog_pub\chrome_profile).
REM   Log in to the target Naver blog account here, then close this window.
REM   Session is kept in chrome_profile\ and reused by run_chrome_blog.bat (headless).
REM   Ports: 9222=kakao / 9223=cafe publish / 9224-9229=cafe comments (6 accounts) / 9235=BLOG SAVE
REM   WARNING: comments use ONE PORT PER ACCOUNT starting at 9224 (see cafe_cmt\accounts.txt).
REM   This was originally 9225, which collided with a comment account. Check accounts.txt
REM   before taking any new port.
REM   NOTE: comments are ASCII on purpose. Korean text in .bat breaks under codepage 949.
cd /d "%~dp0"
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 --remote-debugging-port=9235 --user-data-dir="%~dp0chrome_profile" ^
 --window-size=1400,950 --no-first-run --no-default-browser-check ^
 "https://nid.naver.com/nidlogin.login"
