@echo off
REM durban(theban) cleaning generator launcher. durban env is forced inside the .py.
REM   usage: run_gen_durban.bat --limit 13
cd /d "%~dp0"
set "PYEXE=py"
where py >nul 2>&1 || set "PYEXE=C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe"
"%PYEXE%" -u cafe_auto_publish_durban.py %*
