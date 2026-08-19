@echo off
REM DDMKT overnight crawl report mailer - starts 00:50, watches until 09:40, then exits.
REM   Sends: start / mid (blog done) / end (cafe done). Also reports silence and stalls -
REM   'no mail arrived' is not something a person reliably notices.
REM   ASCII + CRLF only (Task Scheduler codepage). Log: crawler\crawl_report_mail.log
cd /d "%~dp0"
"C:\Users\ddmkt\AppData\Local\Python\pythoncore-3.14-64\python.exe" crawl_report_mail.py >> crawl_report_mail.log 2>&1
