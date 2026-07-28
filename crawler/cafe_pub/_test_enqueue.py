# -*- coding: utf-8 -*-
"""테스트 큐 1건 적재(스캔 우회) — agent.env 로드 후 make_and_queue 직접 호출.
   CF 원고 생성 + 이미지 업로드 + 큐 insert 가 전부 publishable+내부JWT 로 되는지 검증.
   실행: python _test_enqueue.py
"""
import os
import pathlib
import sys

# agent.env 를 os.environ 에 먼저 주입(생성기 import 전에 — 모듈 상수가 여기서 읽힌다).
for line in pathlib.Path("agent.env").read_text(encoding="utf-8").splitlines():
    s = line.strip()
    if s and not s.startswith("#") and "=" in s:
        k, v = s.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

import cafe_auto_publish_nusu2 as m  # noqa: E402

print("company:", m.COMPANY, "| board:", m.BOARD_NAME, "| GENERATE_API:", bool(m.GENERATE_API))
try:
    jid = m.make_and_queue("수원", popular_verified=True)
    print("OK 적재:", jid)
except Exception as e:
    print("FAIL:", str(e)[:300]); sys.exit(1)
