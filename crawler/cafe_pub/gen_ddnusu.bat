@echo off
REM DDNusu daily generation (02:00, crawler idle window). Queues ~8 leak3 posts.
cd /d "%~dp0"
set "PYEXE=py"
where py >nul 2>&1 || set "PYEXE=C:\Users\rlawh\AppData\Local\Programs\Python\Python312\python.exe"
echo [GEN START] %date% %time% >> cafe_ddnusu.log
"%PYEXE%" -u gen_ddnusu.py >> cafe_ddnusu.log 2>&1
echo [GEN END] %date% %time% >> cafe_ddnusu.log
