@echo off
chcp 65001 >nul
setlocal
set "PROF=%~dp0chrome_profile"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" ( echo [%~n0] 크롬을 찾을 수 없습니다. 크롬을 먼저 설치하세요. ^& pause ^& exit /b 1 )
echo 네이버 로그인 창을 엽니다...
start "" "%CHROME%" --remote-debugging-port=9223 --user-data-dir="%PROF%" --no-first-run --no-default-browser-check "https://nid.naver.com/nidlogin.login"
echo.
echo [안내] 로그인한 뒤 그 크롬 창을 닫고, "2-시작.bat" 을 실행하세요.
pause
