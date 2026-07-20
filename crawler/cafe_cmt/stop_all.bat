@echo off
REM Stop cafe comment automation (listener + watcher).
REM   Chrome on 9224 is left running so the Naver login session stays alive.
REM   NOTE: this file must stay ASCII + CRLF (see docs ops guide).
taskkill /fi "WINDOWTITLE eq cafe-cmt-listener*" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq cafe-cmt-watcher*" /f >nul 2>&1
echo Stopped: comment listener + new-post watcher.
echo Chrome (9224) left running to keep the Naver session. Close it manually if needed.
ping -n 3 127.0.0.1 >nul 2>&1
