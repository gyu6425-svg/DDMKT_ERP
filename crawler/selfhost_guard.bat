@echo off
REM DDMKT self-hosted stack guard - loop, restart if it dies. ASCII + CRLF only.
REM   Watches: tunnel (db.ddmktcloud.com), containers, VM disk, backup freshness.
REM   Log: crawler\selfhost_guard.log
cd /d "%~dp0"
:loop
"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" selfhost_guard.py --sec 300 >> selfhost_guard.log 2>&1
REM   Wait with ping, not timeout: `timeout` returns INSTANTLY when stdin is not a console
REM   (VBS/service launch). SUB4 measured 429 restarts in ~5 min - 1.3/sec, each one hitting
REM   the self-hosted backend. ping always waits. Measured on main 2026-08-19 too:
REM   timeout /t 3 with non-console stdin returned in 0.1s; ping -n 4 took 3.1s.
ping -n 61 127.0.0.1 >nul
goto loop
