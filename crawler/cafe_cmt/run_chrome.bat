@echo off
REM [normal ops] Headless Chrome for cafe comment automation (no visible window).
REM   Usage: run_chrome.bat [account]
REM     account = a name from accounts.txt. Empty = first line (default account).
REM   Port and profile dir come from accounts.txt so python and bat share one registry.
REM   If a named account is NOT in accounts.txt this exits with an error instead of
REM   falling back to the default - falling back would drive the wrong Naver identity.
REM   NOTE: ASCII + CRLF only. %~dp0 trailing backslash must be stripped.
setlocal enabledelayedexpansion
set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set "ACCT=%~1"
set "PORT="
set "PROFILE="
set "FOUND="
if exist "%HERE%\accounts.txt" (
  REM delims includes a space so "sub01, 9225" style lines do not keep the space
  for /f "usebackq eol=# tokens=1,2,3 delims=, " %%a in ("%HERE%\accounts.txt") do (
    if not defined FOUND (
      if "!ACCT!"=="" (
        set "ACCT=%%a"
        set "PORT=%%b"
        set "PROFILE=%%c"
        set "FOUND=1"
      ) else if /i "%%a"=="!ACCT!" (
        set "PORT=%%b"
        set "PROFILE=%%c"
        set "FOUND=1"
      )
    )
  )
)
if not defined FOUND if not "%~1"=="" (
  echo ERROR: account "%~1" is not listed in accounts.txt - refusing to start.
  echo        Add it to accounts.txt, then run: run_chrome_login.bat %~1
  endlocal & exit /b 1
)
if not defined PORT set "PORT=9224"
if not defined PROFILE set "PROFILE=chrome_profile"
echo Starting headless Chrome: account=!ACCT! port=!PORT! profile=!PROFILE!
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 --headless=new --remote-debugging-port=!PORT! --user-data-dir="%HERE%\!PROFILE!" ^
 --window-size=1400,950 --no-first-run --no-default-browser-check ^
 "https://cafe.naver.com"
endlocal
