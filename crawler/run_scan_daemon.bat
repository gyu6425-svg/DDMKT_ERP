@echo off
REM Progressive scan daemon - crash restart loop. 10h job; if it dies at night it stays dead until morning.
REM   Resume is automatic: the daemon keeps no checkpoint, it re-reads the DB cache each round
REM   and picks only what is still unjudged. Double-start is blocked by the DB lease
REM   (scan_lease_take) - a second instance exits cleanly with 0.
REM
REM   ASCII ONLY. cmd reads .bat in the OEM codepage (949 here); UTF-8 Korean comments get
REM   mis-decoded and the file fails to parse ("... is not recognized as a command").
REM   Measured 2026-08-06 - the Korean version would not run at all. Same reason cafe_periodic.bat is ASCII.
REM   CRLF ONLY. LF line endings make cmd fail to parse it, silently.
REM
REM   No absolute python path: main is C:\Users\ddmkt (3.14), SUB4 is C:\Users\rlawh (3.12).
REM   This file is tracked in git, so hardcoding one PC breaks the other - and the restart loop
REM   would then retry the same failure every 60s forever (log grows, zero scans).
cd /d "%~dp0"

REM Preflight - fail here instead of creating an endlessly failing loop.
python -c "import truststore, requests, dotenv" >nul 2>&1
if errorlevel 1 (
    echo [FATAL] %date% %time% python or required packages not found >> cafe_scan_daemon.log
    echo [FATAL] check PATH: where python  ^| needs truststore, requests, python-dotenv >> cafe_scan_daemon.log
    exit /b 1
)

:loop
echo [START] %date% %time% >> cafe_scan_daemon.log
python cafe_scan_daemon.py >> cafe_scan_daemon.log 2>&1
echo [END]   %date% %time% (exit=%errorlevel%) - restart in 60s >> cafe_scan_daemon.log
timeout /t 60 /nobreak >nul
goto loop
