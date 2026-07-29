@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [1/2] requests 라이브러리 설치 확인...
python -m pip install requests -q
if errorlevel 1 (
  echo.
  echo [오류] python 이 설치 안 됐거나 PATH 에 없습니다. README_설치.txt 1번을 먼저 하세요.
  pause
  exit /b 1
)
echo [2/2] 발굴 스캔 실행...
python discover.py
pause
