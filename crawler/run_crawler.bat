@echo off
REM DDMKT 블로그 순위 크롤러 - 매일 자동 실행 래퍼 (Windows 작업 스케줄러용)
REM   - %~dp0 = 이 배치파일이 있는 crawler 폴더(작업 디렉터리 고정)
REM   - 실행 로그는 crawler\crawler.log 에 누적(문제 진단용)
cd /d "%~dp0"
echo ============================================== >> crawler.log
echo [START] %date% %time% >> crawler.log
REM 안전 우선: 순차 실행 + 넉넉한 간격/주기적 휴식(네이버 차단 방지).
REM   CRAWL_DELAY=요청 간격(초, 지터 추가됨) / CRAWL_REST_EVERY=N블로그마다 휴식 / CRAWL_REST_SEC=휴식 길이(초)
set CRAWL_DELAY=3.0
set CRAWL_REST_EVERY=8
set CRAWL_REST_SEC=25
"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" blog_rank_crawler.py >> crawler.log 2>&1
echo [END]   %date% %time% (exit=%errorlevel%) >> crawler.log
