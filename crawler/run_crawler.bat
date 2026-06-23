@echo off
REM DDMKT 블로그 순위 크롤러 - 매일 자동 실행 래퍼 (Windows 작업 스케줄러용)
REM   - %~dp0 = 이 배치파일이 있는 crawler 폴더(작업 디렉터리 고정)
REM   - 실행 로그는 crawler\crawler.log 에 누적(문제 진단용)
cd /d "%~dp0"
echo ============================================== >> crawler.log
echo [START] %date% %time% >> crawler.log
"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" blog_rank_crawler.py >> crawler.log 2>&1
echo [END]   %date% %time% (exit=%errorlevel%) >> crawler.log
