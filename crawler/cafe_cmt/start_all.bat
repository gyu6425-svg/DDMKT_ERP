@echo off
REM ════════════════════════════════════════════════════════════════
REM  카페 댓글 자동화 — 전체 시작 (부팅 자동시작/원클릭용)
REM  ① 로그인된 헤드리스 크롬(9224) ② 댓글 게시 데몬 ③ 새 글 감시 워처
REM  워처가 5분마다 카페를 크롤링하며 세션도 갱신 → 별도 keep-alive 불필요.
REM  ⚠️ 최초 1회 run_chrome_login.bat 로 네이버 로그인해 둔 상태여야 함.
REM ════════════════════════════════════════════════════════════════
cd /d "%~dp0"
set PYTHONUTF8=1

echo [1/3] 로그인된 헤드리스 크롬(9224) 시작...
call run_chrome.bat
REM 크롬이 CDP 포트를 열 때까지 잠깐 대기
timeout /t 6 /nobreak >nul

echo [2/3] 댓글 게시 데몬 시작...
start "cafe-댓글데몬" cmd /k "set PYTHONUTF8=1 && py comment_listener.py"

echo [3/3] 새 글 감시 워처 시작...
start "cafe-새글감시" cmd /k "set PYTHONUTF8=1 && py watch_new_posts.py"

echo.
echo ✅ 카페 댓글 자동화 3종 시작됨 (크롬 9224 · 데몬 · 워처).
echo    창을 닫아도 됩니다. 종료하려면 각 cmd 창에서 Ctrl+C 또는 stop_all.bat.
timeout /t 4 /nobreak >nul
