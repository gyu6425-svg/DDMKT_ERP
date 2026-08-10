@echo off
REM nusu2 publish bridge server (127.0.0.1:8788) - called by web UI (AutoPublishPanel).
REM Keep this window open while using the UI "nusu2 button". Ctrl+C to stop.
cd /d "%~dp0"
set "PYEXE=py"
where py >nul 2>&1 || set "PYEXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
"%PYEXE%" -u nusu2_api.py
