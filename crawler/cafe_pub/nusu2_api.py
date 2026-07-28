# -*- coding: utf-8 -*-
"""nusu2 발행 브릿지 서버 (127.0.0.1:8788) — 웹 UI가 region 넘기면 nusu2/ddclean 의
   make_and_queue 를 호출해 cafe_publish_queue 에 적재한다. 발행은 기존 리스너가 처리.
   ★ nusu2 로직을 JS로 이식하지 않고 python 단일소스 그대로 재사용(중복/드리프트 방지).

   엔드포인트:
     GET  /api/nusu2/health                 → {ok, durban}
     POST /api/nusu2/queue                   → 1건 생성·큐적재
        body: {"region","kind"?,"company"?,"board"?,"add_link"?}
              kind: "nusu"(기본, 누수 nusu2) | "durban"(입주청소 ddclean)
        resp: {ok, job_id, title, region}   (실패 시 {ok:false, error})

   실행: run_nusu2_api.bat  (또는 py -u nusu2_api.py). .env 는 자동 로드.
   ※ nusu2 make_and_queue 는 module-global COMPANY/BOARD_NAME/ADD_LINK 를 읽으므로,
     요청별 company/board 오버라이드는 _lock 으로 직렬화해 모듈 전역을 잠깐 바꿔 호출한다."""
import os, sys, json, threading, subprocess, socket, glob as _glob
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# 데이터 폴더 — 프리즈 시 agent_main 이 CAFE_DATA_DIR(exe 옆) 로 넘긴다. 없으면 이 파일 위치(무변경).
CAFE = os.environ.get("CAFE_DATA_DIR") or os.path.dirname(os.path.abspath(__file__))


def _chrome_path():
    for p in [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ]:
        if os.path.exists(p):
            return p
    return None


def _port_alive(port):
    try:
        with socket.create_connection(("127.0.0.1", int(port)), timeout=1):
            return True
    except OSError:
        return False


def _launch_login_chrome(profile, port, url):
    """보이는 크롬을 remote-debugging 포트로 띄운다(로그인/발행용 프로필 세션 저장). 이미 떠 있으면 재사용."""
    if _port_alive(port):
        return {"ok": True, "already": True, "port": port, "profile": profile}
    chrome = _chrome_path()
    if not chrome:
        raise RuntimeError("Chrome 실행파일을 찾을 수 없습니다(설치 확인).")
    profile_dir = os.path.join(CAFE, profile)
    args = [chrome, f"--remote-debugging-port={port}", f"--user-data-dir={profile_dir}",
            "--window-size=1400,950", "--no-first-run", "--no-default-browser-check",
            url or "https://nid.naver.com/nidlogin.login"]
    subprocess.Popen(args, close_fds=True)
    return {"ok": True, "already": False, "port": port, "profile": profile}


def _load_env(path):
    try:
        for line in open(path, encoding="utf-8-sig"):
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"'))
    except FileNotFoundError:
        pass


# OPENAI: ../.env, SUPABASE: ../../.env, 로컬 override: ./.env
_load_env(os.path.join(CAFE, "..", ".env"))
_load_env(os.path.join(CAFE, "..", "..", ".env"))
_load_env(os.path.join(CAFE, ".env"))

sys.path.insert(0, CAFE)
os.chdir(CAFE)
import cafe_auto_publish_nusu2 as NUSU
import publish_cafe as pc
try:
    import cafe_auto_publish_ddclean as DURBAN
except Exception as e:
    DURBAN = None
    print(f"[nusu2_api] ddclean 로드 실패(durban 비활성): {e}", flush=True)

PORT = int(os.environ.get("NUSU2_API_PORT", "8788"))
_lock = threading.Lock()


def _queue(kind, region, company, board, add_link):
    mod = DURBAN if kind == "durban" else NUSU
    if mod is None:
        raise RuntimeError("durban(ddclean) 모듈이 로드되지 않았습니다.")
    with _lock:  # 모듈 전역 오염 방지 — 생성 직렬화
        if company:
            mod.COMPANY = company
        if board:
            mod.BOARD_NAME = board
        if add_link is not None:
            mod.ADD_LINK = bool(add_link)
        jid = mod.make_and_queue(region, popular_verified=True)
        row = pc.sb_get("cafe_publish_queue", {"id": f"eq.{jid}", "select": "title"})
    return jid, (row[0]["title"] if row else "")


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/nusu2/health"):
            self._json(200, {"ok": True, "durban": DURBAN is not None})
            return
        if self.path.startswith("/api/login/ping"):
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(self.path).query)
            port = (q.get("port", ["9227"])[0] or "9227").strip()
            self._json(200, {"alive": _port_alive(port), "port": port})
            return
        if self.path.startswith("/api/nusu2/dongs"):
            # 계층 스캔용 — 지역의 실재 동 목록 + 구 형태(서울 자치구) 반환. (python 단일소스)
            from urllib.parse import urlparse, parse_qs, unquote
            q = parse_qs(urlparse(self.path).query)
            region = unquote((q.get("region", [""])[0] or "").strip())
            r = region
            short = r[:-1] if (r.endswith("구") and r[:-1] in NUSU.SEOUL_GU) else r
            dongs = list(NUSU.DONG_DICT.get(short) or NUSU.METRO_DONG.get(short) or NUSU.METRO_DONG.get(r) or [])
            gu = []  # 서울 자치구면 구/짧은형 둘 다 후보(영등포구 / 영등포)
            if short in NUSU.SEOUL_GU:
                gu = [short + "구", short]
            self._json(200, {"region": region, "dongs": dongs, "gu": gu})
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path.startswith("/api/login/launch"):
            try:
                n = int(self.headers.get("Content-Length", "0"))
                data = json.loads(self.rfile.read(n) or b"{}")
                profile = (data.get("profile") or "").strip()
                port = str(data.get("port") or "").strip()
                if not profile or not port:
                    self._json(400, {"ok": False, "error": "profile·port 필요"})
                    return
                res = _launch_login_chrome(profile, port, (data.get("url") or "").strip())
                print(f"[nusu2_api] login chrome {profile}:{port} (already={res.get('already')})", flush=True)
                self._json(200, res)
            except Exception as e:
                self._json(500, {"ok": False, "error": str(e)[:200]})
            return
        if not self.path.startswith("/api/nusu2/queue"):
            self._json(404, {"ok": False, "error": "not found"})
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:
            self._json(400, {"ok": False, "error": f"bad json: {e}"})
            return
        region = (data.get("region") or "").strip()
        if not region:
            self._json(400, {"ok": False, "error": "region 필요"})
            return
        try:
            jid, title = _queue(
                data.get("kind", "nusu"), region,
                data.get("company"), data.get("board"), data.get("add_link"),
            )
            print(f"[nusu2_api] queued {region} -> {title[:40]}", flush=True)
            self._json(200, {"ok": True, "job_id": jid, "title": title, "region": region})
        except Exception as e:
            print(f"[nusu2_api] FAIL {region}: {str(e)[:120]}", flush=True)
            self._json(500, {"ok": False, "error": str(e)[:300], "region": region})

    def log_message(self, *a):
        pass


def serve(block=True):
    """브릿지 서버 기동. agent_main 이 스레드로 띄울 때는 block=False 로 서버 객체만 받아 돌린다."""
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[nusu2_api] listening 127.0.0.1:{PORT} (durban={DURBAN is not None})", flush=True)
    if block:
        srv.serve_forever()
    return srv


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    serve(block=True)
