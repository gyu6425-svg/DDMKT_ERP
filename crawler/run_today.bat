@echo off
cd /d "%~dp0"
echo [TODAY-START] %date% %time% >> crawler.log
"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" -u crawl_bydate.py 1 >> crawler.log 2>&1
echo [TODAY-END] %date% %time% (exit=%errorlevel%) >> crawler.log
