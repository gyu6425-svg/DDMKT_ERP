# -*- coding: utf-8 -*-
"""Supabase 인증 헤더 — 서비스키(레거시) 또는 publishable 키 + 내부계정 JWT.

⚠️ 이 파일은 crawler/cafe_pub/sb_auth.py 의 **복사본**이다(2026-08-10).
   docs/MERGE-SAFETY.md §3.2 — 파이썬은 다른 폴더의 파일을 import 하지 않고 복사해 자립시킨다.
   (import 하면 병합은 깨끗한데 상대가 리팩터링했을 때 런타임에 조용히 깨진다.)
   원본이 바뀌어도 여기는 자동으로 안 따라온다 — 인증 규약이 바뀌면 양쪽 다 고칠 것.

전환 규칙(라이브 무변경):
  · SUPABASE_PUBLISHABLE_KEY + SUPABASE_AUTH_EMAIL + SUPABASE_AUTH_PASSWORD 가 모두 있으면 → publishable+JWT.
  · 하나라도 없으면 → 기존 SUPABASE_SERVICE_KEY(서비스키).

⚠️ env 는 '지연 로딩'한다 — 이 모듈을 import 하는 스크립트가 자체 _load_env() 로 os.environ 을
   먼저 채운 뒤 함수가 호출되므로, 모듈 최상단이 아니라 함수 안에서 os.environ 을 읽는다.
"""
import json
import os
import time

import requests

try:
    requests.packages.urllib3.disable_warnings()
except Exception:
    pass

_tok = {"access": "", "refresh": "", "exp": 0.0}


def _url():
    return os.environ.get("SUPABASE_URL", "").rstrip("/")


def _service_key():
    return os.environ.get("SUPABASE_SERVICE_KEY", "")


def _publishable_key():
    return os.environ.get("SUPABASE_PUBLISHABLE_KEY", "") or os.environ.get("SUPABASE_ANON_KEY", "")


def _auth_email():
    return os.environ.get("SUPABASE_AUTH_EMAIL", "")


def _auth_password():
    return os.environ.get("SUPABASE_AUTH_PASSWORD", "")


def use_publishable():
    """publishable+내부계정 경로를 쓸 수 있는가(3개 env 모두 존재)."""
    return bool(_publishable_key() and _auth_email() and _auth_password())


def ready():
    """조회/저장에 필요한 인증이 준비됐는가 — URL + (서비스키 또는 publishable 경로)."""
    return bool(_url() and (_service_key() or use_publishable()))


def _login():
    r = requests.post(
        f"{_url()}/auth/v1/token?grant_type=password",
        headers={"apikey": _publishable_key(), "Content-Type": "application/json"},
        data=json.dumps({"email": _auth_email(), "password": _auth_password()}),
        timeout=30, verify=False,
    )
    r.raise_for_status()
    d = r.json()
    _tok["access"] = d["access_token"]
    _tok["refresh"] = d.get("refresh_token", "")
    _tok["exp"] = time.time() + float(d.get("expires_in", 3600))


def _refresh():
    if not _tok["refresh"]:
        return _login()
    r = requests.post(
        f"{_url()}/auth/v1/token?grant_type=refresh_token",
        headers={"apikey": _publishable_key(), "Content-Type": "application/json"},
        data=json.dumps({"refresh_token": _tok["refresh"]}),
        timeout=30, verify=False,
    )
    if not r.ok:
        return _login()
    d = r.json()
    _tok["access"] = d["access_token"]
    _tok["refresh"] = d.get("refresh_token", _tok["refresh"])
    _tok["exp"] = time.time() + float(d.get("expires_in", 3600))


def _access():
    if not _tok["access"]:
        _login()
    elif time.time() > _tok["exp"] - 120:
        try:
            _refresh()
        except Exception:
            _login()
    return _tok["access"]


def headers(content_type=None):
    """Supabase REST/Storage 용 헤더. content_type 주면 Content-Type 추가."""
    if use_publishable():
        h = {"apikey": _publishable_key(), "Authorization": f"Bearer {_access()}"}
    else:
        k = _service_key()
        h = {"apikey": k, "Authorization": f"Bearer {k}"}
    if content_type:
        h["Content-Type"] = content_type
    return h
