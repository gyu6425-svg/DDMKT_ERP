@echo off
REM [최초 1회] '마이클의 정보세상' 발행 계정 로그인용 '보이는 크롬'. 세션은 chrome_profile_theman/ 에 저장됨.
REM   포트 9224 = 누수(9223)와 분리. user-data-dir 도 별도라 누수 로그인과 절대 안 섞인다.
REM   ※ '마이클의 정보세상'에 글 올릴 계정으로 로그인할 것(누수 계정과 같아도/달라도 무방 — 프로필이 갈려 있어 안전).
cd /d "%~dp0"
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 --remote-debugging-port=9224 --user-data-dir="%~dp0chrome_profile_theman" ^
 --window-size=1400,950 --no-first-run --no-default-browser-check ^
 "https://nid.naver.com/nidlogin.login"
