# -*- coding: utf-8 -*-
"""데몬 살아있음(hang 아님) 신호 — 각 루프에서 파일에 현재시각을 남긴다.

워치독은 '프로세스가 살아있나'만 보는데, 살아있는데 멈춘(hang) 경우는 못 잡는다.
   각 데몬이 루프마다 .hb_<name> 에 시각을 찍고, 워치독이 그 시각이 오래됐으면(=멈춤)
   프로세스를 죽였다 되살린다. → '죽어도, 멈춰도' 자동 복구.
"""
import os
import time

_DIR = os.path.dirname(os.path.abspath(__file__))


def beat(name):
    """지금 살아있다는 신호를 남긴다(루프 맨 위에서 호출)."""
    try:
        with open(os.path.join(_DIR, f".hb_{name}"), "w", encoding="utf-8") as f:
            f.write(str(time.time()))
    except Exception:
        pass


def sleep_beating(name, seconds):
    """긴 sleep 을 60초 단위로 쪼개 그때마다 heartbeat — 대기 중에도 hang 감지가 살아있게."""
    beat(name)
    end = time.time() + max(0.0, seconds)
    while True:
        remain = end - time.time()
        if remain <= 0:
            break
        time.sleep(min(60.0, remain))
        beat(name)
