@echo off
REM DDMKT 블로그 순위 크롤러 - 매일 자동 실행 래퍼 (Windows 작업 스케줄러용)
REM   - %~dp0 = 이 배치파일이 있는 crawler 폴더(작업 디렉터리 고정)
REM   - 실행 로그는 crawler\crawler.log 에 누적(문제 진단용)
cd /d "%~dp0"
echo ============================================== >> crawler.log
echo [START] %date% %time% >> crawler.log
REM 차단 회피: 간격 넉넉히 + 시간분산(--spread). 04시 시작 → 09시(-20분) 전 완료되게 청크 간격 자동 분배.
REM   blogtab=공식 API(SERP 절반) + 5글 + 5블로그씩 청크 + 청크 사이 갭 = 무료로 사실상 무차단.
set CRAWL_DELAY=3.5
set CRAWL_REST_EVERY=6
set CRAWL_REST_SEC=40
"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" blog_rank_crawler.py --spread --chunk-size 5 --deadline 09:00 >> crawler.log 2>&1
echo [END]   %date% %time% (exit=%errorlevel%) >> crawler.log
