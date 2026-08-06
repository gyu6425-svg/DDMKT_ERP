# -*- coding: utf-8 -*-
"""캐시 치유 — 판정 호스트 마커(/m)가 없는 옛 캐시를 모바일 고정으로 재판정한다.

  왜: cafe_kw_targets 5,552행 중 3,584행(65%)이 '/m' 마커 없는 옛 판정(PC/모바일 로테이션 시절)이라
      _cache_trust 가 전부 불신 → 온디맨드 스캔이 매번 라이브로 다시 본다. 한 번 치유하면
      캐시 신뢰율이 35%→100%가 되어 재조회가 즉시 끝난다.

  안전장치:
    · 온디맨드 양보 — cafe_kw_requests 에 queued/claimed 가 있으면 대기. 사용자 스캔을 막지 않는다.
    · CF 예산 준수 — 실측상 차단은 속도가 아니라 콜 수(약 300콜/10분)에 걸린다. 기본 3.0초 간격.
    · 차단 감지 — 연속 실패 5건이면 5분 쉬고 재개(실측 회복 212~272초). 3회 넘으면 종료.
    · 재개 가능 — 매 실행이 '마커 없는 행'을 다시 조회하므로 중단돼도 다시 돌리면 남은 것만 한다.
    · err 는 캐시하지 않는다(위음성 방지).

  실행: python cafe_kw_heal.py              (전량)
        python cafe_kw_heal.py --limit 300  (일부만)
        python cafe_kw_heal.py --gap 4.0    (더 느리게)
"""
import sys
import os
import time
import socket
import datetime

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore

truststore.inject_into_ssl()
import requests
from dotenv import load_dotenv

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
load_dotenv(os.path.join(_HERE, "..", ".env"))
load_dotenv(os.path.join(_HERE, ".env"))
requests.packages.urllib3.disable_warnings()

import cafe_kw_probe as p
import cafe_kw_worker as W

SB = os.getenv("SUPABASE_URL", "").rstrip("/")
KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY") or ""
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
WID = f"HEAL-{socket.gethostname()}/m"
LOG = os.path.join(_HERE, "cafe_kw_heal.log")

GAP = 3.0               # 건당 간격(초). CF 안전선 240콜/10분 = 2.5초보다 여유
COOLDOWN = 300          # 차단 감지 시 휴식(실측 회복 212~272초)
MAX_COOLDOWN = 3
YIELD_SEC = 60          # 온디맨드 요청이 있을 때 대기 간격


def _log(m):
    line = f"[{datetime.datetime.now():%H:%M:%S}] {m}"
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def _targets():
    """마커 없는 행 전량(페이지네이션). 양성 먼저 — 고객 화면에 바로 영향을 주는 쪽이라."""
    rows, off = [], 0
    while True:
        r = requests.get(f"{SB}/rest/v1/cafe_kw_targets", headers=H, timeout=40, verify=False,
                         params={"select": "keyword,has_section,scanned_by",
                                 "order": "keyword.asc", "limit": "1000", "offset": str(off)}).json()
        if not isinstance(r, list) or not r:
            break
        rows += r
        if len(r) < 1000:
            break
        off += 1000
    need = [x for x in rows if not str(x.get("scanned_by") or "").endswith("/m")]
    need.sort(key=lambda x: (0 if x.get("has_section") else 1, x["keyword"]))
    return need


def _busy():
    """온디맨드 스캔이 대기/진행 중인가 — 있으면 치유는 비켜준다(CF 예산 양보)."""
    try:
        r = requests.get(f"{SB}/rest/v1/cafe_kw_requests", headers=H, timeout=15, verify=False,
                         params={"select": "id", "status": "in.(queued,claimed)", "limit": "1"}).json()
        return bool(isinstance(r, list) and r)
    except Exception:
        return False


def _split(keyword):
    """'강남 입주청소' → (지역코어, 제품어). 공백 없으면 지역 없음(제품어만)."""
    parts = keyword.split(" ", 1)
    if len(parts) == 2 and parts[0] and parts[1]:
        return W._region_core(parts[0]), parts[1]
    return None, keyword


def main():
    gap = GAP
    if "--gap" in sys.argv:
        gap = float(sys.argv[sys.argv.index("--gap") + 1])
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])

    p._USE_CACHE = False          # 로컬 파일 캐시 금지 — 옛 판정을 그대로 되쓰면 치유가 아니라 리플레이가 된다
    p._USE_CF = True
    need = _targets()
    if limit:
        need = need[:limit]
    _log(f"=== 캐시 치유 시작 · 대상 {len(need)}건(양성 {sum(1 for x in need if x['has_section'])}) "
         f"· 간격 {gap}s · 예상 {len(need)*gap/3600:.1f}시간 ===")

    done = pos = errs = 0
    consec, cooldowns, waited = 0, 0, 0
    t0 = time.time()
    for i, row in enumerate(need, 1):
        kw = row["keyword"]
        # 온디맨드 양보 — 사용자가 스캔 중이면 끝날 때까지 기다린다.
        while _busy():
            waited += 1
            if waited % 5 == 1:
                _log(f"  ⏸ 온디맨드 스캔 진행 중 — 양보하고 대기({YIELD_SEC}s)")
            time.sleep(YIELD_SEC)
        r = p._classify_live(kw)
        if r.get("err"):
            errs += 1
            consec += 1
            if consec >= 5:
                cooldowns += 1
                if cooldowns > MAX_COOLDOWN:
                    _log(f"⛔ 차단 지속 — 중단. 남은 {len(need)-i}건은 다시 실행하면 이어서 합니다.")
                    break
                _log(f"  ⚠ 연속 실패 {consec} = 차단 추정 → {COOLDOWN//60}분 휴식({cooldowns}/{MAX_COOLDOWN})")
                time.sleep(COOLDOWN)
                consec = 0
            continue
        consec = 0
        region_core, product = _split(kw)
        if W._is_pop(r) and not W._topical(r.get("rows"), product, region_core):
            r = {"has_section": r.get("has_section"), "verdict": "비관련(오탐)",
                 "theme": r.get("theme"), "rows": r.get("rows")}
        vol = 0
        if W._is_pop(r):
            pos += 1
            try:
                vol = W._real_volume(kw) or 0
            except Exception:
                vol = 0
        try:
            requests.post(f"{SB}/rest/v1/cafe_kw_targets",
                          headers={**H, "Prefer": "resolution=merge-duplicates"}, timeout=20, verify=False,
                          json=[{"keyword": kw, "has_section": bool(r.get("has_section")),
                                 "theme": r.get("theme"), "verdict": r.get("verdict"), "volume": vol,
                                 "cafes": [x for x in (r.get("rows") or []) if x.get("kind") == "카페"],
                                 "scanned_by": WID,
                                 "scanned_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}])
        except Exception as e:
            _log(f"  저장실패 {kw}: {e}")
        done += 1
        if done % 100 == 0:
            el = time.time() - t0
            _log(f"  {done}/{len(need)} · 인기탭 {pos} · 오류 {errs} · {el/60:.0f}분 경과 "
                 f"· 남은 {(len(need)-i)*gap/60:.0f}분")
        time.sleep(gap)
    _log(f"=== 치유 완료 · 처리 {done}/{len(need)} · 인기탭 {pos} · 오류 {errs} · {(time.time()-t0)/60:.0f}분 ===")


if __name__ == "__main__":
    main()
