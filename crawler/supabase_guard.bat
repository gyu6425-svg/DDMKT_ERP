@echo off
REM Supabase 402 guard - loop, restart if it dies.
cd /d "%~dp0"
:loop
"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" supabase_guard.py --sec 300 >> supabase_guard.log 2>&1
timeout /t 60 /nobreak >nul
goto loop
