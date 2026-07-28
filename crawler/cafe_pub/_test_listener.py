# -*- coding: utf-8 -*-
"""테스트 리스너 — agent.env 로드 후 publish_listener 실행(9226 테스트 크롬, board=수원 광교 횟집).
   실행: python _test_listener.py
"""
import os
import pathlib
import runpy
import sys

for line in pathlib.Path("agent.env").read_text(encoding="utf-8").splitlines():
    s = line.strip()
    if s and not s.startswith("#") and "=" in s:
        k, v = s.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

sys.argv = ["publish_listener.py"]
runpy.run_path("publish_listener.py", run_name="__main__")
