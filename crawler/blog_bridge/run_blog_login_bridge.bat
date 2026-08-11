@echo off
REM [SUB1] Blog login bridge - lets the web studio's "Naver login" button open a
REM   per-blog Chrome (own profile + port) on THIS publish PC. Keep this running.
REM   Port 8790. Web (localhost:5173) calls 127.0.0.1:8790. ASCII-only on purpose.
cd /d "%~dp0"
set "PYEXE="
where py >nul 2>&1 && set "PYEXE=py"
if not defined PYEXE where python >nul 2>&1 && set "PYEXE=python"
if not defined PYEXE (
  echo [FATAL] No Python found. Install Python or fix PATH.
  exit /b 1
)
:loop
"%PYEXE%" -u blog_login_bridge.py
echo [bridge exited] restart in 5s
ping -n 6 127.0.0.1 >nul
goto loop
