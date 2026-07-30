# -*- coding: utf-8 -*-
"""카페 인기탭 발굴 — 분산 워커 (각 PC가 자기 IP로 스캔).

  동작: Supabase 큐(cafe_kw_requests)에서 '이 플레이스 조회' 요청을 원자적으로 하나 집어
        (claim_kw_request RPC · 중복 방지) → 업종·지역 후보를 검색광고로 뽑고 → 자기 IP로
        인기탭 스캔(공유 캐시 우선) → 결과를 요청.result + 공유 캐시(cafe_kw_targets)에 저장.
  여러 PC에 설치하면 각자 다른 요청을 맡아 IP가 분산된다(용량 = PC 수 배).

  실행: python cafe_kw_worker.py          (상시 데몬 · 큐 폴링)
        python cafe_kw_worker.py --once   (한 건만 처리하고 종료 · 테스트)
  전제: ../.env 의 SUPABASE_URL · SUPABASE_SERVICE_KEY (큐/캐시 접근). docs/cafe-kw-queue.sql 실행됨.
"""
import sys
import os
import re
import time
import json
import socket
from urllib.parse import quote

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore

truststore.inject_into_ssl()
import requests
from dotenv import load_dotenv

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
load_dotenv(os.path.join(_HERE, "..", ".env"))
load_dotenv(os.path.join(_HERE, ".env"))
import cafe_kw_probe as p  # 스캔·파싱·검색광고 로직 재사용

SB = os.getenv("SUPABASE_URL", "").rstrip("/")
KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
WID = f"{socket.gethostname()}-{os.getpid()}"
POLL_SEC = 15
SCAN_GAP = 2.0  # 스캔 간격(무리없게)

# 수도권 지역 토큰(--regions 서울/경기/인천 처리용)
_SUDO = set((
    "강남 강동 강북 강서 관악 광진 구로 금천 노원 도봉 동대문 동작 마포 서대문 서초 성동 성북 송파 양천 영등포 용산 은평 종로 중랑 "
    "수원 성남 고양 용인 부천 안산 안양 남양주 화성 평택 의정부 시흥 파주 김포 광명 군포 오산 이천 양주 안성 구리 의왕 하남 여주 동두천 과천 포천 가평 양평 "
    "인천 미추홀 연수 남동 부평 계양 강화 송도 청라 영종 검단 분당 판교 동탄 광교 위례 미사 다산 별내 운정 삼송 배곧 죽전 수지 정자"
).split())


def _region_ok(kw, provinces):
    """지역 제약. provinces에 '서울/경기/인천'이 있으면 수도권 지역만(+비지역 니치) 통과."""
    if not provinces:
        return True
    if not p.is_regional(kw):
        return True  # 비지역 니치는 통과
    if any(w in provinces for w in ("서울", "경기", "인천")):
        return any(t in kw for t in _SUDO)
    return True


# ── Supabase REST ────────────────────────────────────────────────────────────
def _claim():
    try:
        r = requests.post(f"{SB}/rest/v1/rpc/claim_kw_request", headers=H, json={"p_worker": WID}, timeout=20)
        rows = r.json() if r.status_code == 200 else []
        return rows[0] if rows else None
    except Exception:
        return None


def _cache_get(kw):
    try:
        r = requests.get(f"{SB}/rest/v1/cafe_kw_targets?keyword=eq.{quote(kw)}&select=*", headers=H, timeout=15)
        a = r.json() if r.status_code == 200 else []
        return a[0] if a else None
    except Exception:
        return None


def _cache_put(kw, r, vol):
    row = {
        "keyword": kw, "has_section": bool(r.get("has_section")), "theme": r.get("theme"),
        "verdict": r.get("verdict"), "volume": vol,
        "cafes": [x for x in (r.get("rows") or []) if x.get("kind") == "카페"],
        "scanned_by": WID,
    }
    try:
        requests.post(f"{SB}/rest/v1/cafe_kw_targets", headers={**H, "Prefer": "resolution=merge-duplicates"},
                      json=[row], timeout=15)
    except Exception:
        pass


