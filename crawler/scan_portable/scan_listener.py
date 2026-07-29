# -*- coding: utf-8 -*-
"""SUB4 인기탭 발굴 스캔 리스너 — keyword_scan_requests 큐를 폴링해 폰 IP로 스캔.
  · discover.is_popular() 재사용(검증된 PC 인기탭 판정). Supabase 통신=랜(빠름), 네이버 스캔=폰(분리 라우팅).
  · 흐름: 프론트가 pending INSERT → 이 리스너가 claim(processing) → 스캔 → results 채우고 done.
  · IP 가드: 스캔 직전 공인 IP 확인, 사무실 IP(218.233.16.38)면 그 요청은 fail 처리(사고 방지).
  실행(SUB4):  scan_portable/.env 에 SUPABASE_URL, SUPABASE_SERVICE_KEY 넣고  ->  python scan_listener.py
"""
import os, sys, time, datetime, json
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
import requests
requests.packages.urllib3.disable_warnings()
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
import discover   # is_popular, egress_ip, OFFICE_IP, GAP_SEC (같은 폴더)

# scan_portable/.env 로드(SUPABASE_URL / SUPABASE_SERVICE_KEY). 기존 crawler/.env 와 같은 값 사용.
_envp = os.path.join(_HERE, '.env')
if os.path.exists(_envp):
    for _l in open(_envp, encoding='utf-8'):
        _l = _l.strip()
        if _l and not _l.startswith('#') and '=' in _l:
            _k, _v = _l.split('=', 1)
            os.environ.setdefault(_k.strip(), _v.strip())

SB_URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
SB_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
POLL_SEC = int(os.environ.get('SCAN_POLL_SEC', '5'))
MAX_KW = int(os.environ.get('SCAN_MAX_KW', '300'))     # 요청당 상한(폰 1.5GB 데이터 예산 보호)


def _hdr():
    return {'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}', 'Content-Type': 'application/json'}


def sb_get(path, params):
    r = requests.get(f'{SB_URL}/rest/v1/{path}', headers=_hdr(), params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def sb_patch(path, params, payload):
    r = requests.patch(f'{SB_URL}/rest/v1/{path}', headers={**_hdr(), 'Prefer': 'return=minimal'},
                       params=params, json=payload, timeout=30)
    r.raise_for_status()


def _now():
    return datetime.datetime.now().isoformat(timespec='seconds')


def process_one():
    """pending 1건 처리. 처리했으면 True, 없으면 False."""
    rows = sb_get('keyword_scan_requests',
                  {'status': 'eq.pending', 'order': 'created_at.asc', 'limit': '1', 'select': '*'})
    if not rows:
        return False
    req = rows[0]
    rid = req['id']
    kws = req.get('keywords') or []
    if isinstance(kws, str):
        try:
            kws = json.loads(kws)
        except Exception:
            kws = []
    sb_patch('keyword_scan_requests', {'id': f'eq.{rid}'}, {'status': 'processing'})

    # IP 가드 — 라우팅 풀려 사무실 IP면 이 요청은 실패 처리(사무실 IP로 스캔 방지)
    ip = discover.egress_ip()
    if ip.get('query') == discover.OFFICE_IP:
        print(f"[{_now()}] 경고: 사무실 IP({ip.get('query')}) — 라우팅 풀림. 요청 {rid} fail.", flush=True)
        sb_patch('keyword_scan_requests', {'id': f'eq.{rid}'},
                 {'status': 'fail', 'results': {'error': 'office_ip_routing_off'}, 'done_at': _now()})
        return True

    kws = kws[:MAX_KW]
    print(f"[{_now()}] 요청 {rid}: {len(kws)}개 스캔 (IP {ip.get('query')} / {ip.get('isp')} / mobile={ip.get('mobile')})", flush=True)
    results = {}
    for i, kw in enumerate(kws, 1):
        r = discover.is_popular(kw)
        results[kw] = 'O' if r is True else ('X' if r is False else 'err')
        print(f"  [{i}/{len(kws)}] {kw} -> {results[kw]}", flush=True)
        if i < len(kws):
            time.sleep(discover.GAP_SEC)
    sb_patch('keyword_scan_requests', {'id': f'eq.{rid}'},
             {'status': 'done', 'results': results, 'done_at': _now()})
    o = sum(1 for v in results.values() if v == 'O')
    print(f"[{_now()}] 요청 {rid} 완료 — 인기탭 O {o}/{len(kws)}", flush=True)
    return True


def main():
    if not SB_URL or not SB_KEY:
        print("[중단] SUPABASE_URL / SUPABASE_SERVICE_KEY 가 필요합니다. scan_portable/.env 에 넣으세요.")
        return
    print(f"[스캔 리스너 시작] {_now()} — keyword_scan_requests 폴링(간격 {POLL_SEC}s, 요청당 최대 {MAX_KW}개)", flush=True)
    while True:
        try:
            worked = process_one()
        except Exception as e:
            print(f"[오류] {e}", flush=True)
            worked = False
        if not worked:
            time.sleep(POLL_SEC)


if __name__ == '__main__':
    main()
