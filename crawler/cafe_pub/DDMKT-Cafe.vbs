' DDMKT 카페 자동발행 리스너 자동시작 (로그온 시, 콘솔창 숨김 실행)
' run_cafe_listener.bat → 헤드리스 크롬(9223) 확인/기동 + publish_listener.py 상시 실행.
' 큐 발행 + 유휴 시 세션 유지 핑(자리 비워도 로그인 유지). Startup 폴더에 복사해서 사용.
CreateObject("WScript.Shell").Run "cmd /c ""C:\Users\ddmkt\DDMKT_ERP\crawler\cafe_pub\run_cafe_listener.bat""", 0, False
