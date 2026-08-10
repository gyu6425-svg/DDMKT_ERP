@echo off
REM [SUB1] Blog auto-SAVE listener. Fills the Naver blog editor and clicks SAVE only.
REM   It never publishes: save_blog.py has no publish code path and blocks publish
REM   requests at the network + DOM level. See test_no_publish.py.
REM
REM   1) Starts headless Chrome on 9225 if not listening (profile: blog_pub\chrome_profile).
REM   2) Runs blog_save_listener.py - polls blog_save_queue, saves drafts, keeps session alive.
REM   3) Restarts 30s after any exit. Log: blog_saver.log
REM
REM   Requires blog_pub\.env : BLOG_IDS, BLOG_WRITE_URL, BLOG_ID
REM   Real saving also requires BLOG_SAVE_ENABLED=1 (default is a safe dry-run).
REM   NOTE: ASCII-only comments on purpose (codepage 949 breaks Korean in .bat).
cd /d "%~dp0"
REM Python resolution: py launcher -> python on PATH -> main-PC absolute path (last resort).
REM   The cafe bat only had "py" + the main-PC path, so on a PC without the py launcher it
REM   died instantly and the restart loop only logged START/END - it LOOKED like it was running.
set "PYEXE="
where py >nul 2>&1 && set "PYEXE=py"
if not defined PYEXE (
  where python >nul 2>&1 && set "PYEXE=python"
)
if not defined PYEXE (
  if exist "C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" set "PYEXE=C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe"
)
if not defined PYEXE (
  echo [FATAL] No Python found. Install Python or fix PATH. >> blog_saver.log
  echo [FATAL] No Python found. Install Python or fix PATH.
  exit /b 1
)
:loop
netstat -ano | findstr ":9225" | findstr LISTENING >nul
if errorlevel 1 (
  echo [CHROME START] %date% %time% >> blog_saver.log
  start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --remote-debugging-port=9225 --user-data-dir="%~dp0chrome_profile" --window-size=1400,950 --no-first-run --no-default-browser-check "https://blog.naver.com"
  timeout /t 8 /nobreak >nul
)
echo [SAVER START] %date% %time% >> blog_saver.log
"%PYEXE%" -u blog_save_listener.py >> blog_saver.log 2>&1
echo [SAVER END] %date% %time% (exit=%errorlevel%) - restart in 30s >> blog_saver.log
timeout /t 30 /nobreak >nul
goto loop
