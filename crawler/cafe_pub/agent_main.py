# -*- coding: utf-8 -*-
"""고객 단일 발행 에이전트 — 크롬 기동 + 브릿지(8788) + 발행 리스너를 한 프로세스로.
   PyInstaller 로 얼려 고객 PC에서 더블클릭으로 돈다(python/repo 불필요, 시스템 크롬에 CDP attach).

   설정은 env / agent.env(온보딩 UI 가 채움)에서 읽는다:
     CAFE_CDP        발행 크롬 CDP (기본 http://127.0.0.1:9223)
     CAFE_PROFILE    크롬 프로필 폴더명(로그인 세션 저장, 기본 chrome_profile)
     CAFE_WRITE_URL  카페 게시판 글쓰기 URL (필수)
     CAFE_BOARDS     맡을 게시판명(정확 일치)         CAFE_COMPANY  업체 키
     CAFE_START_AT/STOP_AT/MIN_GAP_MIN/MAX_GAP_MIN/MIN_SECONDS/MAX_SECONDS/NO_SEND
     CAFE_ASSETS_DIR 업체 자산 폴더(실사·배너; 고객별 다운로드분)

   ※ 최초 1회 네이버 로그인은 온보딩 UI 의 '로그인 창 열기'(보이는 크롬, 같은 프로필)로 하고 그 창을 닫은 뒤
     이 에이전트를 실행한다(같은 프로필을 헤드리스로 attach). 로그인 세션은 프로필에 유지된다."""
import os
import sys
import time
import threading
import subprocess


def _base_dir():
    """데이터 폴더(agent.env·chrome_profile·assets·logs 위치).
    · PyInstaller onedir 로 얼리면 __file__ 은 _internal 안이라 쓸 수 없다 → exe 옆 폴더를 쓴다.
    · 개발(비프리즈)에선 이 파일이 있는 cafe_pub 폴더 = 기존과 동일."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


HERE = _base_dir()
# 하위 모듈(publish_cafe·nusu2_api·publish_listener)이 같은 데이터 폴더를 쓰도록 env 로 넘긴다.
#   ⚠️ 비프리즈에선 아래 모듈들이 이 env 없으면 dirname(__file__) 로 폴백 → 라이브 동작 무변경.
os.environ.setdefault("CAFE_DATA_DIR", HERE)
os.chdir(HERE)
sys.path.insert(0, HERE)


def _load_env():
    for p in [os.path.join(HERE, "agent.env"), os.path.join(HERE, ".env"),
              os.path.join(HERE, "..", ".env"), os.path.join(HERE, "..", "..", ".env")]:
        try:
            for line in open(p, encoding="utf-8-sig", errors="ignore"):
                s = line.strip()
                if not s or s.startswith("#") or "=" not in s:
                    continue
                k, v = s.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))
        except FileNotFoundError:
            pass


_load_env()

import nusu2_api  # 브릿지(경로/포트/크롬헬퍼 재사용). _chrome_path/_port_alive 도 여기 있음.


def _cdp_port():
    cdp = os.environ.get("CAFE_CDP", "http://127.0.0.1:9223")
    try:
        return int(cdp.rsplit(":", 1)[1].split("/")[0])
    except Exception:
        return 9223


def ensure_publish_chrome():
    """발행용 헤드리스 크롬을 CDP 포트에 띄운다(이미 있으면 재사용). 로그인 세션은 프로필에서 로드."""
    port = _cdp_port()
    if nusu2_api._port_alive(port):
        return
    chrome = nusu2_api._chrome_path()
    if not chrome:
        print("[agent] Chrome 실행파일을 찾을 수 없습니다(설치 확인).", flush=True)
        return
    profile = os.environ.get("CAFE_PROFILE", "chrome_profile")
    profile_dir = os.path.join(HERE, profile)
    args = [chrome, "--headless=new", f"--remote-debugging-port={port}",
            f"--user-data-dir={profile_dir}", "--window-size=1400,950",
            "--no-first-run", "--no-default-browser-check", "https://cafe.naver.com"]
    subprocess.Popen(args, close_fds=True)
    print(f"[agent] 발행 크롬 기동 :{port} (profile={profile})", flush=True)
    time.sleep(8)


def run_listener_loop():
    """publish_listener 를 자동재시작 루프로 실행(크래시/종료 시 30초 후 재기동).
    ⚠️ runpy.run_path(.py) 대신 모듈 import 로 호출한다 — 프리즈(onedir)엔 .py 파일이 없어
       run_path 가 깨지기 때문. publish_listener.main() 은 내부에 폴링 루프를 가져 정상시 반환하지 않고,
       예외로 빠지면 아래 30초 재시작이 받는다(기존 watchdog 과 동일 동작)."""
    import publish_listener   # 모듈 최상단(OWNED_BOARDS 검사)은 env 로딩 이후라 안전
    while True:
        ensure_publish_chrome()
        print("[agent] listener 시작", flush=True)
        try:
            publish_listener.main()
        except SystemExit:
            pass
        except Exception as e:
            print(f"[agent] listener 예외: {str(e)[:160]}", flush=True)
        print("[agent] listener 종료 — 30초 후 재시작", flush=True)
        time.sleep(30)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if not os.environ.get("CAFE_WRITE_URL"):
        print("[agent] CAFE_WRITE_URL 미설정 — agent.env 또는 온보딩에서 카페 글쓰기 URL을 넣으세요.", flush=True)
    # 브릿지(8788) 스레드로 기동 — 웹UI(스캔·생성·로그인런치)가 붙는다.
    srv = nusu2_api.serve(block=False)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print("[agent] 브릿지 스레드 기동", flush=True)
    # 발행 리스너 루프(메인 스레드)
    run_listener_loop()


if __name__ == "__main__":
    main()
