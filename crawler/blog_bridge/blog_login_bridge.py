# -*- coding: utf-8 -*-
"""블로그 발행 PC(SUB1) 로컬 로그인 브릿지 — 웹 스튜디오의 '네이버 로그인' 버튼이 호출한다.
   웹UI는 로컬 크롬을 직접 못 띄우므로, 이 PC에서 도는 이 서버가 대신 로그인 크롬을 띄운다.
   ★ 업체마다 다른 크롬: blog_id 마다 **전용 프로필 + 전용 포트**로 띄운다(세션 안 섞임).
      카페 nusu2 브릿지(8788)와 동급. 이 브릿지=8790. stdlib 만 사용(의존성 없음).
   ★ dev(:5173)로 띄운 UI 전용(같은 PC). run_blog_login_bridge.bat 로 먼저 켜 둔다.
"""
import json
import os
import re
import subprocess
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("BLOG_BRIDGE_PORT", "8790"))
HERE = os.path.dirname(os.path.abspath(__file__))
PROFILE_ROOT = os.path.join(HERE, "profiles")   # 업체별 크롬 프로필(전용). blog_id 마다 폴더.
CHROME = os.environ.get("CHROME_EXE", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
LOGIN_URL = "https://nid.naver.com/nidlogin.login"

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
}


def _cdp_alive(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


def _safe_key(blog_id):
    return re.sub(r"[^A-Za-z0-9_.-]", "_", (blog_id or "default"))[:60]


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        for k, v in CORS.items():
            self.send_header(k, v)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass

    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in CORS.items():
            self.send_header(k, v)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/blog/health"):
            return self._send(200, {"ok": True})
        if self.path.startswith("/api/blog/ping"):
            m = re.search(r"[?&]port=(\d+)", self.path)
            port = int(m.group(1)) if m else 9235
            return self._send(200, {"alive": _cdp_alive(port)})
        return self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/api/blog/login"):
            return self._send(404, {"ok": False, "error": "not found"})
        try:
            n = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(n) or b"{}") if n else {}
        except Exception:
            payload = {}
        blog_id = str(payload.get("blog_id") or "").strip()
        try:
            port = int(payload.get("port") or 9235)
        except Exception:
            port = 9235
        if not (9200 <= port <= 9399):
            return self._send(200, {"ok": False, "error": f"포트 범위(9200~9399) 밖: {port}"})
        # 이미 그 포트에 크롬이 떠 있으면 그걸 쓰라고 알려준다(중복 실행 방지).
        if _cdp_alive(port):
            return self._send(200, {"ok": True, "already": True, "port": port})
        profile = os.path.join(PROFILE_ROOT, _safe_key(blog_id))
        os.makedirs(profile, exist_ok=True)
        if not os.path.exists(CHROME):
            return self._send(200, {"ok": False, "error": f"크롬 실행파일을 찾지 못했습니다: {CHROME}"})
        try:
            subprocess.Popen([
                CHROME,
                f"--remote-debugging-port={port}",
                f"--user-data-dir={profile}",
                "--window-size=1400,950", "--no-first-run", "--no-default-browser-check",
                LOGIN_URL,
            ], creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
            return self._send(200, {"ok": True, "already": False, "port": port, "profile": profile})
        except Exception as e:
            return self._send(200, {"ok": False, "error": str(e)[:200]})


if __name__ == "__main__":
    os.makedirs(PROFILE_ROOT, exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    print(f"[blog-login-bridge] 127.0.0.1:{PORT} · 프로필루트={PROFILE_ROOT} · 크롬={CHROME}", flush=True)
    srv.serve_forever()
