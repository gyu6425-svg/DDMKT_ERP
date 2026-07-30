@echo off
chcp 65001 >nul
setlocal
echo ============================================
echo   카페 인기탭 스캔 워커 설치 (원클릭)
echo ============================================
cd /d "%~dp0"

echo [1/5] Python 확인...
where python >nul 2>nul
if errorlevel 1 (
  echo    Python 미설치 - winget 설치 시도
  winget install -e --id Python.Python.3.12 --silent --accept-source-agreements --accept-package-agreements
)

echo [2/5] 의존 패키지 설치...
python -m pip install --quiet --upgrade truststore requests beautifulsoup4 python-dotenv

echo [3/5] 최신 코드 받기...
git pull 2>nul

echo [4/5] 자동시작 등록(부팅시 워커 상시 실행)...
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\ddmkt-kw-worker.vbs"
> "%VBS%" echo Set sh=CreateObject("WScript.Shell")
>>"%VBS%" echo sh.CurrentDirectory="%~dp0"
>>"%VBS%" echo sh.Run "cmd /c python cafe_kw_worker.py >> kw_worker.log 2>&1",0,False

echo [5/5] .env 키 확인 및 워커 실행...
if not exist "%~dp0..\.env" (
  echo    [주의] crawler\..\.env 에 SUPABASE_URL / SUPABASE_SERVICE_KEY 를 1회 넣어주세요.
  echo           그 후 이 창을 닫고 이 파일을 다시 실행하면 됩니다.
  pause
  exit /b
)
wscript "%VBS%"
echo.
echo === 설치 완료 - 워커가 백그라운드로 실행중입니다 (kw_worker.log 확인) ===
echo === 이 PC의 IP로 큐 작업을 스캔합니다. 부팅시 자동 시작됩니다. ===
pause
