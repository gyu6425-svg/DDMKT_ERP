# -*- coding: utf-8 -*-
"""
카페 댓글 자동화 — 계정 레지스트리 (멀티 네이버 계정).

계정마다 별도 크롬 프로필 + CDP 포트를 쓴다. 목록은 accounts.txt 한 곳에만 두고
Python(이 모듈)과 bat(run_chrome*.bat / start_all.bat)이 같은 파일을 읽어 이중관리를 없앤다.

accounts.txt 형식 (ASCII, 한 줄에 한 계정, 공백 없이):
    name,port,profile_dir
    dog6425,9224,chrome_profile
    sub01,9225,chrome_profile_sub01

- 포트 9222=카카오, 9223=카페발행 이 이미 사용 중 → 댓글용은 9224부터(그 아래는 거부).
- 파일이 없으면 기존 단일계정(9224/chrome_profile)로 동작해 하위호환 유지.

⚠️ 중요(독립검증 B1): **이름이 주어졌는데 목록에 없으면 절대 기본 계정으로 폴백하지 않는다.**
   폴백하면 엉뚱한 네이버 아이디로 댓글이 달린다. find_account()가 None 을 돌려주고
   호출부(리스너/워처)가 그 작업을 실패 처리해야 한다.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ACCOUNTS_FILE = os.path.join(HERE, "accounts.txt")

DEFAULT_PORT = 9224
DEFAULT_PROFILE = "chrome_profile"
RESERVED_PORTS = {9222: "kakao_biz", 9223: "cafe_pub"}   # 다른 자동화가 쓰는 포트

_warned = [False]


def _log(m):
    print(f"[accounts] {m}", flush=True)


def load_accounts():
    """accounts.txt → [{'name','port','profile'}]. 없거나 비면 기본 단일계정 1건."""
    out, seen = [], set()
    try:
        # utf-8-sig: BOM 이 붙어도 첫 계정명이 깨지지 않게(독립검증 m10)
        with open(ACCOUNTS_FILE, "r", encoding="utf-8-sig", errors="ignore") as f:
            for ln, line in enumerate(f, 1):
                line = line.strip().lstrip("﻿")
                if not line or line.startswith("#"):
                    continue
                parts = [p.strip() for p in line.split(",")]
                name = parts[0] if parts else ""
                if not name:
                    continue
                if name.lower() in seen:
                    _log(f"경고: accounts.txt {ln}행 계정명 중복 무시 — {name}")
                    continue
                try:
                    port = int(parts[1]) if len(parts) > 1 and parts[1] else DEFAULT_PORT
                except ValueError:
                    _log(f"경고: accounts.txt {ln}행 포트가 숫자가 아님 — {name} 건너뜀")
                    continue
                if port in RESERVED_PORTS:
                    _log(f"경고: accounts.txt {ln}행 포트 {port} 는 {RESERVED_PORTS[port]} 전용 — {name} 건너뜀")
                    continue
                profile = parts[2] if len(parts) > 2 and parts[2] else DEFAULT_PROFILE
                out.append({"name": name, "port": port, "profile": profile})
                seen.add(name.lower())
    except FileNotFoundError:
        if not _warned[0]:
            _log(f"accounts.txt 없음 → 기본 단일계정({DEFAULT_PORT}/{DEFAULT_PROFILE})로 동작. "
                 f"멀티계정은 accounts.example.txt 를 복사해 만드세요.")
            _warned[0] = True
    except Exception as e:
        _log(f"경고: accounts.txt 읽기 실패({str(e)[:60]}) → 기본 단일계정으로 동작")
    if not out:
        out = [{"name": "default", "port": DEFAULT_PORT, "profile": DEFAULT_PROFILE}]
    return out


def default_account():
    return load_accounts()[0]


def find_account(name):
    """계정명 → 계정 dict.
       - name 이 비어있으면(None/''): 기본(첫) 계정.
       - name 이 있는데 목록에 없으면: **None** (폴백 금지 — 엉뚱한 아이디 방지)."""
    accts = load_accounts()
    if not name or not str(name).strip():
        return accts[0]
    key = str(name).strip().lower()
    for a in accts:
        if a["name"].lower() == key:
            return a
    return None


def canonical_name(name):
    """중복판정/저장에 쓸 정규화된 계정명. 미등록이면 None."""
    a = find_account(name)
    return a["name"] if a else None


def cdp_for(name=None):
    """계정명 → CDP URL. 미등록이면 None(호출부가 실패 처리해야 함)."""
    a = find_account(name)
    return ("http://127.0.0.1:%d" % a["port"]) if a else None


def account_names():
    return [a["name"] for a in load_accounts()]


# 카페별 '작성자 = 대댓글' 계정. 그 카페에선 이 계정은 (자기 글이라) 댓글은 안 달고 대댓글만 단다.
#   여기 없는 카페(예: thebanclean=더반)는 대댓글 없이 댓글만.
#   URL 에 토큰(카페 영문명 또는 club_id)이 들어있으면 그 계정으로 본다.
REPLY_ACCOUNT_BY_CAFE = {
    "ddmkt2": "rlawhddls25", "31754130": "rlawhddls25",   # 마이클의 정보 세상
    "ddnusu": "dog6425",     "31762300": "dog6425",        # 누수탐지 상담소(주인 dog6425)
    # thebanclean(31761053): 없음 → 댓글만
}


def reply_account_for(url):
    """그 글이 올라온 카페의 '작성자=대댓글' 계정명. 없으면 None(대댓글 안 함)."""
    u = (url or "").lower()
    for tok, acc in REPLY_ACCOUNT_BY_CAFE.items():
        if tok.lower() in u:
            return acc
    return None
