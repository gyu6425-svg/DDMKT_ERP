@echo off
REM [상시 운영] 카페 자동발행 리스너 — 로그온 시 자동시작(Startup\DDMKT-Cafe.vbs, 숨김 실행).
REM   1) 헤드리스 크롬(9223)이 안 떠 있으면 먼저 기동(세션은 chrome_profile 재사용).
REM   2) publish_listener.py 실행 — 큐 발행 + 유휴 시 세션 유지 핑(자리 비워도 로그인 유지).
REM   3) 어떤 이유로 종료돼도 30초 후 자동 재시작(예약작업 대체). 로그: cafe_listener.log
REM   ※ 세션이 '만료'되면 자동 재로그인은 하지 않음(캡차/2FA/계정잠금 위험) → .session_expired 플래그+경고.
cd /d "%~dp0"
REM Python 실행경로 — PATH의 py 런처 우선, 없으면 메인 PC 절대경로로 폴백(양쪽 PC 호환).
REM   기존엔 메인 PC(C:\Users\ddmkt\...) 경로가 박혀 있어 다른 PC에서는 즉시 종료됐고,
REM   아래 재시작 루프 탓에 로그엔 START/END만 쌓여 '도는 것처럼' 보였다.
set "PYEXE=py"
where py >nul 2>&1 || set "PYEXE=C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe"
:loop
netstat -ano | findstr ":9223" | findstr LISTENING >nul
if errorlevel 1 (
  echo [CHROME START] %date% %time% >> cafe_listener.log
  start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --remote-debugging-port=9223 --user-data-dir="%~dp0chrome_profile" --window-size=1400,950 --no-first-run --no-default-browser-check "https://cafe.naver.com"
  timeout /t 8 /nobreak >nul
)
echo [LISTENER START] %date% %time% >> cafe_listener.log
"%PYEXE%" -u publish_listener.py >> cafe_listener.log 2>&1
echo [LISTENER END] %date% %time% (exit=%errorlevel%) - 30s 후 재시작 >> cafe_listener.log
timeout /t 30 /nobreak >nul
goto loop
