@echo off
REM 고객 발행 에이전트 — 크롬+브릿지+리스너 한 프로세스. 더블클릭 실행.
cd /d "%~dp0"
set "PYEXE=py"
where py >/dev/null 2>&1 || set "PYEXE=python"
"%PYEXE%" -u agent_main.py
pause
