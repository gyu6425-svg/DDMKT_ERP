@echo off
REM [ONE-TIME] Blog auto-save: manual login window. Run this ONCE per blog account.
REM   Opens a VISIBLE Chrome on CDP port 9225 with its own profile (blog_pub\chrome_profile).
REM   Log in to the target Naver blog account here, then close this window.
REM   Session is kept in chrome_profile\ and reused by run_chrome_blog.bat (headless).
REM   Ports: 9222=kakao / 9223=cafe publish / 9224+=cafe comments / 9225=BLOG SAVE (this)
REM   NOTE: comments are ASCII on purpose. Korean text in .bat breaks under codepage 949.
cd /d "%~dp0"
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 --remote-debugging-port=9225 --user-data-dir="%~dp0chrome_profile" ^
 --window-size=1400,950 --no-first-run --no-default-browser-check ^
 "https://nid.naver.com/nidlogin.login"
