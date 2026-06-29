@echo off
REM [평소 운영] 카카오 비즈니스 자동발송용 '헤드리스 크롬'(창 안 뜸).
REM - 헤드리스라 창 포그라운드/백그라운드와 무관하게 항상 렌더링 → 사장님이 PC 써도 발송 안정적.
REM - 로그인 세션은 chrome_profile/ 에 저장된 걸 재사용.
REM - 세션이 만료돼 로그인이 필요하면 run_chrome_login.bat(창 보이는 모드)로 1회 로그인 후 이걸 다시 실행.
cd /d "%~dp0"
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 --headless=new --remote-debugging-port=9222 --user-data-dir="%~dp0chrome_profile" ^
 --window-size=1400,950 --no-first-run --no-default-browser-check ^
 "https://business.kakao.com/_bTxbXn/chats"
