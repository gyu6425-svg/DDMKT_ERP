@echo off
REM DDMKT self-hosted Supabase backup - daily. ASCII+CRLF only (see memory: windows-script-crlf).
REM   Dumps the VM database, pulls it to this PC, verifies by full restore into a temp DB.
REM   Log: crawler\selfhost_backup.log   Exit code 1 = failure (shows in Task Scheduler).
cd /d "%~dp0"
"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" selfhost_backup.py
exit /b %errorlevel%
