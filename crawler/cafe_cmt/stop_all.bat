@echo off
REM 카페 댓글 자동화 종료 — 데몬·워처 창을 닫는다. (크롬 9224는 로그인 세션 유지 위해 남겨둠)
taskkill /fi "WINDOWTITLE eq cafe-댓글데몬*" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq cafe-새글감시*" /f >nul 2>&1
echo ✅ 댓글 데몬·워처 종료됨. (크롬은 유지 — 완전 종료하려면 크롬 창도 닫으세요)
timeout /t 3 /nobreak >nul
