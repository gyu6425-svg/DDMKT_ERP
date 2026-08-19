@echo off
REM DDMKT self-hosted stack guard - loop, restart if it dies. ASCII + CRLF only.
REM   Watches: tunnel (db.ddmktcloud.com), containers, VM disk, backup freshness.
REM   Log: crawler\selfhost_guard.log
cd /d "%~dp0"
:loop
"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" selfhost_guard.py --sec 300 >> selfhost_guard.log 2>&1
timeout /t 60 /nobreak >nul
goto loop
