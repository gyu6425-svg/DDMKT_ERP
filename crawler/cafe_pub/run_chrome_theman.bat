@echo off
REM [평소 운영] '마이클의 정보세상'(더맨·설고) 발행용 '헤드리스 크롬'(창 안 뜸). 포트 9224 = 누수(9223)와 분리.
REM   로그인 세션은 chrome_profile_theman/ 재사용. 세션 만료 시 run_chrome_login_theman.bat 로 1회 재로그인.
cd /d "%~dp0"
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 --headless=new --remote-debugging-port=9224 --user-data-dir="%~dp0chrome_profile_theman" ^
 --window-size=1400,950 --no-first-run --no-default-browser-check ^
 "https://cafe.naver.com"
