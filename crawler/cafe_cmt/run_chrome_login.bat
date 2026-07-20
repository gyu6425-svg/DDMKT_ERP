@echo off
REM [first time per account] Visible Chrome for Naver login (cafe comment automation).
REM   Usage: run_chrome_login.bat [account]
REM     account = a name from accounts.txt. Empty = first line (default account).
REM   Log in here; the session is saved into that account's profile dir.
REM   IMPORTANT: check "Keep me logged in" on the Naver login page, otherwise the
REM   session cookie dies when Chrome closes.
REM   Do not run this while run_chrome.bat is using the same profile (profile lock).
REM   NOTE: ASCII + CRLF only. %~dp0 trailing backslash must be stripped.
setlocal enabledelayedexpansion
set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set "ACCT=%~1"
set "PORT="
set "PROFILE="
set "FOUND="
if exist "%HERE%\accounts.txt" (
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
  echo ERROR: account "%~1" is not listed in accounts.txt.
  echo        Add a line first, for example:  %~1,9225,chrome_profile_%~1
  endlocal & exit /b 1
)
if not defined PORT set "PORT=9224"
if not defined PROFILE set "PROFILE=chrome_profile"
echo Login Chrome: account=!ACCT! port=!PORT! profile=!PROFILE!
echo Log in to Naver in the window that opens. CHECK "Keep me logged in".
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 --remote-debugging-port=!PORT! --user-data-dir="%HERE%\!PROFILE!" ^
 --window-size=1400,950 --no-first-run --no-default-browser-check ^
 "https://nid.naver.com/nidlogin.login"
endlocal
