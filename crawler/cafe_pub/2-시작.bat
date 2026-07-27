@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo DDMKT 카페 에이전트 시작...
echo (이 창을 닫지 마세요. 최소화는 괜찮습니다.)
echo.
"%~dp0DDMKT-Agent.exe"
echo.
echo [프로그램이 종료되었습니다. 위 메시지를 확인하세요.]
pause
