@echo off
REM [로그인용] 창이 보이는 크롬으로 카카오 비즈니스에 1회 로그인하기 위한 모드.
REM - 세션 만료(로그인 풀림) 시에만 사용: 이 창에서 로그인 → 채팅목록 보이면 닫기 → run_chrome.bat(헤드리스) 실행.
REM - 같은 chrome_profile 을 쓰므로 로그인 세션이 헤드리스에서도 그대로 재사용됨.
REM - 주의: 헤드리스(run_chrome.bat)와 동시에 켜면 프로필 충돌 → 한 번에 하나만.
cd /d "%~dp0"
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 --remote-debugging-port=9222 --user-data-dir="%~dp0chrome_profile" ^
 --no-first-run --no-default-browser-check ^
 "https://business.kakao.com/_bTxbXn/chats"
