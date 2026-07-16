@echo off
REM [최초 1회] 네이버 카페 로그인용 '보이는 크롬'. 여기서 네이버에 로그인하면 세션이 chrome_profile/ 에 저장됨.
REM   로그인 후 이 창은 그대로 두고, 평소엔 run_chrome.bat(헤드리스)로 붙어서 발행함.
REM   포트 9223 = 카카오(9222)와 분리. user-data-dir 도 별도.
cd /d "%~dp0"
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 --remote-debugging-port=9223 --user-data-dir="%~dp0chrome_profile" ^
 --window-size=1400,950 --no-first-run --no-default-browser-check ^
 "https://nid.naver.com/nidlogin.login"
