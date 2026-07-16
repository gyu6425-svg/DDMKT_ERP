@echo off
REM [최초 1회] 네이버 카페 댓글용 '보이는 크롬'. 여기서 네이버 로그인 → 세션이 chrome_profile/ 에 저장됨.
REM   로그인 후 이 창은 닫고, 평소엔 run_chrome.bat(헤드리스, 9224)로 붙어서 댓글 작성.
REM   포트 9224 = 발행(9223)과 분리. user-data-dir 도 별도(발행과 독립).
cd /d "%~dp0"
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 --remote-debugging-port=9224 --user-data-dir="%~dp0chrome_profile" ^
 --window-size=1400,950 --no-first-run --no-default-browser-check ^
 "https://nid.naver.com/nidlogin.login"
