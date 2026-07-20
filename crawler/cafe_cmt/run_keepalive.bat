@echo off
REM Naver session keep-alive - attaches to the headless Chrome (9224) and
REM   periodically touches an authenticated page so the login does not expire.
REM   Optional: the new-post watcher already crawls every 5 min, which keeps
REM   the session warm. Use this only when running the listener without the watcher.
REM   run_chrome.bat must be running first. Do not run together with
REM   run_chrome_login.bat on the same profile (profile lock conflict).
REM   NOTE: this file must stay ASCII + CRLF (see docs ops guide).
cd /d "%~dp0"
set PYTHONUTF8=1
py keep_alive.py
