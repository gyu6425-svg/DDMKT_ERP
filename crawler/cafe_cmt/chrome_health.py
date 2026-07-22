# -*- coding: utf-8 -*-
"""계정 크롬 CDP 실제 연결 점검 — 워치독이 '좀비 크롬'을 잡게 한다.

포트가 열려있고 HTTP /json/version 이 응답해도, CDP 웹소켓이 먹통이면(좀비)
   connect_over_cdp 가 멈춘다. 포트 체크로는 못 잡는다(2026-07-22 실제 사고).
   그래서 진짜 연결을 짧은 타임아웃으로 시도해, 죽었/멈춘 포트만 'name,port' 로 출력한다.
   워치독은 이 목록의 크롬만 죽였다 되살린다.

출력: 죽은 계정마다 한 줄 'name,port' (정상이면 아무 것도 출력 안 함)
"""
import sys

try:
    import accounts as acct
    from playwright.sync_api import sync_playwright
except Exception as e:
    # 라이브러리 문제면 오판(전체 재시작) 막으려고 조용히 종료
    sys.exit(0)

TIMEOUT_MS = 8000

def main():
    try:
        accounts = acct.load_accounts()
    except Exception:
        return
    with sync_playwright() as p:
        for a in accounts:
            port = a.get("port")
            if not port:
                continue
            try:
                b = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}", timeout=TIMEOUT_MS)
                # 컨텍스트 접근까지 돼야 진짜 정상
                _ = b.contexts
                b.close()
            except Exception:
                print(f"{a['name']},{port}", flush=True)

if __name__ == "__main__":
    main()
