@echo off
REM [상시 운영] 더맨(마이클의 정보세상) 발행 리스너 — 누수 리스너와 '완전 분리'.
REM   누수 : 크롬 9223 · 게시판 "누수" · 누수카페(31754130) · cafe_listener.log
REM   더맨 : 크롬 9224 · 게시판 "더맨시스템 시설경호업체" · 마이클의정보세상 카페(아래 CAFE_WRITE_URL) · cafe_listener_theman.log
REM   → 크롬/계정/큐(게시판필터)가 전부 갈려 서로 발행이 안 겹친다.
REM   ※ 이 리스너를 켜기 전 run_chrome_login_theman.bat 로 '마이클의정보세상' 접근 계정 로그인 1회 필요.
cd /d "%~dp0"

REM ── 더맨 전용 설정 (여기 set 값이 .env 보다 우선한다) ─────────────────────────
set "CAFE_CDP=http://127.0.0.1:9224"
REM ▼▼ [필수] '마이클의 정보세상' 카페 글쓰기 주소 (더맨·설고가 이 카페 안의 게시판).
REM     예) https://cafe.naver.com/ca-fe/cafes/<마이클clubid>/articles/write?boardType=L
set "CAFE_WRITE_URL="
REM 게시판(메뉴) 이름 = 더맨 board. companies.ts theman.board 와 이미 일치(웹 변경 불필요).
REM   ※ 설고까지 이 PC에서 발행하려면: set "CAFE_BOARDS=더맨시스템 시설경호업체,설고점 소방의 모든 것"
set "CAFE_BOARDS=더맨시스템 시설경호업체"
set "CAFE_BOARD=%CAFE_BOARDS%"
REM 빈 board(레거시/과거) 행은 절대 안 집는다 — 오발행 방지(이 PC는 '더맨' board 만 담당).
set "CAFE_CLAIM_NULL_BOARD=0"
set "CAFE_NO_SEND=0"
set "CAFE_MIN_GAP_MIN=55"
set "CAFE_MAX_GAP_MIN=70"
set "CAFE_STOP_AT=19:00"
REM ─────────────────────────────────────────────────────────────────────────────

if "%CAFE_WRITE_URL%"=="" ( echo [중단] CAFE_WRITE_URL 미설정 - 더맨 카페 글쓰기 주소를 이 bat 에 넣으세요. & pause & exit /b 1 )
if "%CAFE_BOARDS%"==""    ( echo [중단] CAFE_BOARDS 미설정 - 더맨 게시판명을 이 bat 에 넣으세요. & pause & exit /b 1 )

set "PYEXE=py"
where py >nul 2>&1 || set "PYEXE=C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe"
:loop
netstat -ano | findstr ":9224" | findstr LISTENING >nul
if errorlevel 1 (
  echo [CHROME START theman] %date% %time% >> cafe_listener_theman.log
  start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --remote-debugging-port=9224 --user-data-dir="%~dp0chrome_profile_theman" --window-size=1400,950 --no-first-run --no-default-browser-check "https://cafe.naver.com"
  timeout /t 8 /nobreak >nul
)
echo [LISTENER START theman] %date% %time% >> cafe_listener_theman.log
"%PYEXE%" -u publish_listener.py >> cafe_listener_theman.log 2>&1
echo [LISTENER END theman] %date% %time% (exit=%errorlevel%) - 30s 후 재시작 >> cafe_listener_theman.log
timeout /t 30 /nobreak >nul
goto loop
