@echo off
REM [평소 운영] 네이버 카페 댓글 자동화용 '헤드리스 크롬'(창 안 뜸).
REM   로그인 세션은 chrome_profile/ 재사용. 세션 만료 시 run_chrome_login.bat 로 1회 재로그인.
REM   포트 9224 = 발행(9223)·카카오(9222)와 분리(동시 실행 가능).
cd /d "%~dp0"
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 --headless=new --remote-debugging-port=9224 --user-data-dir="%~dp0chrome_profile" ^
 --window-size=1400,950 --no-first-run --no-default-browser-check ^
 "https://cafe.naver.com"
