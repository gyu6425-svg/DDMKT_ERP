@echo off
REM [상시 운영] 더반클린(입주청소) 발행 리스너 — 마이클(누수·더맨, 9223)과 '완전 분리'.
REM   더반 : 크롬 9224 · 게시판 "더반클린 입주청소" · 더반카페(31761053) · black4458 계정 · cafe_listener_durban.log
REM   → 카페·계정·크롬·큐 전부 갈려 마이클과 0충돌. (다른 카페·다른 계정이라 가장 안전한 케이스)
REM   ※ 켜기 전 run_chrome_login_durban.bat 로 black4458 로그인 1회 필요.
cd /d "%~dp0"

REM ── 더반 전용 설정 (여기 set 값이 .env 보다 우선) ─────────────────────────
set "CAFE_CDP=http://127.0.0.1:9224"
set "CAFE_WRITE_URL=https://cafe.naver.com/ca-fe/cafes/31761053/menus/2/articles/write?boardType=L"
set "CAFE_BOARDS=더반클린 입주청소"
set "CAFE_BOARD=더반클린 입주청소"
set "CAFE_CLAIM_NULL_BOARD=0"
set "CAFE_NO_SEND=0"
REM 새 계정(black4458) 차단 방지 — 보수적으로. 발행 간격 넓게(60~90분 랜덤 = 시간당 1개 이하).
set "CAFE_MIN_GAP_MIN=60"
set "CAFE_MAX_GAP_MIN=90"
REM 글 1건 작성 시간(초) — 사람처럼 천천히. 400~600초(7~10분) 랜덤.
set "CAFE_MIN_SECONDS=420"
set "CAFE_MAX_SECONDS=600"
set "CAFE_STOP_AT=19:00"
REM ────────────────────────────────────────────────────────────────────────

set "PYEXE=py"
where py >nul 2>&1 || set "PYEXE=C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe"
:loop
netstat -ano | findstr ":9224" | findstr LISTENING >nul
if errorlevel 1 (
  echo [CHROME START durban] %date% %time% >> cafe_listener_durban.log
  start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --remote-debugging-port=9224 --user-data-dir="%~dp0chrome_profile_durban" --window-size=1400,950 --no-first-run --no-default-browser-check "https://cafe.naver.com"
  timeout /t 8 /nobreak >nul
)
echo [LISTENER START durban] %date% %time% >> cafe_listener_durban.log
"%PYEXE%" -u publish_listener.py >> cafe_listener_durban.log 2>&1
echo [LISTENER END durban] %date% %time% (exit=%errorlevel%) - 30s 후 재시작 >> cafe_listener_durban.log
timeout /t 30 /nobreak >nul
goto loop