def _finish(rid, status, result=None, note=None, extra=None):
    body = {"status": status, "note": note}
    if result is not None:
        body["result"] = result
    if extra:
        body.update(extra)
    try:
        requests.patch(f"{SB}/rest/v1/cafe_kw_requests?id=eq.{rid}", headers=H, json=body, timeout=15)
    except Exception:
        pass


# ── 후보 생성 (검증된 durban 방식: 업종 코어 → 검색광고 → 지역/요리 필터) ──────
def _candidates(info, provinces):
    cats = [x.strip() for cc in info["cats"][:2] for x in re.split(r"[,·/]", cc) if x.strip()]
    cores = []
    for c0 in cats + info["keywords"]:
        core = c0
        for suf in ("디자인", "교육", "요리", "전문점", "전문", "공사", "서비스", "센터"):
            if core.endswith(suf) and len(core) - len(suf) >= 2:
                core = core[: -len(suf)]
                break
        for x in (c0, core):
            if x and len(x) >= 2 and x not in cores and not p.is_brandish(x):
                cores.append(x)
    vol = {}
    for core in cores[:8]:
        for kw, tot in p.searchad_candidates(core, min_total=80, limit=40):
            if p.is_offtopic(kw) or not _region_ok(kw, provinces):
                continue
            vol[kw] = max(vol.get(kw, 0), tot)
    # 로컬 우선: 지역형 키워드(지역+업종) 먼저 → 그다음 비지역 니치, 각 검색량순
    return sorted(vol.items(), key=lambda kv: (0 if p.is_regional(kv[0]) else 1, -kv[1]))


def process(req):
    pid = p.parse_place_id(req.get("place_url", ""))
    info = p.place_info(pid) if pid else None
    if not info:
        return _finish(req["id"], "failed", note="플레이스 해석 실패")
    provinces = set((req.get("regions") or "").replace(" ", "").split(",")) if req.get("regions") else set()
    target = int(req.get("target") or 10)
    cands = _candidates(info, provinces)
    found = []
    for kw, vol in cands:
        if len(found) >= target:
            break
        cached = _cache_get(kw)
        if cached is not None:
            r = {"has_section": cached.get("has_section"), "theme": cached.get("theme"),
                 "verdict": cached.get("verdict"), "rows": cached.get("cafes") or []}
        else:
            r = p.classify(kw)  # 자기 IP 스캔(게이트 시 CF 자동전환)
            _cache_put(kw, r, vol)
            time.sleep(SCAN_GAP)
        if r.get("has_section") and str(r.get("verdict", "")).startswith("카페분산") and "레시피" not in (r.get("theme") or ""):
            found.append({"keyword": kw, "volume": vol, "theme": r.get("theme"),
                          "cafes": [x for x in (r.get("rows") or []) if x.get("kind") == "카페"][:5]})
    _finish(req["id"], "done", result=found,
            extra={"place_id": pid, "biz_name": info.get("name")},
            note=f"{len(found)}건 발견 / 후보 {len(cands)}")
    print(f"[{req['id']}] {info.get('name')} → 인기탭 {len(found)}건", flush=True)


def main():
    if not SB or not KEY:
        print("SUPABASE_URL/SERVICE_KEY 없음 (.env 확인)")
        return
    once = "--once" in sys.argv
    print(f"=== 카페 인기탭 워커 시작 · {WID} ===", flush=True)
    while True:
        row = _claim()
        if row:
            try:
                process(row)
            except Exception as e:
                _finish(row["id"], "failed", note=str(e)[:200])
                print(f"[{row['id']}] 실패: {e}", flush=True)
            if once:
                break
        else:
            if once:
                print("대기 요청 없음")
                break
            time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
