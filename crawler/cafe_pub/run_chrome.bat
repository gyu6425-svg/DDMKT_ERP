@echo off
REM [평소 운영] 네이버 카페 자동발행용 '헤드리스 크롬'(창 안 뜸 → 사장님 PC 계속 사용 가능).
REM   로그인 세션은 chrome_profile/ 재사용. 세션 만료 시 run_chrome_login.bat 로 1회 재로그인.
REM   포트 9223(카카오 9222와 분리).
cd /d "%~dp0"
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 --headless=new --remote-debugging-port=9223 --user-data-dir="%~dp0chrome_profile" ^
 --window-size=1400,950 --no-first-run --no-default-browser-check ^
 "https://cafe.naver.com"
