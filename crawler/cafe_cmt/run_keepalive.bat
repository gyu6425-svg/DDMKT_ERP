@echo off
REM 네이버 세션 keep-alive — run_chrome.bat(헤드리스 9224)에 붙어 주기적으로 세션을 갱신.
REM   ⚠️ run_chrome.bat 이 먼저 떠 있어야 함. run_chrome_login.bat(보이는 크롬)과 동시 실행 금지.
cd /d "%~dp0"
py keep_alive.py
